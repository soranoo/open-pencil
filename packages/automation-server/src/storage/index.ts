import assertNever from 'assert-never'

import { env } from '@/env'

import { FsStorage } from './fs'
import type { Storage } from './interface'
import { S3Storage } from './s3'

export type { Storage } from './interface'

let storage: Storage

switch (env.STORE_PROVIDER) {
  case 's3': {
    if (
      !env.S3_ENDPOINT ||
      !env.S3_REGION ||
      !env.S3_BUCKET ||
      !env.S3_ACCESS_KEY_ID ||
      !env.S3_SECRET_ACCESS_KEY
    ) {
      throw new Error(
        'S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required when STORE_PROVIDER is set to s3.'
      )
    }

    storage = new S3Storage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY
      }
    })
    break
  }
  case 'fs': {
    storage = new FsStorage()
    break
  }
  default:
    assertNever(env.STORE_PROVIDER)
}

export function getStorage(): Storage {
  return storage
}
