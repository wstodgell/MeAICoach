import boto3

def lambda_handler(event, context):
    lambda_client = boto3.client('lambda')
    
    instance_id = event['instance_id']
    function_name = event['function_name']  # Get function name dynamically passed from Step Function
    
    response = lambda_client.update_function_configuration(
        FunctionName=function_name,
        Environment={
            'Variables': {
                'INSTANCE_ID': instance_id
            }
        }
    )
    
    return {'status': 'Environment variable updated', 'instance_id': instance_id}
