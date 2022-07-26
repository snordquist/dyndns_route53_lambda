import {APIGatewayEvent} from 'aws-lambda'
import {LambdaResponse} from "./lambda-response"
import {DynDNS} from "./dyndns"

const HOSTED_ZONE_ID = process.env.HOSTED_ZONE_ID

function success(changedHosts: string[]): LambdaResponse {
  return {
    statusCode: 200,
    body: 'Hosts Updated: ' + changedHosts,
  }
}

function determineIp(event: APIGatewayEvent): string {
  const ip = event.queryStringParameters?.ip ?? event.requestContext.identity.sourceIp
  if (!ip) {
    throw 'Failed to determine ip'
  }
  return ip
}

function determineHostname(event: APIGatewayEvent): string {
  const hostname = event.queryStringParameters?.hostname
  if (!hostname) {
    throw 'Failed to determine hostname'
  }
  return hostname
}

function failed(event: APIGatewayEvent, error): LambdaResponse {
  console.error(error, event)
  return {
    statusCode: 500,
    body: error,
  }
}

// noinspection JSUnusedGlobalSymbols
export const handler: (event: APIGatewayEvent) => Promise<LambdaResponse> = async (event: APIGatewayEvent) => {
  try {
    const hostname = determineHostname(event)
    const ip = determineIp(event)
    const changedHosts = await new DynDNS(HOSTED_ZONE_ID)
      .updateIpForHostname({hostname, ip, includeSubdomains: true})
    return success(changedHosts)
  } catch (e) {
    return failed(event, e)
  }
}
