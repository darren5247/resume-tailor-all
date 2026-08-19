import path from "node:path";
import { del, get, put } from "@vercel/blob";
import { isEphemeralFs } from "./db";
import { readFileBuffer } from "./paths";
import type { DownloadRef } from "./pipeline/types";

const CONTENT_TYPES: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

export function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

export function blobRequired(): boolean {
  return isEphemeralFs();
}

export async function attachBlobDownloads(
  runId: string,
  folderName: string,
  downloads: Array<DownloadRef & { absolute: string }>,
): Promise<DownloadRef[]> {
  if (!blobRequired()) {
    return downloads.map(({ absolute: _absolute, ...meta }) => meta);
  }
  if (!blobConfigured()) {
    throw new Error(
      "Connect a Blob store in the Vercel dashboard (Storage → Blob), then redeploy, so generated resumes can be downloaded.",
    );
  }

  const uploaded: DownloadRef[] = [];
  for (const { absolute, ...meta } of downloads) {
    const body = await readFileBuffer(absolute);
    const blob = await put(`runs/${runId}/${folderName}/${path.basename(absolute)}`, body, {
      access: "private",
      addRandomSuffix: true,
      contentType: CONTENT_TYPES[path.extname(absolute).toLowerCase()] ?? "application/octet-stream",
      multipart: body.byteLength > 4_500_000,
    });
    uploaded.push({ ...meta, blobUrl: blob.url });
  }
  return uploaded;
}

export async function deleteBlobs(urls: Array<string | undefined>): Promise<void> {
  const targets = urls.filter((url): url is string => Boolean(url));
  if (targets.length === 0 || !blobConfigured()) return;
  await del(targets).catch(() => undefined);
}

export async function readBlobBuffer(url: string): Promise<Buffer> {
  const result = await get(url, { access: "private" });
  if (!result || result.statusCode !== 200) throw new Error("File not found");
  const chunks: Uint8Array[] = [];
  const reader = result.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function streamBlob(url: string): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
}> {
  const result = await get(url, { access: "private" });
  if (!result || result.statusCode !== 200) throw new Error("File not found");
  return {
    stream: result.stream,
    contentType: result.blob.contentType,
    size: result.blob.size,
  };
}
