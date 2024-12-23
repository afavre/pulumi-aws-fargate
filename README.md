# Pulumi AWS ECS Fargate

Example of IaC using Pulumi to spin up everything needed to create the infrastructure for a docker container in an ECS Fargate.

This setup would be used if you want to have a single "ops" repo where all your infrastructure as code is managed, outside of the application logic which will live in separate repository.

The demo app and build of the Docker Image will be done in https://github.com/afavre/ts-express-app.

Structure of the project:

- base: everything needed before creating the ECS Project (ECR, etc.)
- long-task: Example of a long running task deployed in an ECS Cluster

## Getting Started:

1. Create a new ECR Repository: `cd base && pulumi up`

2. Clone https://github.com/afavre/ts-express-app and follow getting started

3. Once an image is pushed in the ECR Repo:

```
cd long-task
pulumi config set long-task:imageUri <value> //set the repository you created in the base directory (output of the pulumi command)
pulumi config set long-task:imageTag <value> //set the tag of the image you pushed in the previous repo
pulumi up
```

Check it is all setup as expected (using the output from the previous command):

```
curl {outputs.apiEndpoint}/health

Response:

200
{"status":"ok"}

```

## Improvements

- Configurable VPC (currently gets the default VPC)
- Internal ALB to only allow access through API Gateway
- Authentication and Rate limiting on the API Gateway
