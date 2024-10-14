import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm'; // Import for Parameter Store
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';  // Import Secrets Manager

export class EC2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Accept availability zone as a parameter
    const availabilityZoneParam = new cdk.CfnParameter(this, 'availabilityZone', {
      type: 'String',
      description: 'The availability zone for the EC2 instance and EBS volume.',
    });

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
    const volume = new ec2.CfnVolume(this, 'LlamaEBSVolume', {
      availabilityZone: availabilityZoneParam.valueAsString, // Ensure it's in the same AZ as the instance
      size: 100,  // Size in GB
      volumeType: 'gp3',  // General-purpose SSD
    });

    // Tag the EBS Volume
    cdk.Tags.of(volume).add('Name', 'LLamaDataVolume');

    // Create a Launch Template for Spot Instance
    const launchTemplate = new ec2.CfnLaunchTemplate(this, 'LaunchTemplate', {
      launchTemplateData: {
        instanceType: 't2.medium', //'g4dn.xlarge', (t2.medium is largest you can launch in sandbox)
        imageId: new ec2.AmazonLinuxImage({
          generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023, // Use Amazon Linux 2023
        }).getImage(this).imageId,
        blockDeviceMappings: [
          {
            deviceName: '/dev/xvda', // Default device for root volume on EC2
            ebs: {
              volumeSize: 20, // Set size to 20GB
              volumeType: 'gp3', // General-purpose SSD (gp3 or gp2)
              deleteOnTermination: true, // Automatically delete the volume when instance is terminated
            },
          },
        ],
        userData: cdk.Fn.base64(`
#!/bin/bash
exec > /var/log/user-data.log 2>&1  # Log user data output for debugging

echo "Starting EC2 user data script"

# Update the system
sudo dnf update -y || exit 1

# Install git
sudo dnf install -y git || exit 1

# Install Python 3 and pip
sudo dnf install -y python3 || exit 1
sudo python3 -m ensurepip --upgrade || exit 1

# End of user data script
echo "User data script completed"
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

    

    ///*************** Launch Sequence */
    // Lambda for launching EC2 instance

    // Give the Lambda function permission to stop the EC2 instance
   
    ///*************** DEFINE LAMBDA'S
    // Lambda for launching EC2 instance

    // Create a Lambda function to stop the EC2 instance
    const stopInstanceLambda = new lambda.Function(this, 'StopInstanceLambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'terminate_ec2.lambda_handler',  // Corrected: Use 'index' as a virtual file name
      code: lambda.Code.fromAsset('lambdas'),  // Point to the 'lambdas' directory
      timeout: cdk.Duration.seconds(10),  // Adjust timeout
    });

    const launchEc2Lambda = new lambda.Function(this, 'LaunchEC2Lambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'launch_ec2.lambda_handler',  // 'launch_ec2' is the file, 'lambda_handler' is the function
      code: lambda.Code.fromAsset('lambdas'),  // Point to the 'lambdas' directory
      timeout: cdk.Duration.seconds(10),  // Adjust timeout
    });

    const attachVolumeLambda = new lambda.Function(this, 'AttachVolumeLambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'attach_volume.lambda_handler',  // 'attach_volume' is the file, 'lambda_handler' is the function
      code: lambda.Code.fromAsset('lambdas'),  // Same directory
      timeout: cdk.Duration.seconds(60), // longer because it may take a while for ec2 to up and run
    });

    const updateStopLambda = new lambda.Function(this, 'UpdateStopLambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'update_stop_lambda.lambda_handler',
      code: lambda.Code.fromAsset('lambdas'),  // Assuming you have a lambdas directory with the code
      timeout: cdk.Duration.seconds(10),  // Adjust timeout if necessary
    });
    
    const configureAlarmLambda = new lambda.Function(this, 'ConfigureAlarmLambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'configure_alarm.lambda_handler',  // 'configure_alarm' is the file, 'lambda_handler' is the function
      code: lambda.Code.fromAsset('lambdas'),
      timeout: cdk.Duration.seconds(10),
    });

    // ******************* Add necessary permissions to Lambdas

    stopInstanceLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:TerminateInstances',       // Permission to terminate EC2 instance
        'cloudwatch:DeleteAlarms',     // Permission to delete CloudWatch alarms
        'ssm:GetParameter'               // Permission to retrieve alarm name from SSM Parameter Store
      ],
      resources: ['*'], // Can limit to specific instance if preferred
    }));

     // Create the EC2 permissions for AttachVolumeLambda
    const ec2Permissions = new iam.PolicyStatement({
      actions: [
        'ec2:RunInstances', 
        'ec2:AttachVolume',
        "ec2:DescribeVolumes",
        'ec2:DescribeInstances',
        "ec2:TerminateInstances",
        'ec2:DescribeInstanceStatus',  // Add this permission
        'iam:CreateServiceLinkedRole',
        'ec2:CreateKeyPair',
        'ec2:DescribeKeyPairs',
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups"
      ],
      resources: ['*'],
    });
    
    launchEc2Lambda.addToRolePolicy(ec2Permissions);
    attachVolumeLambda.addToRolePolicy(ec2Permissions);
    configureAlarmLambda.addToRolePolicy(ec2Permissions);
    
    // Create Secrets Manager permissions for the launchEc2Lambda
    const secretsManagerPermissions = new iam.PolicyStatement({
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:PutSecretValue',
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret'
      ],
      resources: ['*'], // You can restrict this to specific secrets if needed
    });

    // Attach the Secrets Manager permissions to launchEc2Lambda
    launchEc2Lambda.addToRolePolicy(secretsManagerPermissions);
    stopInstanceLambda.addToRolePolicy(secretsManagerPermissions);

    const ssmPermissions = new iam.PolicyStatement({
      actions: [
        "ssm:GetParameter",
        "ssm:PutParameter"
    ], 
      resources: ['*'],  // Grant access to all SSM parameters
    });
    
    // Add these policies to the Lambda role
    launchEc2Lambda.addToRolePolicy(ssmPermissions);
    attachVolumeLambda.addToRolePolicy(ssmPermissions);
    updateStopLambda.addToRolePolicy(ssmPermissions);
    configureAlarmLambda.addToRolePolicy(ssmPermissions);

    // Add CloudWatch permissions to ConfigureAlarmLambda
    const cloudwatchPermissions = new iam.PolicyStatement({
      actions: [
        'cloudwatch:PutMetricAlarm',  // Allow creating CloudWatch alarms
        'lambda:InvokeFunction', // so cloudwatch actions can access invoke lambda
        "lambda:AddPermission"
      ],
      resources: ['*'],  // Optionally, restrict to a specific resource or use '*' for all resources
    });

    // Attach the policy to ConfigureAlarmLambda
    configureAlarmLambda.addToRolePolicy(cloudwatchPermissions);

    const lambdaPermissions = new iam.PolicyStatement({
      actions: ['lambda:UpdateFunctionConfiguration'],
      resources: ['*'],  // Replace with actual ARN of StopInstanceLambda
    });
    
    updateStopLambda.addToRolePolicy(lambdaPermissions);

    // *************************** CONFIGURE TASKS **************** //
    const launchEc2Task = new tasks.LambdaInvoke(this, 'LaunchEC2Task', {
      lambdaFunction: launchEc2Lambda,
      outputPath: '$.Payload',  // This ensures that the output comes from the Payload of the Lambda
    });

    // Attach Volume Task - will pass 'instance_id' along with 'volume_attached' status
    const attachVolumeTask = new tasks.LambdaInvoke(this, 'AttachVolumeTask', {
      lambdaFunction: attachVolumeLambda,
      inputPath: '$',  // Use input from previous step
      outputPath: '$.Payload',  // Output will include 'instance_id' for next step
    });

    const updateStopLambdaTask = new tasks.LambdaInvoke(this, 'UpdateStopLambdaTask', {
      lambdaFunction: updateStopLambda,  // Using 'updateStopLambda' function
      inputPath: '$',
      outputPath: '$.Payload',
      payload: sfn.TaskInput.fromObject({
        instance_id: sfn.JsonPath.stringAt('$.instance_id'),       // Pass the instance ID
        function_name: stopInstanceLambda.functionName             // Dynamically pass the stop Lambda function name
      }),
    });
    
    // Configure Alarm Task - expects 'instance_id' from previous tasks
    const configureAlarmTask = new tasks.LambdaInvoke(this, 'ConfigureAlarmTask', {
      lambdaFunction: configureAlarmLambda,
      inputPath: '$',  // Use input from the AttachVolumeTask
      outputPath: '$.Payload',
    });


    // Step 6: Create Step Function Workflow
    const definition = launchEc2Task
      .next(attachVolumeTask)
      .next(updateStopLambdaTask)
      .next(configureAlarmTask);

    const stateMachine = new sfn.StateMachine(this, 'EC2StateMachine', {
      definition,
      timeout: cdk.Duration.minutes(5),
    });

    new cdk.CfnOutput(this, 'StateMachineArn', { value: stateMachine.stateMachineArn });

    // ****************** Add created resources to parameter store
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

    // Store the function name in SSM Parameter Store
    new ssm.StringParameter(this, 'StopLambdaFunctionName', {
      parameterName: '/ai-model/stop-lambda-function-name',
      stringValue: stopInstanceLambda.functionName,
    });

    new ssm.StringParameter(this, 'CloudWatchAlarmNameParameter', {
      parameterName: '/ai-model/cloudwatch-alarm-name',
      stringValue: 'MyCloudWatchAlarm',  // Replace with actual alarm name
    });

    new ssm.StringParameter(this, 'StopLambdaArnParameter', {
      parameterName: '/ai-model/stop-lambda-arn',
      stringValue: stopInstanceLambda.functionArn,  // Store the ARN of the StopInstanceLambda
    });

  }
}
