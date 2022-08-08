#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { AppStack } from './app-stack'

const app = new cdk.App()
const appStack = new AppStack(app, 'DynDNSBuildStack', {
  env: {
    region: 'eu-central-1',
  },
})
appStack.create()
