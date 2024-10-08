import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';  // Import AWS EventBridge
import * as targets from 'aws-cdk-lib/aws-events-targets';  // Import Lambda targets for EventBridge
import { Construct } from 'constructs';

export class EC2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC to host the EC2 instance - it spreads across two availability zones.

    const vpc = new ec2.Vpc(this, 'AIModelVPC', {
      maxAzs: 2
    });

    // Step 2: Create a security group in your VPC
    const securityGroup = new ec2.SecurityGroup(this, 'AIModelSG', {
      vpc,
      allowAllOutbound: true, // Allows all outbound traffic by default
      securityGroupName: 'AIModelSecurityGroup',
    });

    // Allow inbound SSH access (port 22) from any IP (can restrict this for better security)
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH access');

    // (Optional) Allow inbound HTTP access (port 80)
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP access');

    // Create a Launch Template for Spot Instance
    const launchTemplate = new ec2.CfnLaunchTemplate(this, 'LaunchTemplate', {
      launchTemplateData: {
        instanceType: 'g4dn.xlarge',
        imageId: new ec2.AmazonLinuxImage().getImage(this).imageId,
        userData: cdk.Fn.base64(`
          #!/bin/bash
          sudo yum update -y
          # Install PyTorch with GPU support
          pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
        `),
        blockDeviceMappings: [
          {
            deviceName: '/dev/sdh',
            ebs: { volumeSize: 100 },
          },
        ],
        instanceMarketOptions: {
          marketType: 'spot',
          spotOptions: {
            maxPrice: '2.10', // Specify your max spot price
          },
        },
        // Remove tags by ensuring no tagSpecifications are passed
      tagSpecifications: [],
      },
    });

    const configureCloudWatchLambda = new lambda.Function(this, 'ConfigureCloudWatchLambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'configure_alarm.lambda_handler',
      code: lambda.Code.fromInline(`
        import boto3
        import os
    
        def lambda_handler(event, context):
            ec2_client = boto3.client('ec2')
            cloudwatch_client = boto3.client('cloudwatch')
    
            instance_id = os.environ['INSTANCE_ID']
    
            # Create the CloudWatch alarm
            cloudwatch_client.put_metric_alarm(
                AlarmName='LowCpuAlarm',
                MetricName='CPUUtilization',
                Namespace='AWS/EC2',
                Statistic='Average',
                Dimensions=[{'Name': 'InstanceId', 'Value': instance_id}],
                Period=300,  # 5 minutes
                EvaluationPeriods=6,
                Threshold=5,
                ComparisonOperator='LessThanThreshold',
                AlarmActions=[]  # Can add an action here if needed
            )
    
            return {'statusCode': 200, 'body': 'Alarm created'}
      `),
      environment: {
        INSTANCE_ID: 'placeholder',  // Update with the actual InstanceId when known
      },
    });

    const rule = new events.Rule(this, 'InstanceStateChangeRule', {
      eventPattern: {
        source: ['aws.ec2'],
        detailType: ['EC2 Instance State-change Notification'],
        detail: {
          state: ['running'],
        },
      },
    });
    
    rule.addTarget(new targets.LambdaFunction(configureCloudWatchLambda));

    // Create a Lambda function to stop the EC2 instance
    const stopInstanceLambda = new lambda.Function(this, 'StopInstanceLambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'index.lambda_handler',  // Corrected: Use 'index' as a virtual file name
      code: lambda.Code.fromInline(`
        import boto3
        def lambda_handler(event, context):
            ec2 = boto3.client('ec2')
            ec2.terminate_instances(InstanceIds=['i-011f57f22e39a1d03'])
      `),
      environment: {
        INSTANCE_ID: 'placeholder',  // Pass the actual EC2 instance ID here
      },
    });

    // Give the Lambda function permission to stop the EC2 instance
    stopInstanceLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ec2:TerminateInstances'],
      resources: ['*'], // Can limit to specific instance if preferred
    }));

    // Manually create CloudWatch Alarm for CPUUtilization
    const cpuUtilizationMetric = new cloudwatch.Metric({
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      dimensionsMap: {
        InstanceId: 'placeholder',  // This will need to be dynamically set when EC2 is launched
      },
    });

    const alarm = new cloudwatch.Alarm(this, 'LowCpuAlarm', {
      metric: cpuUtilizationMetric,
      threshold: 5,  // 5% CPU threshold
      evaluationPeriods: 6,  // 6 periods of 5 minutes = 30 minutes
      datapointsToAlarm: 6
    });

    // Trigger Lambda from CloudWatch Alarm
    alarm.addAlarmAction(new cloudwatch_actions.LambdaAction(stopInstanceLambda));
    
  }
}
