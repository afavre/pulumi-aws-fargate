import * as aws from "@pulumi/aws";

import * as ecrHelper from "./infrastructure/ecr";

// Create an ECR repository for Docker images
const ecrTsExpressServer = ecrHelper.createECR("ts-express-server");

// Export the ECR repository URI
export const repositoryUri = ecrTsExpressServer.repositoryUrl;
