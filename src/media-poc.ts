import awsLite from "@aws-lite/client";
import type { AwsLiteS3 } from "@aws-lite/s3-types";
import { request } from "undici";

import { extname, basename } from "node:path";

export interface MediaConfig {
  s3Endpoint: string;
  s3Region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Minimum file size to switch from single PUT to multipart.
   * Typically 5MB or 10MB.
   */
  multipartThreshold?: number;
  /**
   * The size (in bytes) of each part during a multipart upload.
   * Minimum allowed by S3 is 5MB = 5 * 1024 * 1024
   */
  multipartPartSize?: number;
}

export interface UploadUrlOptions {
  sourceUrl: string;
  destinationDir: string;
  /** Max allowed size in bytes (for example, 10MB = 10 * 1024 * 1024). */
  maxFileSize: number;
}

export class Media {
  private s3!: AwsLiteS3;
  private bucket: string;
  private multipartThreshold: number;
  private multipartPartSize: number;
  private s3Initialized: Promise<void>;

  constructor(config: MediaConfig) {
    this.bucket = config.bucket;
    this.multipartThreshold = config.multipartThreshold ?? 5 * 1024 * 1024; // default 5MB
    this.multipartPartSize = config.multipartPartSize ?? 5 * 1024 * 1024; // default 5MB
    this.s3Initialized = this.initializeS3(config);
  }

  /**
   * Initialize the S3 client.
   * This is a separate method to allow for async initialization.
   */
  private async initializeS3(config: MediaConfig) {
    const { S3 } = await awsLite({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      // @ts-ignore
      plugins: [import("@aws-lite/s3")],
    });

    this.s3 = S3;
  }

  /**
   * Upload a file from a remote URL to the S3-compatible storage.
   * Uses a single PUT for small files; uses multipart for large files.
   */
  public async uploadUrl(options: UploadUrlOptions): Promise<string> {
    await this.s3Initialized;

    const { sourceUrl, destinationDir, maxFileSize } = options;

    // 1. Try HEAD request for content-length & content-type
    const { statusCode: headStatus, headers: headHeaders } = await request(
      sourceUrl,
      {
        method: "HEAD",
      },
    );

    console.log(`HEAD request status: ${headStatus}`, headHeaders);

    if (headStatus < 200 || headStatus >= 300) {
      throw new Error(
        `Failed HEAD request for URL: ${sourceUrl}, status code: ${headStatus}`,
      );
    }

    const contentLengthHeader = Array.isArray(headHeaders["content-length"])
      ? headHeaders["content-length"][0]
      : headHeaders["content-length"];
    const contentTypeHeader =
      (Array.isArray(headHeaders["content-type"])
        ? headHeaders["content-type"][0]
        : headHeaders["content-type"]) || "application/octet-stream";

    // Basic content-length parsing
    let contentLength = contentLengthHeader
      ? parseInt(contentLengthHeader, 10)
      : 0;
    if (isNaN(contentLength)) contentLength = 0;

    // Validate content-type (if needed)
    if (!this.isSupportedContentType(contentTypeHeader)) {
      throw new Error(`Unsupported content type: ${contentTypeHeader}`);
    }

    // If contentLength is known and exceeds maxFileSize, abort immediately
    if (maxFileSize && contentLength && contentLength > maxFileSize) {
      throw new Error(
        `File is too large (${contentLength} bytes). Max allowed is ${maxFileSize} bytes.`,
      );
    }

    // 2. Choose S3 key name
    const key = this.buildS3Key(sourceUrl, destinationDir, contentTypeHeader);

    // 3. Decide single PUT vs. multipart
    //    - If the file size is known and < threshold => single PUT
    //    - Else, do a multipart approach
    let finalKey: string;

    console.log(`Content-Length: ${contentLength} bytes`);

    // If we *do* know the content length and it's below the threshold, single PUT is simpler.
    // If we *don't* know the content length or it's >= threshold, fallback to multipart.
    const shouldDoSinglePut =
      contentLength > 0 && contentLength < this.multipartThreshold;
    console.log(
      `Using ${shouldDoSinglePut ? "single PUT" : "multipart"} upload.`,
    );

    if (shouldDoSinglePut) {
      finalKey = await this.uploadSinglePut({
        sourceUrl,
        key,
        contentLength,
        contentType: contentTypeHeader,
      });
    } else {
      // For large or unknown size => multipart
      finalKey = await this.uploadMultipart({
        sourceUrl,
        key,
        contentType: contentTypeHeader,
        maxFileSize,
      });
    }

    return finalKey;
  }

