// https://github.com/aws-lite/aws-lite/issues/100
declare module "@aws-lite/s3" {
  export * from "@aws-lite/s3-types";
}

declare global {
  type AwsLiteS3 = import("@aws-lite/s3-types").AwsLiteS3;
}
