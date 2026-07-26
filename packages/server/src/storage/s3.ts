import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { env } from '../env.js'

const s3 = new S3Client({
  endpoint: env.s3.endpoint,
  region: env.s3.region,
  forcePathStyle: env.s3.forcePathStyle,
  credentials: {
    accessKeyId: env.s3.accessKeyId,
    secretAccessKey: env.s3.secretAccessKey
  }
})

function objectKey(uuid: string): string {
  return `designs/${uuid}.fig`
}

export async function putDesignBytes(uuid: string, bytes: Uint8Array): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: objectKey(uuid),
      Body: bytes,
      ContentType: 'application/octet-stream'
    })
  )
}

export async function getDesignBytes(uuid: string): Promise<Uint8Array> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: env.s3.bucket, Key: objectKey(uuid) })
  )
  if (!result.Body) throw new Error(`No object body for design ${uuid}`)
  const buffer = await result.Body.transformToByteArray()
  return buffer
}
