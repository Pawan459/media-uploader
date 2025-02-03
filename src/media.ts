import awsLite from "@aws-lite/client";
import type { AwsLiteS3 } from "@aws-lite/s3-types";
import { request } from "undici";

import {
  FileTooLargeError,
  RemoteServerError,
  UnsupportedContentTypeError,
} from "@app/errors";

import {
  UploaderStrategyFactory,
  LoggingStrategyDecorator,
} from "@app/strategies";

import { basename, extname } from "node:path";

/**
 * Main class: orchestrates HEAD request, picks a strategy via factory,
 * and optionally wraps it in decorators.
 */
export class Media {
  private s3!: AwsLiteS3;
  private bucket: string;
  private multipartThreshold: number;
  private multipartPartSize: number;
  private multipartConcurrency: number;

  private s3Initialized: Promise<void>;

  constructor(config: MediaConfig) {
    this.bucket = config.bucket;
    this.multipartThreshold = config.multipartThreshold ?? 5 * 1024 * 1024;
    this.multipartPartSize = config.multipartPartSize ?? 5 * 1024 * 1024;
    this.multipartConcurrency = config.multipartConcurrency ?? 3;

    // Defer S3 client initialization
    this.s3Initialized = this.initializeS3(config);
  }

  /** Asynchronously init the S3 client. */
  private async initializeS3(config: MediaConfig) {
    const { S3 } = await awsLite({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      // @ts-ignore: dynamic import for s3 plugin
      plugins: [import("@aws-lite/s3")],
    });
    this.s3 = S3;
  }

  /**
   * Upload a file from a remote URL to S3-like storage.
   * Chooses Single vs. Multipart strategy using a Factory,
   * and optionally wraps with a Logging decorator.
   */
  public async uploadUrl(options: UploadUrlOptions): Promise<string> {
    await this.s3Initialized;

    const { sourceUrl, destinationDir, maxFileSize } = options;

    // 1) HEAD request
    const headResp = await request(sourceUrl, { method: "HEAD" });
    if (headResp.statusCode < 200 || headResp.statusCode >= 300) {
      throw new RemoteServerError(
        `HEAD request failed for ${sourceUrl}, status: ${headResp.statusCode}`,
      );
    }

    // 2) Parse headers
    const lengthHeader = Array.isArray(headResp.headers["content-length"])
      ? headResp.headers["content-length"][0]
      : headResp.headers["content-length"];

    let contentLength = 0;
    if (lengthHeader) {
      const parsed = parseInt(lengthHeader, 10);
      if (!isNaN(parsed)) {
        contentLength = parsed;
      }
    }

    const typeHeader =
      (Array.isArray(headResp.headers["content-type"])
        ? headResp.headers["content-type"][0]
        : headResp.headers["content-type"]) || "application/octet-stream";

    // 3) Check type
    if (!this.isSupportedContentType(typeHeader)) {
      throw new UnsupportedContentTypeError(
        `Unsupported content type: ${typeHeader}`,
      );
    }

    // 4) If definitely too large, fail fast
    if (contentLength > maxFileSize) {
      throw new FileTooLargeError(
        `File is too large (${contentLength} bytes). Max is ${maxFileSize}.`,
      );
    }

    // 5) Build final S3 key
    const key = this.buildS3Key(sourceUrl, destinationDir, typeHeader);

    // 6) Use a factory to pick the strategy
    const baseStrategy = UploaderStrategyFactory.createStrategy({
      contentLength,
      maxFileSize,
      multipartThreshold: this.multipartThreshold,
      multipartPartSize: this.multipartPartSize,
      multipartConcurrency: this.multipartConcurrency,
    });

    // (Optional) wrap the strategy in a logging decorator
    const strategy: UploaderStrategy = new LoggingStrategyDecorator(
      baseStrategy,
    );
    // If you don't want logging, skip the decorator and use `baseStrategy` directly.

    // 7) Execute
    return strategy.uploadFile({
      sourceUrl,
      s3: this.s3,
      bucket: this.bucket,
      key,
      contentType: typeHeader,
      maxFileSize,
    });
  }

  private buildS3Key(
    sourceUrl: string,
    destinationDir: string,
    contentType: string,
  ): string {
    const urlObj = new URL(sourceUrl);
    const rawFilename = basename(urlObj.pathname || "file");
    const ext =
      extname(rawFilename) || this.guessExtensionFromContentType(contentType);

    const finalFilename =
      rawFilename.length > 0
        ? rawFilename
        : `uploaded-file-${Date.now()}${ext}`;

    const dir = destinationDir.replace(/\/+$/, "");
    return `${dir}/${finalFilename}`;
  }

  private isSupportedContentType(contentType: string): boolean {
    const lower = contentType.toLowerCase();
    return /^text\/|^image\/|^video\/|^application\/octet-stream/.test(lower);
  }

  private guessExtensionFromContentType(contentType: string): string {
    if (contentType.startsWith("image/")) {
      return "." + contentType.split("/")[1];
    }
    if (contentType.startsWith("video/")) {
      return "." + contentType.split("/")[1];
    }
    return "";
  }
}
