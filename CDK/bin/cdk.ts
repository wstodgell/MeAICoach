#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EC2Stack } from '../lib/ec2-stack';

const app = new cdk.App();
// *** PLATFORM

new EC2Stack(app, 'EC2Stack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});