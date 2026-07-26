import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { env } from '@/env'

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY
  }
})

function objectKey(uuid: string): string {
  return `designs/${uuid}.fig`
}

export async function putDesignBytes(uuid: string, bytes: Uint8Array): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: objectKey(uuid),
      Body: bytes,
      ContentType: 'application/octet-stream'
    })
  )
}

export async function getDesignBytes(uuid: string): Promise<Uint8Array> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey(uuid) })
  )
  if (!result.Body) throw new Error(`No object body for design ${uuid}`)
  const buffer = await result.Body.transformToByteArray()
  return buffer
}
