// Central place for env parsing. Fails fast on boot if something required is missing,
// rather than deep inside a request handler.

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const env = {
  port: Number(process.env.PORT ?? 8787),

  ai: {
    providerID: required('AI_PROVIDER_ID'),
    apiKey: required('AI_API_KEY'),
    modelID: process.env.AI_MODEL_ID ?? '',
    customModelID: process.env.AI_CUSTOM_MODEL_ID ?? '',
    customBaseURL: process.env.AI_CUSTOM_BASE_URL ?? '',
    customAPIType: (process.env.AI_CUSTOM_API_TYPE as 'completions' | 'responses') ?? 'completions',
    maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 8192)
  },

  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'auto',
    bucket: required('S3_BUCKET'),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true'
  },

  databaseUrl: required('DATABASE_URL'),

  sessionTTLMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 30),

  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173'
}
