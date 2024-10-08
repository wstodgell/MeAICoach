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