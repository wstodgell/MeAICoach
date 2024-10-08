import boto3

def lambda_handler(event, context):
    cloudwatch = boto3.client('cloudwatch')
    instance_id = event['instance_id']  # Retrieve instance_id from the previous step
    
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
        AlarmActions=[]
    )
    
    return {'statusCode': 200, 'body': 'Alarm created'}
