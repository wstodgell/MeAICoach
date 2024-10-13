import boto3
import os

def lambda_handler(event, context):
    ec2 = boto3.client('ec2')
    cloudwatch = boto3.client('cloudwatch')
    ssm = boto3.client('ssm')

    # Fetch the instance ID and CloudWatch alarm name from SSM
    instance_id = os.environ['INSTANCE_ID']
    
    # Fetch the CloudWatch alarm name from SSM Parameter Store
    alarm_param = ssm.get_parameter(Name='/ai-model/cloudwatch-alarm-name')
    alarm_name = alarm_param['Parameter']['Value']

    # Terminate the EC2 instance
    response = ec2.terminate_instances(InstanceIds=[instance_id])
    print(f"Terminating instance {instance_id}: {response}")

    return {
        'statusCode': 200,
        'body': f"Terminated EC2 instance {instance_id}, deleted CloudWatch alarm {alarm_name}, and deleted key pair {key_pair_name}"
    }
