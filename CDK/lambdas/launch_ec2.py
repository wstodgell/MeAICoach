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
