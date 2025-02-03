import { SinglePutStrategy } from "./single-put.strategy";
import { MultipartStrategy } from "./multipart.strategy";

/**
 * Factory to decide which strategy to instantiate.
 */
export class UploaderStrategyFactory {
  public static createStrategy(
    opts: StrategyFactoryOptions,
  ): SinglePutStrategy | MultipartStrategy {
    const {
      contentLength,
      multipartThreshold,
      multipartPartSize,
      multipartConcurrency,
    } = opts;

    // If contentLength is known and below threshold => single PUT
    // Otherwise => multipart
    if (contentLength > 0 && contentLength < multipartThreshold) {
      return new SinglePutStrategy();
    }

    return new MultipartStrategy(multipartPartSize, multipartConcurrency);
  }
}
