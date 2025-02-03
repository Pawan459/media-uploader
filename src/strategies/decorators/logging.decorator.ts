import { UploaderStrategyParams } from "@app/shared";

/**
 * Decorator that logs the start/end of the upload process.
 * You can expand this to log each part upload, handle progress updates, etc.
 */
export class LoggingStrategyDecorator implements UploaderStrategy {
  private wrapped: UploaderStrategy;

  constructor(strategy: UploaderStrategy) {
    this.wrapped = strategy;
  }

  public async uploadFile(params: UploaderStrategyParams): Promise<string> {
    console.log(
      `Starting upload for ${params.sourceUrl} -> Key: ${params.key}`,
    );
    try {
      const result = await this.wrapped.uploadFile(params);
      console.log(`Finished upload -> Key: ${result}`);
      return result;
    } catch (err) {
      console.error(`Upload failed for ${params.sourceUrl}`, err);
      throw err;
    } finally {
      console.log(
        `Upload process finished for ${params.sourceUrl} -> Key: ${params.key} \n\n`,
      );
    }
  }
}
