import boto3

def lambda_handler(event, context):
    cloudwatch = boto3.client('cloudwatch')
    lambda_client = boto3.client('lambda')
    instance_id = event['instance_id']  # Retrieve instance_id from the previous step
    

    # Fetch the StopInstanceLambda ARN from SSM Parameter Store
    ssm = boto3.client('ssm')
    stop_lambda_arn = ssm.get_parameter(Name='/ai-model/stop-lambda-arn')['Parameter']['Value']

     # Define the CloudWatch Alarm name (can be dynamic if needed)
    alarm_name = f'LowCpuAlarm-{instance_id}'  # Example: make alarm name unique by appending instance ID

    # Grant CloudWatch permission to invoke the Lambda function
    try:
        lambda_client.add_permission(
            FunctionName=stop_lambda_arn,
            StatementId=f"CloudWatchInvokePermission-{instance_id}",  # Unique statement ID
            Action="lambda:InvokeFunction",
            Principal="cloudwatch.amazonaws.com",  # Principal that will invoke the function
            SourceArn=f"arn:aws:cloudwatch:{context.invoked_function_arn.split(':')[3]}:{context.invoked_function_arn.split(':')[4]}:alarm:{alarm_name}"  # Specify the exact CloudWatch alarm ARN
        )
    except lambda_client.exceptions.ResourceConflictException:
        # Permission already exists, nothing to do here
        pass

    # Create CloudWatch Alarm
    cloudwatch.put_metric_alarm(
        AlarmName=alarm_name,
        MetricName='CPUUtilization',
        Namespace='AWS/EC2',
        Statistic='Average',
        Dimensions=[{'Name': 'InstanceId', 'Value': instance_id}],
        Period=300,
        EvaluationPeriods=2,
        Threshold=5,
        ComparisonOperator='LessThanThreshold',
        AlarmActions=[stop_lambda_arn] 
    )

    # Store the alarm name in SSM Parameter Store
    ssm.put_parameter(
        Name='/ai-model/cloudwatch-alarm-name',  # Parameter name in SSM
        Value=alarm_name,                        # The name of the created alarm
        Type='String',                           # Specify parameter type as String
        Overwrite=True                           # Overwrite if the parameter already exists
    )
    
    return {'statusCode': 200, 'body': 'Alarm created with action to stop EC2'}
