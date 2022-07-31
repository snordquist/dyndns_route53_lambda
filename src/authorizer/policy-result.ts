import { PolicyDocument } from 'aws-lambda'

export interface PolicyResult {
  principalId: string
  policyDocument: PolicyDocument
}
