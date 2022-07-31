import {
  APIGatewayEvent,
  APIGatewayEventDefaultAuthorizerContext,
  APIGatewayProxyEventBase,
  Callback,
} from 'aws-lambda'
import { APIGatewayEventRequestContextV2 } from 'aws-lambda/trigger/api-gateway-proxy'
import { PolicyResult } from './policy-result'

const USERNAME = process.env.BASIC_AUTH_USERNAME
const PASSWORD = process.env.BASIC_AUTH_PASSWORD

const UNAUTHORIZED = 'Unauthorized'

// noinspection JSUnusedGlobalSymbols
export const handler: (event: APIGatewayEvent, context: APIGatewayEventRequestContextV2, callback: Callback) => void = (
  event: APIGatewayEvent,
  context: APIGatewayEventRequestContextV2,
  callback: Callback,
) => {
  const authorizationHeader = getAuthorizationHeader(event)
  if (!authorizationHeader) {
    return callback(UNAUTHORIZED)
  }

  const credentials = parseCredentials(authorizationHeader)
  if (!validateCredentials(credentials)) {
    return callback(UNAUTHORIZED)
  }

  const authResponse = buildAllowAllPolicy(event, credentials.username)
  callback(null, authResponse)
}

function getAuthorizationHeader(event: APIGatewayProxyEventBase<APIGatewayEventDefaultAuthorizerContext>): string {
  const searchKey = 'Authorization'
  const asLowercase = searchKey.toLowerCase()
  const k = Object.keys(event.headers).find((key) => key.toLowerCase() === asLowercase)
  return event.headers[k]
}

function parseCredentials(authorizationHeader: string): { username: string; password: string } {
  const encodedCredentials = authorizationHeader.split(' ')[1]
  const plainCredentials = Buffer.from(encodedCredentials, 'base64').toString().split(':')
  const username = plainCredentials[0]
  const password = plainCredentials[1]
  return { username, password }
}

function validateCredentials(credentials: { username: string; password: string }): boolean {
  return credentials.username === USERNAME && credentials.password === PASSWORD
}

function buildAllowAllPolicy(event, principalId: string): PolicyResult {
  const tmp = event.methodArn.split(':')
  const apiGatewayArnTmp = tmp[5].split('/')
  const awsAccountId = tmp[4]
  const awsRegion = tmp[3]
  const restApiId = apiGatewayArnTmp[0]
  const stage = apiGatewayArnTmp[1]
  const apiArn = `arn:aws:execute-api:${awsRegion}:${awsAccountId}:${restApiId}/${stage}/*/*`
  return {
    principalId: principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Allow',
          Resource: [apiArn],
        },
      ],
    },
  }
}
