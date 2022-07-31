import { APIGatewayEvent } from 'aws-lambda'
import { LambdaResponse } from './lambda-response'
import { DynDNS } from './dyndns'

const HOSTED_ZONE_ID = process.env.HOSTED_ZONE_ID
const INCLUDE_SUBDOMAINS = true

const ALREADY_UP_TO_DATE = 'Already up to date.'

function success(changedHosts: string[]): LambdaResponse {
  return {
    statusCode: 200,
    body: changedHosts.length > 0 ? 'Hosts Updated: ' + changedHosts : ALREADY_UP_TO_DATE,
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
    const dynDNS = new DynDNS(HOSTED_ZONE_ID)
    const changedHosts = await dynDNS.updateIpForHostname({
      hostname,
      ip,
      includeSubdomains: INCLUDE_SUBDOMAINS,
    })
    return success(changedHosts)
  } catch (e) {
    return failed(event, e)
  }
}
