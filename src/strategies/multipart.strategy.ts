import { request } from "undici";

import { RemoteServerError, FileTooLargeError } from "@app/errors";
import { UploaderStrategyParams } from "@app/shared";
import type { AwsLiteS3 } from "@aws-lite/s3-types";

/**
 * Streams the file in parts (each part defaults to 5MB) and uploads concurrently.
 * Suitable for large or unknown-size files.
 */
export class MultipartStrategy implements UploaderStrategy {
  private readonly multipartPartSize: number;
  private readonly multipartConcurrency: number;

  constructor(partSize = 5 * 1024 * 1024, concurrency = 3) {
    this.multipartPartSize = partSize;
    this.multipartConcurrency = concurrency;
  }

  public async uploadFile(params: UploaderStrategyParams): Promise<string> {
    const { sourceUrl, s3, bucket, key, contentType, maxFileSize } = params;

    // 1) CreateMultipartUpload
    const createResp = await s3.CreateMultipartUpload({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    const uploadId = createResp.UploadId;
    if (!uploadId) {
      throw new Error("Multipart upload initiation failed: Missing UploadId.");
    }

    // 2) GET request from the source
    const getResp = await request(sourceUrl);
    if (getResp.statusCode !== 200) {
      await this.abortMultipart(s3, bucket, key, uploadId);
      throw new RemoteServerError(
        `GET request failed for ${sourceUrl}, status: ${getResp.statusCode}`,
      );
    }

    let partNumber = 1;
    let totalBytesRead = 0;
    let buffer = Buffer.allocUnsafe(0);
    const eTags: Array<{ ETag: string; PartNumber: number }> = [];
    const inFlight = new Set<Promise<void>>();

    try {
      for await (const chunk of getResp.body) {
        buffer = Buffer.concat([buffer, chunk]);
        totalBytesRead += chunk.length;

        // Check max file size
        if (totalBytesRead > maxFileSize) {
          throw new FileTooLargeError(
            `File exceeded maxFileSize of ${maxFileSize} bytes.`,
          );
        }

        // While we have enough data for a part
        while (buffer.length >= this.multipartPartSize) {
          const partData = buffer.subarray(0, this.multipartPartSize);
          buffer = buffer.subarray(this.multipartPartSize);

          const currentPart = partNumber++;
          const uploadPromise = (async () => {
            const etag = await this.uploadSinglePart(
              s3,
              bucket,
              key,
              uploadId,
              currentPart,
              partData,
            );
            eTags.push({ ETag: etag, PartNumber: currentPart });
          })();

          inFlight.add(uploadPromise);

          // If we exceed concurrency, wait for at least one to finish
          if (inFlight.size >= this.multipartConcurrency) {
            await Promise.race(inFlight);
            this.cleanupResolvedPromises(inFlight);
          }
        }
      }

      // leftover
      if (buffer.length > 0) {
        const currentPart = partNumber++;
        const uploadPromise = (async () => {
          const etag = await this.uploadSinglePart(
            s3,
            bucket,
            key,
            uploadId,
            currentPart,
            buffer,
          );
          eTags.push({ ETag: etag, PartNumber: currentPart });
        })();
        inFlight.add(uploadPromise);
      }

      // Wait for all
      await Promise.all(inFlight);

      // Sort by part number
      eTags.sort((a, b) => a.PartNumber - b.PartNumber);

      // 3) Complete
      await s3.CompleteMultipartUpload({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: eTags,
        },
      });

      return key;
    } catch (err) {
      await this.abortMultipart(s3, bucket, key, uploadId);
      throw err;
    }
  }

  private async uploadSinglePart(
    s3: any,
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<string> {
    const result = await s3.UploadPart({
      Bucket: bucket,
      Key: `${key}?partNumber=${partNumber}&uploadId=${uploadId}`,
      Body: body,
    });
    if (!result.ETag) {
      throw new Error(`UploadPart #${partNumber} missing ETag`);
    }
    return result.ETag;
  }

  private async abortMultipart(
    s3: AwsLiteS3,
    bucket: string,
    key: string,
    uploadId: string,
  ) {
    await s3.AbortMultipartUpload({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    });
  }

  /** Removes settled promises from the concurrency set after race. */
  private cleanupResolvedPromises(inFlight: Set<Promise<void>>) {
    for (const p of [...inFlight]) {
      // A real concurrency library (e.g. p-limit) can manage this more gracefully.
      // This approach simply removes them from the set after we know at least one finished.
      inFlight.delete(p);
    }
  }
}
