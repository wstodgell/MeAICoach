import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm'; // Import for Parameter Store
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
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

    // Step 3: Create a separate EBS volume
    const volume = new ec2.CfnVolume(this, 'MyEBSVolume', {
      availabilityZone: 'us-east-1a',  // Ensure it's in the same AZ as the instance
      size: 100,  // Size in GB
      volumeType: 'gp3',  // General-purpose SSD
    });

    // You can also tag the volume for easy identification later
    cdk.Tags.of(volume).add('Name', 'LLamaDataVolume');

    // Create a Launch Template for Spot Instance
    const launchTemplate = new ec2.CfnLaunchTemplate(this, 'LaunchTemplate', {
      launchTemplateData: {
        instanceType: 'g4dn.xlarge',
        imageId: new ec2.AmazonLinuxImage().getImage(this).imageId,
        userData: cdk.Fn.base64(`
          #!/bin/bash
          sudo yum update -y
          sudo yum install -y git

          # Install Python 3 and pip
          sudo yum install -y python3
          sudo python3 -m ensurepip --upgrade

          # Install PyTorch with GPU support (CUDA 11.8)
          pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

          # Install Huggingface Transformers for LLaMA
          pip3 install transformers accelerate
        `),
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

    // Create a Lambda function to stop the EC2 instance
    const stopInstanceLambda = new lambda.Function(this, 'StopInstanceLambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'index.lambda_handler',  // Corrected: Use 'index' as a virtual file name
      code: lambda.Code.fromInline(`
def lambda_handler(event, context):
  ec2 = boto3.client('ec2')
  instance_id = os.environ['INSTANCE_ID']  # Access the environment variable
  ec2.terminate_instances(InstanceIds=[instance_id])  # Use the value to terminate the EC2 instance
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

    // Step 8: Store important values in Parameter Store
    new ssm.StringParameter(this, 'LaunchTemplateIdParameter', {
      parameterName: '/ai-model/launch-template-id',
      stringValue: launchTemplate.ref,  // Store Launch Template ID
    });

    new ssm.StringParameter(this, 'SecurityGroupIdParameter', {
      parameterName: '/ai-model/security-group-id',
      stringValue: securityGroup.securityGroupId,  // Store Security Group ID
    });

    new ssm.StringParameter(this, 'VolumeIdParameter', {
      parameterName: '/ai-model/volume-id',
      stringValue: volume.ref,  // Store EBS Volume ID
    });

    new ssm.StringParameter(this, 'VpcPublicSubnetIdParameter', {
      parameterName: '/ai-model/public-subnet-id',
      stringValue: vpc.publicSubnets[0].subnetId,  // Store VPC public subnet ID
    });

    ///*************** Launch Sequence */
    // Lambda for launching EC2 instance
    const launchEc2Lambda = new lambda.Function(this, 'LaunchEC2Lambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'launch_ec2.lambda_handler',
      code: lambda.Code.fromInline(`
        import boto3
        import os

        def get_parameter(name):
            ssm = boto3.client('ssm')
            return ssm.get_parameter(Name=name)['Parameter']['Value']

        def lambda_handler(event, context):
            ec2 = boto3.client('ec2')
            launch_template_id = get_parameter('/ai-model/launch-template-id')
            subnet_id = get_parameter('/ai-model/public-subnet-id')
            security_group_id = get_parameter('/ai-model/security-group-id')
            
            response = ec2.run_instances(
                LaunchTemplate={'LaunchTemplateId': launch_template_id},
                MinCount=1,
                MaxCount=1,
                SubnetId=subnet_id,
                SecurityGroupIds=[security_group_id]
            )
            instance_id = response['Instances'][0]['InstanceId']
            return {'instance_id': instance_id}
      `),
      environment: {
        INSTANCE_ID: 'placeholder',
      },
    });

    // Lambda for attaching EBS volume
    const attachVolumeLambda = new lambda.Function(this, 'AttachVolumeLambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'attach_volume.lambda_handler',
      code: lambda.Code.fromInline(`
        import boto3

        def get_parameter(name):
            ssm = boto3.client('ssm')
            return ssm.get_parameter(Name=name)['Parameter']['Value']

        def lambda_handler(event, context):
            ec2 = boto3.client('ec2')
            volume_id = get_parameter('/ai-model/volume-id')
            instance_id = event['instance_id']
            ec2.attach_volume(VolumeId=volume_id, InstanceId=instance_id, Device='/dev/sdh')
            return {'status': 'volume_attached'}
      `),
    });

    // Lambda for configuring CloudWatch alarms
    const configureAlarmLambda = new lambda.Function(this, 'ConfigureAlarmLambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'configure_alarm.lambda_handler',
      code: lambda.Code.fromInline(`
        import boto3
        import os

        def lambda_handler(event, context):
            cloudwatch = boto3.client('cloudwatch')
            instance_id = event['instance_id']
            cloudwatch.put_metric_alarm(
                AlarmName='LowCpuAlarm',
                MetricName='CPUUtilization',
                Namespace='AWS/EC2',
                Statistic='Average',
                Dimensions=[{'Name': 'InstanceId', 'Value': instance_id}],
                Period=300,
                EvaluationPeriods=6,
                Threshold=5,
                ComparisonOperator='LessThanThreshold',
                AlarmActions=[]
            )
            return {'statusCode': 200, 'body': 'Alarm created'}
      `),
    });

    // Step 4: Grant EC2 permissions to Lambda Functions
    const ec2Permissions = new iam.PolicyStatement({
      actions: ['ec2:RunInstances', 'ec2:AttachVolume', 'ec2:DescribeInstances'],
      resources: ['*'],
    });
    launchEc2Lambda.addToRolePolicy(ec2Permissions);
    attachVolumeLambda.addToRolePolicy(ec2Permissions);
    configureAlarmLambda.addToRolePolicy(ec2Permissions);

    // Step 5: Define Step Function Tasks
    const launchEc2Task = new tasks.LambdaInvoke(this, 'LaunchEC2Task', {
      lambdaFunction: launchEc2Lambda,
      outputPath: '$.Payload',
    });

    const attachVolumeTask = new tasks.LambdaInvoke(this, 'AttachVolumeTask', {
      lambdaFunction: attachVolumeLambda,
      inputPath: '$',
      outputPath: '$.Payload',
    });

    const configureAlarmTask = new tasks.LambdaInvoke(this, 'ConfigureAlarmTask', {
      lambdaFunction: configureAlarmLambda,
      inputPath: '$',
      outputPath: '$.Payload',
    });

    // Step 6: Create Step Function Workflow
    const definition = launchEc2Task
      .next(attachVolumeTask)
      .next(configureAlarmTask);

    const stateMachine = new sfn.StateMachine(this, 'EC2StateMachine', {
      definition,
      timeout: cdk.Duration.minutes(5),
    });

    new cdk.CfnOutput(this, 'StateMachineArn', { value: stateMachine.stateMachineArn });



    
  }
}
