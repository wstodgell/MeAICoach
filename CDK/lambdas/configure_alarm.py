import boto3

def lambda_handler(event, context):
    cloudwatch = boto3.client('cloudwatch')
    instance_id = event['instance_id']  # Retrieve instance_id from the previous step
    

    # Fetch the StopInstanceLambda ARN from SSM Parameter Store
    ssm = boto3.client('ssm')
    stop_lambda_arn = ssm.get_parameter(Name='/ai-model/stop-lambda-arn')['Parameter']['Value']

    # Create CloudWatch Alarm
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
        AlarmActions=[stop_lambda_arn] 
    )
    
    return {'statusCode': 200, 'body': 'Alarm created with action to stop EC2'}
