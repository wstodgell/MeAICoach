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

    # Fetch the key pair name from SSM (or you can use environment variables if you have it stored there)
    key_pair_name = ssm.get_parameter(Name='/ai-model/key-pair-name')['Parameter']['Value']

    # Delete the associated EC2 key pair
    try:
        key_pair_response = ec2.delete_key_pair(KeyName=key_pair_name)
        print(f"Deleted key pair {key_pair_name}: {key_pair_response}")
    except Exception as e:
        print(f"Failed to delete key pair {key_pair_name}: {str(e)}")

    return {
        'statusCode': 200,
        'body': f"Terminated EC2 instance {instance_id}, deleted CloudWatch alarm {alarm_name}, and deleted key pair {key_pair_name}"
    }
