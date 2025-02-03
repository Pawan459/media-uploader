import { describe, it, expect } from "vitest";
import { MultipartStrategy } from "@app/strategies/multipart.strategy";
import { SinglePutStrategy } from "@app/strategies/single-put.strategy";
import { UploaderStrategyFactory } from "@app/strategies";

describe("UploaderStrategyFactory", () => {
  it("returns SinglePutStrategy if contentLength < threshold", () => {
    const strategy = UploaderStrategyFactory.createStrategy({
      contentLength: 4_000_000,
      maxFileSize: 10_000_000,
      multipartThreshold: 5_000_000,
      multipartPartSize: 5_000_000,
      multipartConcurrency: 3,
    });
    expect(strategy).toBeInstanceOf(SinglePutStrategy);
  });

  it("returns MultipartStrategy if contentLength == threshold", () => {
    const strategy = UploaderStrategyFactory.createStrategy({
      contentLength: 5_000_000,
      maxFileSize: 10_000_000,
      multipartThreshold: 5_000_000,
      multipartPartSize: 5_000_000,
      multipartConcurrency: 3,
    });
    expect(strategy).toBeInstanceOf(MultipartStrategy);
  });

  it("returns MultipartStrategy if contentLength > threshold", () => {
    const strategy = UploaderStrategyFactory.createStrategy({
      contentLength: 6_000_000,
      maxFileSize: 10_000_000,
      multipartThreshold: 5_000_000,
      multipartPartSize: 5_000_000,
      multipartConcurrency: 3,
    });
    expect(strategy).toBeInstanceOf(MultipartStrategy);
  });

  it("returns MultipartStrategy if contentLength = 0 (unknown)", () => {
    const strategy = UploaderStrategyFactory.createStrategy({
      contentLength: 0,
      maxFileSize: 10_000_000,
      multipartThreshold: 5_000_000,
      multipartPartSize: 5_000_000,
      multipartConcurrency: 3,
    });
    expect(strategy).toBeInstanceOf(MultipartStrategy);
  });
});
