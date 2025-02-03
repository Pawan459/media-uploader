import { Media } from "./media";
import { FIXURES_DATA, MAX_FILE_SIZE } from "@app/constants";

async function main() {
  function getUploadConfigs() {
    const uploads = [];

    for (const [key, value] of Object.entries(FIXURES_DATA)) {
      const destinationDir = key;
      for (const sourceUrl of value) {
        uploads.push({
          sourceUrl,
          destinationDir,
          maxFileSize: MAX_FILE_SIZE,
        });
      }
    }

    return uploads;
  }

  const media = new Media({
    s3Endpoint: "http://localhost:9000",
    s3Region: "us-east-1",
    bucket: "dummy-bucket",
    accessKeyId: "dummy-user",
    secretAccessKey: "dummy-password",
    multipartThreshold: 5 * 1024 * 1024, // 5MB
    multipartPartSize: 5 * 1024 * 1024,
    multipartConcurrency: 4,
  });

  const uploadConfigs = getUploadConfigs();

  for (const uploadConfig of uploadConfigs) {
    try {
      const key = await media.uploadUrl(uploadConfig);
      console.log(`Upload success, key=${key}`);
    } catch (error) {
      console.error(`Upload failed:`, error);
    }
  }
}

main().catch(console.error);
