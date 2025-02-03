import { Readable } from "stream";
import { request } from "undici";
import { vi, describe, beforeEach, it, expect, type Mock } from "vitest";

import { RemoteServerError, FileTooLargeError } from "@app/errors";
import { UploaderStrategyParams } from "@app/shared";
import { MultipartStrategy } from "@app/strategies/multipart.strategy";

vi.mock('undici', () => ({ request: vi.fn() }));

describe('MultipartStrategy', () => {
  let strategy: MultipartStrategy;
  let mockS3: any;

  beforeEach(() => {
    // PartSize=5, concurrency=2 for test
    strategy = new MultipartStrategy(5, 2);

    mockS3 = {
      CreateMultipartUpload: vi.fn().mockResolvedValue({ UploadId: 'test-upload-id' }),
      CompleteMultipartUpload: vi.fn().mockResolvedValue({ ETag: '"complete-etag"' }),
      AbortMultipartUpload: vi.fn().mockResolvedValue({}),

      // The tricky part is mocking UploadPart to *read* the entire chunk.
      UploadPart: vi.fn().mockImplementation(({ Body, Key }) => {
        return new Promise((resolve, reject) => {
          if (Buffer.isBuffer(Body)) {
            resolve({ ETag: '"mock-part-etag"' });
          } else {
            // If Body is a Node stream, read it fully (less common for buffers)
            Body.on('error', reject);
            Body.on('data', () => { });
            Body.on('end', () => {
              resolve({ ETag: `"part-etag-for-${Key}"` });
            });
          }
        });
      })
    };
  });

  it('should upload multiple parts in chunks', async () => {
    // We'll produce 12 bytes => triggers at least 3 parts (5+5+2)
    const mockBody = Readable.from([
      Buffer.alloc(5, 'a'),
      Buffer.alloc(5, 'b'),
      Buffer.alloc(2, 'c'),
    ]);

    (request as Mock).mockResolvedValue({
      statusCode: 200,
      body: mockBody
    });

    const params: UploaderStrategyParams = {
      sourceUrl: 'https://example.com/big-file.bin',
      s3: mockS3,
      bucket: 'test-bucket',
      key: 'big-file.bin',
      contentType: 'application/octet-stream',
      maxFileSize: 50,
    };

    const result = await strategy.uploadFile(params);
    expect(result).toBe('big-file.bin');

    expect(mockS3.CreateMultipartUpload).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'big-file.bin',
      ContentType: 'application/octet-stream'
    });
    // total 3 parts
    expect(mockS3.UploadPart).toHaveBeenCalledTimes(3);
    expect(mockS3.CompleteMultipartUpload).toHaveBeenCalled();
    expect(mockS3.AbortMultipartUpload).not.toHaveBeenCalled();
  });

  it('should abort if remote returns non-200', async () => {
    (request as Mock).mockResolvedValue({
      statusCode: 404
    });

    const params: UploaderStrategyParams = {
      sourceUrl: 'https://example.com/not-found.mp4',
      s3: mockS3,
      bucket: 'test-bucket',
      key: 'not-found.mp4',
      contentType: 'video/mp4',
      maxFileSize: 100
    };

    await expect(strategy.uploadFile(params)).rejects.toThrow(RemoteServerError);
    expect(mockS3.AbortMultipartUpload).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'not-found.mp4',
      UploadId: 'test-upload-id'
    });
  });

  it('should abort if file grows beyond maxFileSize mid-stream', async () => {
    // total 12 bytes
    const mockBody = Readable.from([
      Buffer.alloc(6), // 6
      Buffer.alloc(6), // 12
    ]);

    (request as Mock).mockResolvedValue({
      statusCode: 200,
      body: mockBody
    });

    const params: UploaderStrategyParams = {
      sourceUrl: 'https://example.com/huge.file',
      s3: mockS3,
      bucket: 'test-bucket',
      key: 'huge.file',
      contentType: 'application/octet-stream',
      maxFileSize: 10, // triggers error
    };

    await expect(strategy.uploadFile(params)).rejects.toThrow(FileTooLargeError);
    expect(mockS3.AbortMultipartUpload).toHaveBeenCalled();
  });

  it('should handle concurrency, uploading parts in parallel', async () => {
    strategy = new MultipartStrategy(5, 2); // concurrency=2
    // 25 bytes => 5 parts of 5 each => will overlap concurrency
    const mockBody = Readable.from([
      Buffer.alloc(5, 'x'),
      Buffer.alloc(5, 'x'),
      Buffer.alloc(5, 'x'),
      Buffer.alloc(5, 'x'),
      Buffer.alloc(5, 'x')
    ]);
    (request as Mock).mockResolvedValue({
      statusCode: 200,
      body: mockBody
    });

    const params: UploaderStrategyParams = {
      sourceUrl: 'https://example.com/concurrency-test.bin',
      s3: mockS3,
      bucket: 'test-bucket',
      key: 'conc.bin',
      contentType: 'application/octet-stream',
      maxFileSize: 1000,
    };

    await strategy.uploadFile(params);
    // 5 parts => concurrency 2 means it won't blow up
    expect(mockS3.UploadPart).toHaveBeenCalledTimes(5);
  });

  it('should abort if any part upload fails', async () => {
    // We'll have 4 chunks => 4 parts
    const mockBody = Readable.from([
      Buffer.alloc(5, 'a'),
      Buffer.alloc(5, 'b'),
      Buffer.alloc(5, 'c'),
      Buffer.alloc(5, 'd')
    ]);
    (request as Mock).mockResolvedValue({
      statusCode: 200,
      body: mockBody
    });

    // Force the second part to fail
    let partCount = 0;
    mockS3.UploadPart.mockImplementation(({ Body }: { Body: Readable | Buffer }) => {
      return new Promise((resolve, reject) => {
        if (Buffer.isBuffer(Body)) {
          partCount++;
          if (partCount === 1) {
            // second part => fail
            return reject(new Error('Part upload error!'));
          }

          return resolve({ ETag: '"mock-part-etag"' });
        }
      });
    });

    const params: UploaderStrategyParams = {
      sourceUrl: 'https://example.com/fail-part.mp4',
      s3: mockS3,
      bucket: 'test-bucket',
      key: 'fail-part.mp4',
      contentType: 'video/mp4',
      maxFileSize: 1000
    };

    await expect(strategy.uploadFile(params)).rejects.toThrow('Part upload error!');
    expect(mockS3.AbortMultipartUpload).toHaveBeenCalled();
    // Ensure the final complete is NOT called
    expect(mockS3.CompleteMultipartUpload).not.toHaveBeenCalled();
  });
});
