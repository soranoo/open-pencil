import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { Storage } from "./interface";
import { env } from "@/env";

function objectKey(designId: string): string {
  return `designs/${designId}.fig`;
}

export class S3Storage implements Storage {
  private client: S3Client;

  constructor({
    endpoint,
    region,
    forcePathStyle,
    credentials,
  }: {
    endpoint: string;
    region: string;
    forcePathStyle: boolean;
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
    };
  }) {
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials,
    });
  }

  async put(designId: string, bytes: Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: objectKey(designId),
        Body: bytes,
        ContentType: "application/octet-stream",
      }),
    );
  }

  async get(designId: string): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey(designId) }),
    );
    if (!result.Body) throw new Error(`No object body for design ${designId}`);
    return await result.Body.transformToByteArray();
  }

  async delete(designId: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey(designId) }),
    );
  }
}
