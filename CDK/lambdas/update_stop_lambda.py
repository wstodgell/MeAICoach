import boto3

def lambda_handler(event, context):
    lambda_client = boto3.client('lambda')
    instance_id = event['instance_id']  # Get instance_id from event
    
    # Update the environment variable for the Stop Lambda function
    response = lambda_client.update_function_configuration(
        FunctionName='StopInstanceLambda',  # Replace with your Stop Lambda function name
        Environment={
            'Variables': {
                'INSTANCE_ID': instance_id  # Update INSTANCE_ID environment variable
            }
        }
    )
    
    return {'status': 'Environment variable updated', 'instance_id': instance_id}