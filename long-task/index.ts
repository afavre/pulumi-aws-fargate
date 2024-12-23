import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// Shared

const config = new pulumi.Config();
const repositoryUri = config.require("imageUri");
const imageTag = config.require("imageTag");

const CONTAINER_PORT = 8080;

const logGroup = new aws.cloudwatch.LogGroup("ecs-task-log-group", {
  retentionInDays: 3,
});

const defaultVpc = aws.ec2.getVpcOutput({ default: true });

const subnets = aws.ec2.getSubnetsOutput({
  filters: [{ name: "vpc-id", values: [defaultVpc.id] }],
});

const albSecurityGroup = new aws.ec2.SecurityGroup("alb-sg", {
  ingress: [
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
  ],
});

// Target group for ALB

const targetGroup = new aws.lb.TargetGroup("app-target-group", {
  protocol: "HTTP",
  port: CONTAINER_PORT,
  vpcId: defaultVpc.id,
  targetType: "ip", // Must be "ip" for ECS Fargate
  healthCheck: {
    path: "/health",
    interval: 30,
    timeout: 5,
    healthyThreshold: 2,
    unhealthyThreshold: 2,
    port: "" + CONTAINER_PORT + "",
  },
});

// Setup ECS

const cluster = new aws.ecs.Cluster("fargate-cluster", {
  name: "fargate-cluster",
});

// IAM Role for ECS Task Execution
const taskExecutionRole = new aws.iam.Role("ecs-task-execution-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: ["ecs-tasks.amazonaws.com", "events.amazonaws.com"],
  }),
});

new aws.iam.RolePolicyAttachment("ecs-task-execution-role-policy", {
  role: taskExecutionRole.name,
  policyArn:
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

new aws.iam.RolePolicyAttachment("event-bridge-role-policy", {
  role: taskExecutionRole.name,
  policyArn: aws.iam.ManagedPolicies.CloudWatchActionsEC2Access,
});

new aws.iam.RolePolicyAttachment("ecrReadOnlyPolicyAttachment", {
  role: taskExecutionRole.name,
  policyArn: aws.iam.ManagedPolicies.AmazonEC2ContainerRegistryReadOnly,
});

const taskSecurityGroup = new aws.ec2.SecurityGroup("task-sg", {
  ingress: [
    {
      protocol: "tcp",
      fromPort: CONTAINER_PORT,
      toPort: CONTAINER_PORT,
      securityGroups: [albSecurityGroup.id],
    },
  ],
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
  ],
});

const taskDefinition = new aws.ecs.TaskDefinition("task-definition", {
  family: "my-task",
  cpu: "256",
  memory: "512",
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  taskRoleArn: taskExecutionRole.arn,
  executionRoleArn: taskExecutionRole.arn,
  containerDefinitions: pulumi
    .all([repositoryUri, logGroup.name])
    .apply(([repoUri, logGroupName]) =>
      JSON.stringify([
        {
          name: "app",
          image: repoUri + ":" + imageTag,
          essential: true,
          memory: 512,
          cpu: 256,
          portMappings: [
            {
              containerPort: CONTAINER_PORT,
              hostPort: CONTAINER_PORT,
              protocol: "tcp",
            },
          ],

          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroupName,
              "awslogs-region": aws.config.region,
              "awslogs-stream-prefix": "ecs-task",
            },
          },
          //   healthCheck: {
          //     command: [
          //       "CMD-SHELL",
          //       "curl -f http://localhost:8080/health || exit 1",
          //     ],
          //     interval: 30,
          //     timeout: 5,
          //     retries: 3,
          //     startPeriod: 0,
          //   },
        },
      ])
    ),
});

const ecsService = new aws.ecs.Service("ecs-service", {
  cluster: cluster.arn,
  taskDefinition: taskDefinition.arn,
  desiredCount: 1,
  launchType: "FARGATE",
  networkConfiguration: {
    subnets: subnets.ids,
    assignPublicIp: true,
    securityGroups: [taskSecurityGroup.id],
  },
  loadBalancers: [
    {
      targetGroupArn: targetGroup.arn,
      containerName: "app",
      containerPort: CONTAINER_PORT,
    },
  ],
});

// Set up ALB
const alb = new aws.lb.LoadBalancer("app-lb", {
  internal: false,
  securityGroups: [albSecurityGroup.id],
  subnets: subnets.ids,
});

const listener = new aws.lb.Listener("app-listener", {
  loadBalancerArn: alb.arn,
  protocol: "HTTP",
  port: 80,
  defaultActions: [
    {
      type: "forward",
      targetGroupArn: targetGroup.arn,
    },
  ],
});

// Create an API Gateway
const api = new aws.apigatewayv2.Api("apiGateway", {
  protocolType: "HTTP",
});

// Create a Stage for the API
const stage = new aws.apigatewayv2.Stage("apiStage", {
  apiId: api.id,
  name: "prod", // Production stage
  autoDeploy: true,
  //   accessLogSettings: {
  //     destinationArn: logGroup.arn,
  //     format: JSON.stringify({
  //       requestId: "$context.requestId",
  //       ip: "$context.identity.sourceIp",
  //       routeKey: "$context.routeKey",
  //       status: "$context.status",
  //       protocol: "$context.protocol",
  //       responseLength: "$context.responseLength",
  //       integrationStatus: "$context.integrationStatus",
  //       errorMessage: "$context.error.message",
  //     }),
  //   },
});

// ALB URL
const albUrl = pulumi.interpolate`http://${alb.dnsName}/{proxy}`;

// Create an HTTP Integration for API Gateway
const integration = new aws.apigatewayv2.Integration("albIntegration", {
  apiId: api.id,
  integrationType: "HTTP_PROXY",
  integrationUri: albUrl, // Forward requests to the ALB
  payloadFormatVersion: "1.0",
  integrationMethod: "ANY",
});

const route = new aws.apigatewayv2.Route("apiRoute", {
  apiId: api.id,
  routeKey: "ANY /{proxy+}", // Forward all requests
  target: pulumi.interpolate`integrations/${integration.id}`,
});

export const apiEndpoint = pulumi.interpolate`${api.apiEndpoint}/${stage.name}`;
