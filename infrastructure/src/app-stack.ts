import * as cdk from 'aws-cdk-lib'
import { Duration, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { CfnPermission } from 'aws-cdk-lib/aws-lambda'
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2-alpha'
import {
  DomainMappingOptions,
  DomainName,
  HttpApi,
  HttpAuthorizer,
  HttpAuthorizerType,
  HttpRouteAuthorizerConfig,
  IDomainName,
} from '@aws-cdk/aws-apigatewayv2-alpha'
import * as route53 from 'aws-cdk-lib/aws-route53'
import { IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53'
import { HttpLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha'
import { RetentionDays } from 'aws-cdk-lib/aws-logs'
import * as path from 'path'
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { required } from './required'
import { IHttpRouteAuthorizer } from '@aws-cdk/aws-apigatewayv2-alpha/lib/http/authorizer'
import { ApiGatewayv2DomainProperties } from 'aws-cdk-lib/aws-route53-targets'
import { Certificate, DnsValidatedCertificate, ICertificate } from 'aws-cdk-lib/aws-certificatemanager'

const getEnv: (_: string) => string = (key: string) =>
  required(process.env[key], () => `Environment variable ${key} not provided`)

const hasEnv: (_: string) => boolean = (key: string) => !!process.env[key]

const hostedZoneId: () => string = () => getEnv('HOSTED_ZONE_ID')
const hostedZoneName: () => string = () => getEnv('HOSTED_ZONE_NAME')
const configDomainName: () => string = () => getEnv('CONFIG_DOMAIN_NAME')
const configDomainCertificateArn: () => string = () => getEnv('CONFIG_DOMAIN_CERTIFICATE_ARN')
const basicAuthUsername: () => string = () => getEnv('BASIC_AUTH_USERNAME')
const basicAuthPassword: () => string = () => getEnv('BASIC_AUTH_PASSWORD')

const SHARED_FUNCTION_PROPS = {
  runtime: lambda.Runtime.NODEJS_16_X,
  logRetention: RetentionDays.ONE_WEEK,
  memorySize: 256,
  timeout: Duration.seconds(28),
}

export class AppStack extends Stack {
  private hostedZone: IHostedZone
  private domainName?: IDomainName
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)
  }

  create(): void {
    this.hostedZone = this.createHostedZone()
    this.domainName = this.hasDomainName ? this.createConfigDomain() : undefined

    const httpApi = this.createHttpApi()
    const dynDnsLambda = this.createDynDnsLambda()
    const authorizerLambda = this.createAuthorizerLambda()

    this.configureApiGateway(httpApi, authorizerLambda, dynDnsLambda)
    this.configureConfigDomain()

    new cdk.CfnOutput(this, 'HttpApiUrlOutput', {
      value: httpApi.apiEndpoint,
      exportName: 'httpApiEndpoint',
    })
  }

  private configureConfigDomain(): void {
    if (this.domainName) {
      new route53.ARecord(this, 'DynDnsRoute53ConfigARecord', {
        zone: this.hostedZone,
        recordName: configDomainName(),
        target: RecordTarget.fromAlias(
          new ApiGatewayv2DomainProperties(this.domainName.regionalDomainName, this.domainName.regionalHostedZoneId),
        ),
      })
    }
  }

  private createConfigDomain(): IDomainName {
    return new DomainName(this, 'DynDnsConfigDomainName', {
      domainName: configDomainName(),
      certificate: this.getConfigCertificate(),
    })
  }

  private getConfigCertificate(): ICertificate {
    if (this.hasCertificateArn) {
      return this.useCertificateByArn()
    }
    return this.createCertificateForConfigDomain()
  }

  private useCertificateByArn(): ICertificate {
    return Certificate.fromCertificateArn(this, 'DynDnsCertificate', configDomainCertificateArn())
  }

  private createCertificateForConfigDomain(): ICertificate {
    return new DnsValidatedCertificate(this, 'DynDnsCertificate', {
      hostedZone: this.hostedZone,
      domainName: configDomainName(),
    })
  }

  private get hasCertificateArn(): boolean {
    return hasEnv('CONFIG_DOMAIN_CERTIFICATE_ARN')
  }

  private get hasDomainName(): boolean {
    return hasEnv('CONFIG_DOMAIN_NAME')
  }

  private createHttpAuthorizer(httpApi: HttpApi, authorizerLambda: lambda.Function): apigatewayv2.HttpAuthorizer {
    return new apigatewayv2.HttpAuthorizer(this, 'DynDNS-Lambda-Authorizer', {
      type: HttpAuthorizerType.LAMBDA,
      identitySource: ['$request.header.Authorization'],
      httpApi: httpApi,
      authorizerUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${authorizerLambda.functionArn}/invocations`,
      enableSimpleResponses: true,
    })
  }

  private createAuthorizerLambda(): lambda.Function {
    return new lambda.Function(this, 'authorizer', {
      ...SHARED_FUNCTION_PROPS,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.resolve('..', 'dist/authorizer')),
      environment: {
        BASIC_AUTH_USERNAME: basicAuthUsername(),
        BASIC_AUTH_PASSWORD: basicAuthPassword(),
      },
    })
  }

  private createDynDnsLambda(): lambda.Function {
    const dynDnsLambda = new lambda.Function(this, 'dyndns', {
      ...SHARED_FUNCTION_PROPS,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.resolve('..', 'dist/dyndns')),
      environment: {
        HOSTED_ZONE_ID: hostedZoneId(),
      },
    })
    this.addPermissionsToAccessHostedZone(dynDnsLambda)
    return dynDnsLambda
  }

  private addPermissionsToAccessHostedZone(lambda: lambda.Function): void {
    const policyStatement = new PolicyStatement()
    policyStatement.addActions('route53:ChangeResourceRecordSets', 'route53:ListResourceRecordSets')
    policyStatement.addResources(this.hostedZone.hostedZoneArn)
    lambda.role?.addToPrincipalPolicy(policyStatement)
  }

  private createHostedZone(): route53.IHostedZone {
    return route53.HostedZone.fromHostedZoneAttributes(this, 'DynDNS-Hosted-Zone', {
      hostedZoneId: hostedZoneId(),
      zoneName: hostedZoneName(),
    })
  }

  private createHttpApi(): apigatewayv2.HttpApi {
    return new apigatewayv2.HttpApi(this, 'DynDNS HttpApi', {
      description: 'HTTP API',
      disableExecuteApiEndpoint: false,
      createDefaultStage: true,
      defaultDomainMapping: this.getDefaultDomainMapping(),
    })
  }

  private getDefaultDomainMapping(): DomainMappingOptions | undefined {
    if (this.domainName) {
      return {
        domainName: this.domainName,
      }
    }
    return undefined
  }

  private configureApiGateway(
    httpApi: HttpApi,
    authorizerLambda: lambda.Function,
    dynDnsLambda: lambda.Function,
  ): void {
    const authorizer = this.createHttpAuthorizer(httpApi, authorizerLambda)
    httpApi.addRoutes({
      path: '/',
      methods: [apigatewayv2.HttpMethod.GET],
      authorizer: this.createRouteAuthorizer(authorizer),
      integration: new HttpLambdaIntegration('DyDNSLambdaIntegration', dynDnsLambda),
    })
    authorizerLambda.grantInvoke(new ServicePrincipal('apigateway.amazonaws.com'))
    const authorizerArn = `arn:aws:execute-api:${this.region}:${this.account}:${httpApi.apiId}/authorizers/${authorizer.authorizerId}`
    new CfnPermission(this, 'AuthorizerLambdaPermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerLambda.functionName,
      principal: 'apigateway.amazonaws.com',
      sourceArn: authorizerArn,
    })

    dynDnsLambda.grantInvoke(new ServicePrincipal('apigateway.amazonaws.com'))
  }

  private createRouteAuthorizer(authorizer: HttpAuthorizer): IHttpRouteAuthorizer {
    return {
      bind(): HttpRouteAuthorizerConfig {
        return {
          authorizationType: 'CUSTOM',
          authorizerId: authorizer.authorizerId,
        }
      },
    }
  }
}
