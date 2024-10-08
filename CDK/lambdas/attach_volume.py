import boto3
import time

def get_parameter(name):
    ssm = boto3.client('ssm')
    return ssm.get_parameter(Name=name)['Parameter']['Value']

def wait_for_instance_running(instance_id):
    ec2 = boto3.client('ec2')
    while True:
        response = ec2.describe_instance_status(InstanceIds=[instance_id])
        statuses = response['InstanceStatuses']
        if statuses and statuses[0]['InstanceState']['Name'] == 'running':
            return
        time.sleep(5)  # Wait 5 seconds before checking again

def lambda_handler(event, context):
    ec2 = boto3.client('ec2')
    volume_id = get_parameter('/ai-model/volume-id')
    instance_id = event['instance_id']
    
    # Wait for the instance to be in the 'running' state
    wait_for_instance_running(instance_id)
    
    # Attach the volume once the instance is running
    ec2.attach_volume(VolumeId=volume_id, InstanceId=instance_id, Device='/dev/sdh')
    
    return {'status': 'volume_attached', 'instance_id': instance_id}