  /**
   * Perform a single PUT object to the S3 bucket.
   * Suitable for smaller files or when we know the file size is within a manageable limit.
   */
  private async uploadSinglePut(params: {
    sourceUrl: string;
    key: string;
    contentLength: number;
    contentType: string;
  }): Promise<string> {
    const { sourceUrl, key, contentLength, contentType } = params;

    // 1. Perform GET request
    const getResponse = await request(sourceUrl);
    if (getResponse.statusCode !== 200) {
      throw new Error(
        `Failed GET request for URL: ${sourceUrl}, status code: ${getResponse.statusCode}`,
      );
    }

    // 2. Pipe the body stream directly to S3 putObject
    await this.s3.PutObject({
      Bucket: this.bucket,
      Key: key,
      Body: getResponse.body, // streaming read
      ContentType: contentType,
      ContentLength: contentLength > 0 ? contentLength.toString() : "0",
    });

    return key;
  }

  /**
   * Perform a multipart upload, chunking the remote file into parts.
   * This avoids reading the entire file into memory.
   */
  private async uploadMultipart(params: {
    sourceUrl: string;
    key: string;
    contentType: string;
    maxFileSize?: number;
  }): Promise<string> {
    const { sourceUrl, key, contentType, maxFileSize } = params;

    // 1. Initiate multipart upload
    const createResp = await this.s3.CreateMultipartUpload({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadId = createResp.UploadId;
    if (!uploadId) {
      throw new Error("Failed to initiate multipart upload: Missing UploadId");
    }

    // 2. Start GET request to remote file
    const getResponse = await request(sourceUrl);
    if (getResponse.statusCode !== 200) {
      // Must abort the upload to avoid leaving incomplete multi-part
      await this.abortMultipart(this.bucket, key, uploadId);
      throw new Error(
        `Failed GET request for URL: ${sourceUrl}, status code: ${getResponse.statusCode}`,
      );
    }

    // We will stream from getResponse.body in chunks of `multipartPartSize`
    let currentPartNumber = 1;
    let totalBytesRead = 0;
    const eTags: Array<{ ETag: string; PartNumber: number }> = [];

    const readable = getResponse.body;

    const partSize = this.multipartPartSize;
    let buffer = Buffer.alloc(0);

    try {
      for await (const chunk of readable) {
        // Append chunk to our buffer
        buffer = Buffer.concat([buffer, chunk]);
        totalBytesRead += chunk.length;

        // Check against maxFileSize (if specified)
        if (maxFileSize && totalBytesRead > maxFileSize) {
          throw new Error(`File exceeded maxFileSize of ${maxFileSize} bytes.`);
        }

        // Once buffer >= partSize, upload a part
        while (buffer.length >= partSize) {
          const partToUpload = buffer.slice(0, partSize);
          const etag = await this.uploadSinglePart(
            this.bucket,
            key,
            uploadId,
            currentPartNumber++,
            partToUpload,
          );
          eTags.push({ ETag: etag, PartNumber: currentPartNumber - 1 });

          // Remainder
          buffer = buffer.slice(partSize);
        }
      }

      // After reading all data, we may have a final buffer leftover
      if (buffer.length > 0) {
        const etag = await this.uploadSinglePart(
          this.bucket,
          key,
          uploadId,
          currentPartNumber++,
          buffer,
        );
        eTags.push({ ETag: etag, PartNumber: currentPartNumber - 1 });
      }

      // 3. Complete the multipart upload
      await this.s3.CompleteMultipartUpload({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: eTags,
        },
      });

      return key;
    } catch (err) {
      // If an error occurs mid-upload, abort the multi-part to avoid leaving incomplete data
      await this.abortMultipart(this.bucket, key, uploadId);
      throw err;
    }
  }

  /**
   * Helper to upload a single part in a multipart upload.
   */
  private async uploadSinglePart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<string> {
    const partResp = await this.s3.UploadPart({
      Bucket: bucket,
      Key: `${key}?partNumber=${partNumber}&uploadId=${uploadId}`,
      Body: body,
    });

    const etag = partResp.ETag;
    if (!etag) {
      throw new Error(`Failed to upload part #${partNumber} for key: ${key}`);
    }
    return etag;
  }

  /**
   * Abort a multipart upload (cleanup).
   * Avoids leaving partial data in your storage.
   */
  private async abortMultipart(bucket: string, key: string, uploadId: string) {
    await this.s3.AbortMultipartUpload({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    });
  }

  /**
   * Build an S3 key from the remote URL + destination directory.
   */
  private buildS3Key(
    sourceUrl: string,
    destinationDir: string,
    contentType: string,
  ): string {
    const urlObj = new URL(sourceUrl);
    const rawFilename = basename(urlObj.pathname || "file");
    const fileExt =
      extname(rawFilename) || this.guessExtensionFromContentType(contentType);

    const finalFilename = rawFilename
      ? rawFilename
      : `uploaded-file-${Date.now()}${fileExt}`;

    return `${destinationDir.replace(/\/+$/, "")}/${finalFilename}`;
  }

  /**
   * Very naive content-type check.
   * In production, consider a library like "file-type" for safer detection.
   */
  private isSupportedContentType(contentType: string): boolean {
    const lower = contentType.toLowerCase();
    return /^text\/|^image\/|^video\/|application\/octet-stream/.test(lower);
  }

  /**
   * Guess extension if not found in the URL. This is purely optional.
   */
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
