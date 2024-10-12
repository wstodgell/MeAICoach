import boto3
import os
import json
import time

def get_parameter(name):
    ssm = boto3.client('ssm')
    return ssm.get_parameter(Name=name)['Parameter']['Value']

def lambda_handler(event, context):
    ec2 = boto3.client('ec2')
    secretsmanager = boto3.client('secretsmanager')
    key_pair_name = 'my-key-pair'
    secret_name = f'EC2KeyPair-{key_pair_name}'

    # Step 1: Check if the key pair already exists
    try:
        ec2.describe_key_pairs(KeyNames=[key_pair_name])
        print(f"Key pair {key_pair_name} already exists. Proceeding with existing key pair.")
    except ec2.exceptions.ClientError as e:
        if 'InvalidKeyPair.NotFound' in str(e):
            print(f"Key pair {key_pair_name} does not exist. Creating a new key pair.")
            key_pair = ec2.create_key_pair(KeyName=key_pair_name)
            private_key = key_pair['KeyMaterial']
            
            # Store private key in Secrets Manager
            try:
                response = secretsmanager.create_secret(
                    Name=secret_name,
                    SecretString=private_key
                )
                print(f"Secret stored successfully. ARN: {response['ARN']}")
            except secretsmanager.exceptions.ResourceExistsException:
                print(f"Secret {secret_name} already exists. Overwriting the secret.")
                secretsmanager.put_secret_value(
                    SecretId=secret_name,
                    SecretString=private_key
                )
        else:
            raise e

    # Step 2: Delay for key pair propagation
    print("Waiting for key pair propagation...")
    time.sleep(5)  # Add a delay to ensure the key pair is ready

    # Log all key pairs available (for debugging)
    existing_key_pairs = ec2.describe_key_pairs()
    print(f"Available key pairs: {existing_key_pairs}")

    # Add a delay to ensure key pair is fully registered
    time.sleep(5)

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

