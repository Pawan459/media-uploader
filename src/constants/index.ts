import { DEFAULT_MOCK_DATA } from "@app/tmp";

const VALID_TYPES: FileType[] = ["text", "image", "video", "file"];

const DEFAULT_FORMATTED_DATA: FormattedData = {
  texts: [],
  images: [],
  videos: [],
  files: [],
};

function createFixturesData(data: FileLinks): Readonly<FormattedData> {
  if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
    throw new Error("Invalid data provided");
  }

  const formattedData = Object.entries(data).reduce((acc, [key, value]) => {
    const [name, type] = key.split("_");
    if (!name || !type) {
      throw new Error("Invalid key format");
    }

    if (!VALID_TYPES.includes(type as FileType)) {
      throw new Error("Invalid type");
    }

    const formattedKey = `${type}s` as FormattedDataKeys;

    return {
      ...acc,
      [formattedKey]: [...acc[formattedKey], value],
    };
  }, DEFAULT_FORMATTED_DATA);

  return Object.freeze(formattedData);
}

export const FIXURES_DATA = createFixturesData(DEFAULT_MOCK_DATA);

export const MAX_FILE_SIZE = 200 * 1024 * 1024;
