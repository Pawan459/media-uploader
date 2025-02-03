interface UploaderStrategy {
  /**
   * Uploads the file to S3 (or S3-compatible).
   * Returns the final key if successful.
   */
  uploadFile(params: UploaderStrategyParams): Promise<string>;
}

/** Main configuration object for the Media class. */
interface MediaConfig {
  s3Endpoint: string;
  s3Region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  multipartThreshold?: number; // default 5MB
  multipartPartSize?: number; // default 5MB
  multipartConcurrency?: number; // default 3
  // Extra config options if needed
}

interface UploadUrlOptions {
  sourceUrl: string;
  destinationDir: string;
  maxFileSize: number; // e.g. 10 * 1024 * 1024 (10MB)
}

interface StrategyFactoryOptions {
  contentLength: number;
  maxFileSize: number;
  multipartThreshold: number;
  multipartPartSize: number;
  multipartConcurrency: number;
}
