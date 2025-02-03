/** Thrown when the remote file is larger than the allowed max size. */
export class FileTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileTooLargeError";
  }
}

/** Thrown when a remote request fails (e.g., 404, 5xx). */
export class RemoteServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteServerError";
  }
}

/** Thrown when a file has an unsupported content type. */
export class UnsupportedContentTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedContentTypeError";
  }
}
