import { FileTooLargeError } from "@app/errors";
import { Transform } from "node:stream";

export class ByteCountingTransform extends Transform {
  private totalBytes = 0;
  private maxSize: number;

  constructor(maxSize: number) {
    super();
    this.maxSize = maxSize;
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: Function,
  ) {
    this.totalBytes += chunk.length;
    if (this.totalBytes > this.maxSize) {
      callback(
        new FileTooLargeError(
          `File exceeded maxFileSize of ${this.maxSize} bytes.`,
        ),
      );
    } else {
      callback(null, chunk); // pass the chunk along
    }
  }
}
