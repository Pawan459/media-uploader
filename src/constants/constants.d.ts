type FileType = "text" | "image" | "video" | "file";

// Enforcing the strict key pattern "{random-name}_{file-type}"
type FileKey = `${string}_${FileType}`;

type FileLinks = Record<FileKey, string>;

type FormattedDataKeys = `${FileType}s`;

type FormattedData = Record<FormattedDataKeys, string[]>;
