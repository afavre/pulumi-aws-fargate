import * as aws from "@pulumi/aws";

export function createECR(name: string) {
  return new aws.ecr.Repository(name, {
    name: name,
    imageTagMutability: "IMMUTABLE",
  });
}
