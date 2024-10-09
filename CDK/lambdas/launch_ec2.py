import boto3
import os
import json

def get_parameter(name):
    ssm = boto3.client('ssm')
    return ssm.get_parameter(Name=name)['Parameter']['Value']

def lambda_handler(event, context):
    ec2 = boto3.client('ec2')

    # Step 1: Create a key pair (check if it exists first)
    key_pair_name = 'my-key-pair'
    
    try:
        # Try creating the key pair
        key_pair = ec2.create_key_pair(KeyName=key_pair_name)

        # Save the private key securely (Store in Secrets Manager)
        private_key = key_pair['KeyMaterial']
        secretsmanager = boto3.client('secretsmanager')
        secretsmanager.create_secret(
            Name=f'EC2KeyPair-{key_pair_name}',
            SecretString=private_key
        )

    except ec2.exceptions.ClientError as e:
        if 'InvalidKeyPair.Duplicate' in str(e):
            print(f"Key pair {key_pair_name} already exists. Proceeding.")
        else:
            raise e

    # Step 2: Fetch parameters from SSM
    launch_template_id = get_parameter('/ai-model/launch-template-id')
    subnet_id = get_parameter('/ai-model/public-subnet-id')
    security_group_id = get_parameter('/ai-model/security-group-id')

    # Step 3: Run EC2 instance with the key pair
    response = ec2.run_instances(
        LaunchTemplate={'LaunchTemplateId': launch_template_id},
        KeyName=key_pair_name,  # Include the key pair for SSH access
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

