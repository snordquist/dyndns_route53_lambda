import {
  APIGatewayEvent,
  APIGatewayEventDefaultAuthorizerContext,
  APIGatewayProxyEventBase,
  Callback,
} from 'aws-lambda'
import { APIGatewayEventRequestContextV2 } from 'aws-lambda/trigger/api-gateway-proxy'
import { atob } from 'buffer'

const USERNAME = process.env.BASIC_AUTH_USERNAME
const PASSWORD = process.env.BASIC_AUTH_PASSWORD

const UNAUTHORIZED = { isAuthorized: false }
const AUTHORIZED = { isAuthorized: true }

// noinspection JSUnusedGlobalSymbols
export const handler: (event: APIGatewayEvent, context: APIGatewayEventRequestContextV2, callback: Callback) => void = (
  event: APIGatewayEvent,
  context: APIGatewayEventRequestContextV2,
  callback: Callback,
) => {
  const authorizationHeader = getAuthorizationHeader(event)
  if (!authorizationHeader) {
    return callback(null, UNAUTHORIZED)
  }

  const credentials = parseCredentials(authorizationHeader)
  if (!validateCredentials(credentials)) {
    return callback(null, UNAUTHORIZED)
  }
  callback(null, AUTHORIZED)
}

function getAuthorizationHeader(event: APIGatewayProxyEventBase<APIGatewayEventDefaultAuthorizerContext>): string {
  const searchKey = 'Authorization'
  const asLowercase = searchKey.toLowerCase()
  const k = Object.keys(event.headers).find((key) => key.toLowerCase() === asLowercase)
  return event.headers[k]
}

function parseCredentials(authorizationHeader: string): { username: string; password: string } {
  const encodedCredentials = authorizationHeader.split(' ')[1]
  const decodedCredentials = atob(encodedCredentials)
  const plainCredentials = decodedCredentials.split(':')
  const username = plainCredentials[0]
  const password = plainCredentials[1]
  return { username, password }
}

function validateCredentials(credentials: { username: string; password: string }): boolean {
  return credentials.username === USERNAME && credentials.password === PASSWORD
}
