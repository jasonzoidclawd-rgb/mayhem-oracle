import { AwsClient } from "aws4fetch";

// Cloudflare R2 via its S3-compatible API. Server-only (never import into a
// client bundle). $0: R2's first 10 GB and all egress are free.

export interface R2Storage {
  put(key: string, body: ArrayBuffer | string, contentType?: string): Promise<void>;
}

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function readConfig(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function createR2Storage(): R2Storage {
  const config = readConfig();
  if (!config) {
    // Fail loudly at call time, not import time, so unconfigured local/dev
    // environments still build and run everything except actual uploads.
    return {
      put: async () => {
        throw new Error(
          "R2 is not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET",
        );
      },
    };
  }

  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;

  return {
    async put(key, body, contentType = "application/json") {
      const response = await client.fetch(`${endpoint}/${key}`, {
        method: "PUT",
        body,
        headers: { "content-type": contentType },
      });
      if (!response.ok) {
        throw new Error(`R2 put failed: ${response.status} ${await response.text()}`);
      }
    },
  };
}
