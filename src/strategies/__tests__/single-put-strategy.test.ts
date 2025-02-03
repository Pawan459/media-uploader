import { Readable } from "node:stream";
import { request } from "undici";
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

import { RemoteServerError, FileTooLargeError } from "@app/errors";
import { UploaderStrategyParams } from "@app/shared";
import { SinglePutStrategy } from "@app/strategies/single-put.strategy";

vi.mock("undici", () => ({ request: vi.fn() }));

describe("SinglePutStrategy", () => {
  let strategy: SinglePutStrategy;
  let mockS3: any;

  beforeEach(() => {
    strategy = new SinglePutStrategy();

    // Our S3 mock that *consumes* the incoming stream fully
    mockS3 = {
      PutObject: vi.fn().mockImplementation(({ Body }) => {
        return new Promise((resolve, reject) => {
          const chunks: Buffer[] = [];

          Body.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          Body.on("error", (err: any) => {
            reject(err);
          });

          Body.on("end", () => {
            // e.g., we can measure total data if we want
            resolve({ ETag: '"mock-etag"' });
          });
        });
      }),
    };
  });

  it("should upload successfully when remote is 200 and below max size", async () => {
    const mockBody = Readable.from([Buffer.from("small-file-data")]);
    (request as Mock).mockResolvedValue({
      statusCode: 200,
      body: mockBody,
    });

    const params: UploaderStrategyParams = {
      sourceUrl: "https://example.com/file.jpg",
      s3: mockS3,
      bucket: "test-bucket",
      key: "some/key.jpg",
      contentType: "image/jpeg",
      maxFileSize: 1024, // 1KB
    };

    const resKey = await strategy.uploadFile(params);
    expect(resKey).toBe("some/key.jpg");
    expect(mockS3.PutObject).toHaveBeenCalled();
  });

  it("should throw RemoteServerError if remote returns non-200", async () => {
    (request as Mock).mockResolvedValue({
      statusCode: 404,
    });

    const params: UploaderStrategyParams = {
      sourceUrl: "https://example.com/not-found.jpg",
      s3: mockS3,
      bucket: "test-bucket",
      key: "not-found.jpg",
      contentType: "image/jpeg",
      maxFileSize: 100,
    };

    await expect(strategy.uploadFile(params)).rejects.toThrow(
      RemoteServerError,
    );
    expect(mockS3.PutObject).not.toHaveBeenCalled();
  });

  it("should throw FileTooLargeError if stream exceeds maxFileSize", async () => {
    // 2 chunks of 60 => total 120
    // maxFileSize=100 => triggers an error
    const mockBody = Readable.from([Buffer.alloc(60), Buffer.alloc(60)]);
    (request as Mock).mockResolvedValue({
      statusCode: 200,
      body: mockBody,
    });

    const params: UploaderStrategyParams = {
      sourceUrl: "https://example.com/too-large.jpg",
      s3: mockS3,
      bucket: "test-bucket",
      key: "too-large.jpg",
      contentType: "image/jpeg",
      maxFileSize: 100,
    };

    await expect(strategy.uploadFile(params)).rejects.toThrow(
      FileTooLargeError,
    );
    // We expect the promise to reject, so PutObject => 'error' event
    // triggers rejection
  });

  it("should throw error if response has no body", async () => {
    (request as Mock).mockResolvedValue({
      statusCode: 200,
      body: null,
    });

    const params: UploaderStrategyParams = {
      sourceUrl: "https://example.com/no-body.jpg",
      s3: mockS3,
      bucket: "test-bucket",
      key: "no-body.jpg",
      contentType: "image/jpeg",
      maxFileSize: 100,
    };

    await expect(strategy.uploadFile(params)).rejects.toThrow(
      "no body to stream",
    );
  });

  it("should handle error from S3 PutObject", async () => {
    // If the S3 call fails mid-stream
    mockS3.PutObject.mockImplementation(({ Body }: { Body: Readable }) => {
      return new Promise((_resolve, reject) => {
        Body.on("data", () => {});
        Body.on("end", () => {
          reject(new Error("S3 failed"));
        });
      });
    });

    const mockBody = Readable.from([Buffer.from("some-data")]);
    (request as Mock).mockResolvedValue({
      statusCode: 200,
      body: mockBody,
    });

    const params: UploaderStrategyParams = {
      sourceUrl: "https://example.com/file.jpg",
      s3: mockS3,
      bucket: "test-bucket",
      key: "s3-fails.jpg",
      contentType: "image/jpeg",
      maxFileSize: 1000,
    };

    await expect(strategy.uploadFile(params)).rejects.toThrow("S3 failed");
  });
});
