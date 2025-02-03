import { request } from "undici";
import { Readable } from "stream";
import { vi, describe, beforeEach, it, expect, type Mock } from "vitest";
import {
  RemoteServerError,
  UnsupportedContentTypeError,
  FileTooLargeError,
} from "./errors";
import { Media } from "./media";

// Mock undici
vi.mock("undici", () => ({ request: vi.fn() }));

// Mock aws-lite/client => so we can customize the S3 object
vi.mock("@aws-lite/client", () => {
  return {
    default: vi.fn().mockResolvedValue({
      S3: {},
    }),
  };
});

describe("Media class", () => {
  let media: Media;
  let mockS3: any;

  beforeEach(async () => {
    // Create the media instance
    const config: MediaConfig = {
      s3Endpoint: "http://localhost:9000",
      s3Region: "us-east-1",
      bucket: "test-bucket",
      accessKeyId: "dummy-key",
      secretAccessKey: "dummy-secret",
      multipartThreshold: 5 * 1024 * 1024,
      multipartPartSize: 5 * 1024 * 1024,
      multipartConcurrency: 3,
    };
    media = new Media(config);
    // Wait for the S3 client to finish async init
    await (media as any).s3Initialized;

    // Now mock out the S3 methods
    mockS3 = (media as any).s3;
    mockS3.PutObject = vi.fn().mockImplementation(({ Body }) => {
      // We'll read the stream to completion
      return new Promise((resolve, reject) => {
        Body.on("data", () => {});
        Body.on("error", (err: any) => reject(err));
        Body.on("end", () => resolve({ ETag: '"mock-etag"' }));
      });
    });
    mockS3.CreateMultipartUpload = vi
      .fn()
      .mockResolvedValue({ UploadId: "test-upload-id" });

    mockS3.UploadPart = vi.fn().mockImplementation(({ Body }) => {
      return new Promise((resolve, reject) => {
        if (Buffer.isBuffer(Body)) {
          // We can do some quick size check if desired
          resolve({ ETag: '"part-etag"' });
        } else if (Body && typeof Body.on === "function") {
          // It's a stream
          Body.on("error", reject);
          Body.on("end", () => resolve({ ETag: '"part-etag"' }));
          Body.resume(); // read the data so 'end' eventually fires
        } else {
          reject(new Error("Unknown Body type for UploadPart."));
        }
      });
    });
    mockS3.CompleteMultipartUpload = vi
      .fn()
      .mockResolvedValue({ ETag: '"complete-etag"' });
    mockS3.AbortMultipartUpload = vi.fn().mockResolvedValue({});
  });

  it("throws RemoteServerError if HEAD returns 5xx", async () => {
    // HEAD => 500
    (request as Mock).mockResolvedValueOnce({ statusCode: 500 });

    const opts: UploadUrlOptions = {
      sourceUrl: "https://example.com/server-error.jpg",
      destinationDir: "images",
      maxFileSize: 1_000_000,
    };
    await expect(media.uploadUrl(opts)).rejects.toThrow(RemoteServerError);
  });

  it("throws UnsupportedContentTypeError if content type is disallowed", async () => {
    // HEAD => 200 but content-type=application/zip => disallowed
    (request as Mock).mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        "content-type": "application/zip",
        "content-length": "500",
      },
    });

    const opts: UploadUrlOptions = {
      sourceUrl: "https://example.com/file.zip",
      destinationDir: "archives",
      maxFileSize: 1_000_000,
    };

    await expect(media.uploadUrl(opts)).rejects.toThrow(
      UnsupportedContentTypeError,
    );
  });

  it("throws FileTooLargeError if content-length > maxFileSize", async () => {
    // HEAD => content-length=6MB => max=5MB => throw
    (request as Mock).mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        "content-type": "image/jpeg",
        "content-length": "6000000", // 6MB
      },
    });

    const opts: UploadUrlOptions = {
      sourceUrl: "https://example.com/large.jpg",
      destinationDir: "images",
      maxFileSize: 5_000_000,
    };

    await expect(media.uploadUrl(opts)).rejects.toThrow(FileTooLargeError);
  });

  it("succeeds if HEAD is valid and under maxFileSize (SinglePut)", async () => {
    // 1) HEAD => 200 => content-length=400 => single put
    (request as Mock)
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": "400",
        },
      })
      // 2) GET => return Node stream
      .mockResolvedValueOnce({
        statusCode: 200,
        body: Readable.from([Buffer.from("some-small-file")]),
      });

    const opts: UploadUrlOptions = {
      sourceUrl: "https://example.com/small.jpg",
      destinationDir: "images",
      maxFileSize: 1_000_000,
    };

    // No error => success
    await expect(media.uploadUrl(opts)).resolves.not.toThrow();

    // We expect SinglePutStrategy => PutObject => done
    expect(mockS3.PutObject).toHaveBeenCalledTimes(1);
    expect(mockS3.CreateMultipartUpload).not.toHaveBeenCalled();
  });

  it("handles text content type (still SinglePut)", async () => {
    // HEAD => text/plain => single put
    (request as Mock)
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          "content-type": "text/plain",
          "content-length": "200",
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: Readable.from([Buffer.from("some textual data")]),
      });

    const opts: UploadUrlOptions = {
      sourceUrl: "https://example.com/document.txt",
      destinationDir: "docs",
      maxFileSize: 1_000_000,
    };

    await expect(media.uploadUrl(opts)).resolves.not.toThrow();
    expect(mockS3.PutObject).toHaveBeenCalled();
  });

  it("when content-length is missing => uses multipart => no error if GET is valid", async () => {
    // HEAD => no content-length => fallback to multipart
    (request as Mock)
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          "content-type": "video/mp4",
          // no content-length
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: Readable.from([Buffer.alloc(10, "a")]),
      });

    const opts: UploadUrlOptions = {
      sourceUrl: "https://example.com/unknown-size.mp4",
      destinationDir: "videos",
      maxFileSize: 10_000_000,
    };

    await expect(media.uploadUrl(opts)).resolves.not.toThrow();
    // multipart => check calls
    expect(mockS3.CreateMultipartUpload).toHaveBeenCalledTimes(1);
    // one chunk => likely one part
    expect(mockS3.UploadPart).toHaveBeenCalledTimes(1);
    expect(mockS3.CompleteMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it("guesses extension from content type correctly", () => {
    const config: MediaConfig = {
      s3Endpoint: "http://localhost:9000",
      s3Region: "us-east-1",
      bucket: "test-bucket",
      accessKeyId: "dummy-key",
      secretAccessKey: "dummy-secret",
    };
    const media = new Media(config);

    expect((media as any).guessExtensionFromContentType("image/jpeg")).toBe(
      ".jpeg",
    );
    expect((media as any).guessExtensionFromContentType("video/mp4")).toBe(
      ".mp4",
    );
    expect(
      (media as any).guessExtensionFromContentType("application/octet-stream"),
    ).toBe("");
  });

  it("handles missing content-length header gracefully", async () => {
    (request as Mock)
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          "content-type": "image/jpeg",
          // no content-length
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: Readable.from([Buffer.alloc(10, "a")]),
      });

    const opts: UploadUrlOptions = {
      sourceUrl: "https://example.com/unknown-size.jpg",
      destinationDir: "images",
      maxFileSize: 10_000_000,
    };

    await expect(media.uploadUrl(opts)).resolves.not.toThrow();
    expect(mockS3.CreateMultipartUpload).toHaveBeenCalledTimes(1);
    expect(mockS3.UploadPart).toHaveBeenCalledTimes(1);
    expect(mockS3.CompleteMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it("handles unsupported content type with no extension", async () => {
    (request as Mock)
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          "content-type": "application/x-unknown",
          "content-length": "400",
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: Readable.from([Buffer.from("some data")]),
      });

    const opts: UploadUrlOptions = {
      sourceUrl: "https://example.com/unknown",
      destinationDir: "unknowns",
      maxFileSize: 1_000_000,
    };

    await expect(media.uploadUrl(opts)).rejects.toThrow(
      UnsupportedContentTypeError,
    );
  });
});
