import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

export class EC2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC
    const vpc = new ec2.Vpc(this, 'MyVPC', {
      maxAzs: 2
    });

    // Create a Launch Template for Spot Instance
    const launchTemplate = new ec2.CfnLaunchTemplate(this, 'LaunchTemplate', {
      launchTemplateData: {
        instanceType: 'g4dn.xlarge',
        imageId: new ec2.AmazonLinuxImage().getImage(this).imageId,
        blockDeviceMappings: [
          {
            deviceName: '/dev/sdh',
            ebs: { volumeSize: 20 },
          },
        ],
        instanceMarketOptions: {
          marketType: 'spot',
          spotOptions: {
            maxPrice: '0.10', // Specify your max spot price
          },
        },
      },
    });

    // Create the EC2 Spot Instance using the launch template
    const instance = new ec2.CfnInstance(this, 'SpotInstance', {
      launchTemplate: {
        launchTemplateId: launchTemplate.ref,
        version: launchTemplate.attrLatestVersionNumber, // Use latest version
      },
      subnetId: vpc.publicSubnets[0].subnetId,  // Use the appropriate subnet
    });

    // Manually create CloudWatch Alarm for CPUUtilization
    const cpuUtilizationMetric = new cloudwatch.Metric({
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      dimensionsMap: {
        InstanceId: instance.ref,
      },
    });

    const alarm = new cloudwatch.Alarm(this, 'LowCpuAlarm', {
      metric: cpuUtilizationMetric,
      threshold: 5, // 5% CPU threshold
      evaluationPeriods: 6, // 6 periods of 5 minutes = 30 minutes
      datapointsToAlarm: 6
    });

    // Create a Lambda function to stop the EC2 instance
    const stopInstanceLambda = new lambda.Function(this, 'StopInstanceLambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'stop_instance.lambda_handler',
      code: lambda.Code.fromInline(`
        import boto3
        def lambda_handler(event, context):
          ec2 = boto3.client('ec2')
          ec2.stop_instances(InstanceIds=['${instance.ref}'])
      `),
    });

    // Give the Lambda function permission to stop the EC2 instance
    stopInstanceLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ec2:StopInstances'],
      resources: ['*'], // Can limit to specific instance if preferred
    }));

    // Trigger Lambda from CloudWatch Alarm
    alarm.addAlarmAction(new cloudwatch_actions.LambdaAction(stopInstanceLambda));
  }
}
