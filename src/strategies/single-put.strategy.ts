import { request } from "undici";

import { RemoteServerError } from "@app/errors";
import { UploaderStrategyParams } from "@app/shared";
import { ByteCountingTransform } from "@app/utils";

/**
 * Uploads the file in one shot (PutObject).
 * Suitable for smaller files or known-size files below a threshold.
 */
export class SinglePutStrategy implements UploaderStrategy {
  public async uploadFile(params: UploaderStrategyParams): Promise<string> {
    const { sourceUrl, s3, bucket, key, contentType, maxFileSize } = params;

    const getResp = await request(sourceUrl);
    if (getResp.statusCode !== 200) {
      throw new RemoteServerError(
        `GET request failed for ${sourceUrl}, status: ${getResp.statusCode}`,
      );
    }

    // If the server doesn't provide a valid Content-Length, we must stream
    // and measure to ensure we don't exceed maxFileSize.
    if (!getResp.body) {
      throw new Error("Response has no body to stream.");
    }

    const nodeReadable = getResp.body; // Node.js Readable stream
    // Create a transform that checks size
    const countingTransform = new ByteCountingTransform(maxFileSize);

    // Now pipe node streams
    const pipedStream = nodeReadable.pipe(countingTransform);

    // Perform a single PutObject
    await s3.PutObject({
      Bucket: bucket,
      Key: key,
      Body: pipedStream,
      ContentType: contentType,
    });

    return key;
  }
}
