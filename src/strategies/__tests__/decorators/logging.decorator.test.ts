import { describe, it, expect, vi, beforeEach } from 'vitest';

import { UploaderStrategyParams } from '@app/shared';
import { LoggingStrategyDecorator } from '@app/strategies';

describe('LoggingStrategyDecorator', () => {
  let mockStrategy: UploaderStrategy;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    mockStrategy = {
      uploadFile: vi.fn()
    };
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
  });

  it('logs on success', async () => {
    mockStrategy.uploadFile = vi.fn().mockResolvedValue('some/key');

    const decorator = new LoggingStrategyDecorator(mockStrategy);
    const params: UploaderStrategyParams = {
      sourceUrl: 'https://example.com/test.bin',
      s3: {} as any,
      bucket: 'test-bucket',
      key: 'test.bin',
      contentType: 'application/octet-stream',
      maxFileSize: 100_000,
    };

    const res = await decorator.uploadFile(params);
    expect(res).toBe('some/key');

    expect(consoleLogSpy).toHaveBeenCalledWith(
      `Starting upload for https://example.com/test.bin -> Key: test.bin`
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      `Finished upload -> Key: some/key`
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('logs on error', async () => {
    const mockError = new Error('strategy fails');
    mockStrategy.uploadFile = vi.fn().mockRejectedValue(mockError);

    const decorator = new LoggingStrategyDecorator(mockStrategy);
    const params: UploaderStrategyParams = {
      sourceUrl: 'https://example.com/test.bin',
      s3: {} as any,
      bucket: 'test-bucket',
      key: 'test.bin',
      contentType: 'application/octet-stream',
      maxFileSize: 100_000,
    };

    await expect(decorator.uploadFile(params)).rejects.toThrow('strategy fails');

    expect(consoleLogSpy).toHaveBeenCalledWith(
      `Starting upload for https://example.com/test.bin -> Key: test.bin`
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `Upload failed for https://example.com/test.bin`,
      mockError
    );
  });
});
