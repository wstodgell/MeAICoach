import boto3
import os
import json
import time

def get_parameter(name):
    ssm = boto3.client('ssm')
    return ssm.get_parameter(Name=name)['Parameter']['Value']

def lambda_handler(event, context):
    ec2 = boto3.client('ec2')

    # Step 2: Fetch parameters from SSM
    launch_template_id = get_parameter('/ai-model/launch-template-id')
    subnet_id = get_parameter('/ai-model/public-subnet-id')
    security_group_id = get_parameter('/ai-model/security-group-id')
    key_pair_name = 'my-key-pair'  # Use the name of the key pair created by the CDK stack

    # Step 3: Run EC2 instance with the key pair
    response = ec2.run_instances(
        LaunchTemplate={'LaunchTemplateId': launch_template_id},
        KeyName=key_pair_name,  # Attach the key pair for SSH access
        MinCount=1,
        MaxCount=1,
        SubnetId=subnet_id,
        SecurityGroupIds=[security_group_id]
    )

    instance_id = response['Instances'][0]['InstanceId']
    result = {
        'instance_id': instance_id,
        'key_pair_name': key_pair_name,
        'launch_template_id': launch_template_id  # Include launch_template_id in the return
    }
    print(json.dumps(result))  # Log the result
    return result

