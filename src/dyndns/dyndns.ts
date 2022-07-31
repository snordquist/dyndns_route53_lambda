import { AWSError, Route53 } from 'aws-sdk'
import { ResourceRecordSet, ResourceRecordSets } from 'aws-sdk/clients/route53'
import { PromiseResult } from 'aws-sdk/lib/request'
import { HostUpdate } from './host-update'
import { isEqualIgnoreCase } from './util'

const ROUTE53_COMMENT = 'DynDNS'
const route53 = new Route53()

const TTL = 60

export class DynDNS {
  constructor(private hostedZoneId: string) {}

  async updateIpForHostname(update: HostUpdate): Promise<string[]> {
    const changes = await this.createChanges(update)
    if (changes.length > 0) {
      await this.applyChanges(changes)
    }
    return this.namesOf(changes)
  }

  private async createChanges(update: HostUpdate): Promise<Route53.Changes> {
    const records = await this.listRecords()
    console.log('records', records)
    return records
      .filter((record) => record.Type === 'A')
      .filter((record) => this.isMatchingHostname(record, update))
      .filter((record) => this.requiresUpdate(record, update))
      .map((record) => this.createChange(record.Name, update.ip))
  }

  private createChange(hostname: string, ip: string): Route53.Change {
    return {
      Action: 'UPSERT',
      ResourceRecordSet: this.resourceSetForHostAndIp(hostname, ip),
    }
  }

  private isMatchingHostname(record: Route53.ResourceRecordSet, update: HostUpdate): boolean {
    const domainName = this.toDomainName(update.hostname)
    return (
      isEqualIgnoreCase(record.Name, domainName) || (update.includeSubdomains && this.isSubdomainOf(record, domainName))
    )
  }

  private isSubdomainOf(record: Route53.ResourceRecordSet, domainName: string): boolean {
    return record.Name.toLowerCase().endsWith(`.${domainName.toLowerCase()}`)
  }

  private toDomainName(hostname: string): string {
    return `${hostname}.`
  }

  private requiresUpdate(record: Route53.ResourceRecordSet, update: HostUpdate): boolean {
    return !record.ResourceRecords.some((resourceRecord) => resourceRecord.Value === update.ip)
  }

  private async listRecords(): Promise<ResourceRecordSets> {
    const promise = await route53
      .listResourceRecordSets({
        HostedZoneId: this.hostedZoneId,
      })
      .promise()
    return promise.ResourceRecordSets
  }

  private applyChanges(
    changes: Route53.Changes,
  ): Promise<PromiseResult<Route53.ChangeResourceRecordSetsResponse, AWSError>> {
    const params: Route53.Types.ChangeResourceRecordSetsRequest = {
      ChangeBatch: {
        Changes: changes,
        Comment: ROUTE53_COMMENT,
      },
      HostedZoneId: this.hostedZoneId,
    }
    console.log('route53 update', JSON.stringify(params))
    return route53.changeResourceRecordSets(params).promise()
  }

  private resourceSetForHostAndIp(hostname: string, ip: string): ResourceRecordSet {
    return {
      Name: hostname,
      ResourceRecords: [{ Value: ip }],
      TTL,
      Type: 'A',
    }
  }

  private namesOf(changes: Route53.Change[]): string[] {
    return changes.map((change) => change.ResourceRecordSet.Name)
  }
}
