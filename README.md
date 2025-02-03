# Media Uploader (Multipart + Single PUT)

A Node.js/TypeScript module that uploads files from a remote URL to an S3-compatible storage, supporting **multipart** uploads for large files and **single PUT** for smaller ones.

## Overview

This repository demonstrates:

1. **Two Strategies**:
   - **SinglePutStrategy** for smaller files
   - **MultipartStrategy** for larger or unknown-size files
2. **Streaming** approach to avoid loading entire files into memory
3. **Concurrency Control** for multipart uploads
4. **Error Handling** (e.g., too-large files, remote server errors, failing part uploads)
5. **Extensive Test Coverage** using **Vitest** and **mocks** for `undici` and the S3 client

## Table of Contents

- [Features](#features)
- [Folder Structure](#folder-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
  - [Single PUT Example](#single-put-example)
  - [Multipart Upload Example](#multipart-upload-example)
- [Testing](#testing)
  - [Running Tests](#running-tests)
  - [Mocks & Edge Cases](#mocks--edge-cases)
- [Key Files & Descriptions](#key-files--descriptions)
- [Common Issues](#common-issues)
- [Contributing](#contributing)
- [License](#license)

---

## Features

1. **Stream-Based Upload**

   - Avoids reading the entire file into memory
   - Uses **Node.js** streams for smaller files and **multipart** chunking for large files

2. **Multipart Upload**

   - Splits the remote file into parts (configurable size, default 5 MB)
   - Uploads parts **concurrently** (default concurrency 3)
   - Aborts upload if **any** part fails

3. **Error Handling**

   - **FileTooLargeError** if a file exceeds `maxFileSize`
   - **RemoteServerError** if remote URL returns a non-2xx status
   - **UnsupportedContentTypeError** for disallowed MIME types

4. **Configurable**

   - S3 settings (endpoint, region, keys, bucket)
   - Threshold for switching from single PUT to multipart
   - Max concurrency, max file size, part size

5. **Extensive Test Coverage with Vitest**
   - Mocks for **`undici.request`** calls (HEAD and GET)
   - Mocks for **S3** client calls (PutObject, CreateMultipartUpload, UploadPart, CompleteMultipartUpload, AbortMultipartUpload)
   - Edge cases: missing body, large file, failing part, concurrency checks

---

## Folder Structure

```
.
├── README.md
├── LICENSE
├── nodemon.json
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── constants/
│   │   └── index.ts
│   ├── errors/
│   │   ├── __tests__/
│   │   │   └── errors.test.ts
│   │   ├── error.ts
│   │   ├── index.ts
│   ├── shared/
│   │   ├── index.ts
│   │   ├── interface.ts
│   ├── strategies/
│   │   ├── __tests__/
│   │   │   ├── decorators/
│   │   │   │   └── logging.decorator.test.ts
│   │   │   ├── single-put.strategy.test.ts
│   │   │   ├── multipart.strategy.test.ts
│   │   │   └── strategy-factory.test.ts
│   │   ├── single-put.strategy.ts
│   │   ├── multipart.strategy.ts
│   │   ├── strategy-factory.ts
│   │   ├── decorators/
│   │   │   └── logging.decorator.ts
│   │   └── index.ts
│   ├── tmp/
│   │   └── fixtures.json
│   │   └── index.ts
│   ├── types/
│   │   └── aws-lite-s3.d.ts
│   ├── utils/
│   │   ├── ByteCountingTransform.ts
│   │   ├── index.ts
│   └── media.ts
│   └── media.test.ts
│   └── main.ts
```

---

## Prerequisites

- **Node.js** ≥ 18 (recommended)
- **pnpm**
- **Vitest** for testing (installed as a dev dependency)
- Optionally, **Docker** + **MinIO** (or any S3-compatible service) for local integration tests

---

## Installation

1. **Clone** the repository:

   ```bash
   git clone https://github.com/Pawan459/media-uploader.git
   ```

2. **Install** dependencies:

   ```bash
   cd media-uploader
   pnpm install
   ```

3. **Build** (optional if using TS directly):

   ```bash
   pnpm build
   ```

4. **Run** the main script:

   ```bash
   pnpm start
   ```

5. **Run** the tests:

   ```bash
   pnpm test
   ```

---

## Usage

Below is an **example** usage with a **`Media`** class that picks Single vs. Multipart.  
Typically:

```ts
import { Media } from "./media"; // adjust path

async function main() {
  const media = new Media({
    s3Endpoint: "http://localhost:9000",
    s3Region: "us-east-1",
    bucket: "my-bucket",
    accessKeyId: "dummy",
    secretAccessKey: "dummy",
    multipartThreshold: 5 * 1024 * 1024, // 5MB
    multipartPartSize: 5 * 1024 * 1024,
    multipartConcurrency: 3,
  });

  try {
    const key = await media.uploadUrl({
      sourceUrl: "https://example.com/large-video.mp4",
      destinationDir: "videos",
      maxFileSize: 50 * 1024 * 1024, // 50MB
    });
    console.log("Uploaded with key:", key);
  } catch (err) {
    console.error("Upload failed:", err);
  }
}

main();
```

### Single PUT Example

If your HEAD request shows a `Content-Length` < `multipartThreshold`, the code automatically uses **`SinglePutStrategy`**. It streams the file once, does `PutObject`, and returns the final key.

### Multipart Upload Example

If the file is **bigger** than `multipartThreshold` or the `Content-Length` is missing, it uses **`MultipartStrategy`**, splitting the file into parts. Each part is uploaded in parallel up to `multipartConcurrency`. If any part fails, the upload is **aborted**.

---

## Testing

We use **Vitest** for testing, with **mocks** for both:

- **`undici.request`**: We simulate HEAD and GET calls in memory, returning custom status codes, headers, and Node streams.
- **S3**: We mock `PutObject`, `CreateMultipartUpload`, `UploadPart`, etc. to test concurrency, large-file handling, and part-failure scenarios.

### Running Tests

```bash
pnpm test
# or
pnpm vitest
```

### Mocks & Edge Cases

1. **HEAD 404** or 5xx => throws `RemoteServerError`
2. **Content-Length** > `maxFileSize` => throws `FileTooLargeError`
3. Missing `Content-Length` => defaults to multipart (part streaming)
4. Any part upload failing => entire upload is aborted (`AbortMultipartUpload`), top-level rejects
5. SinglePut => if the file stream grows beyond maxFileSize mid-read, it aborts

---

## Key Files & Descriptions

- **`src/media.ts`**  
  The main entry point. Orchestrates the HEAD request, picks single vs. multipart strategy (via a factory).
- **`src/strategies/single-put.strategy.ts`**  
  Streams the file in one go.
- **`src/strategies/multipart.strategy.ts`**  
  Splits the file, concurrency gating, aborts on error.
- **`src/errors.ts`**  
  Custom errors: `FileTooLargeError`, `RemoteServerError`, `UnsupportedContentTypeError`.
- **`tests/strategies/multipart-strategy.test.ts`**  
  Demonstrates concurrency, failing parts, large-file checks.

---

## Contributing

We welcome contributions! Feel free to:

- **Open Issues** for bugs or feature requests.
- **Fork** and submit a Pull Request.
- Add or improve tests, especially for advanced edge cases (multipart resuming, very large files, etc.).

Please follow the [Conventional Commits](https://www.conventionalcommits.org/) style if possible.

---

## License

This project is licensed under the **MIT License**. See [LICENSE](./LICENSE) for details.

---

**Happy uploading!** If you have any questions or run into issues, don’t hesitate to open an issue or pull request.
