import { describe, it, expect } from "vitest";
import {
  FileTooLargeError,
  RemoteServerError,
  UnsupportedContentTypeError,
} from "@app/errors";

describe("Custom Error Classes", () => {
  it("FileTooLargeError should have correct name and message", () => {
    const error = new FileTooLargeError("File is too big");
    expect(error.name).toBe("FileTooLargeError");
    expect(error.message).toBe("File is too big");
  });

  it("RemoteServerError should have correct name and message", () => {
    const error = new RemoteServerError("Server returned 500");
    expect(error.name).toBe("RemoteServerError");
    expect(error.message).toBe("Server returned 500");
  });

  it("UnsupportedContentTypeError should have correct name and message", () => {
    const error = new UnsupportedContentTypeError("Unknown MIME type");
    expect(error.name).toBe("UnsupportedContentTypeError");
    expect(error.message).toBe("Unknown MIME type");
  });
});
