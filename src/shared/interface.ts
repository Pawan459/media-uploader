import type { AwsLiteS3 } from "@aws-lite/s3-types";

export interface UploaderStrategyParams {
  sourceUrl: string;
  s3: AwsLiteS3;
  bucket: string;
  key: string;
  contentType: string;
  maxFileSize: number;
}
