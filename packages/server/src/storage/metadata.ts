import { Pool } from 'pg'
import type { ModelMessage } from 'ai'

import { env } from '../env.js'

const pool = new Pool({ connectionString: env.databaseUrl })

export interface DesignMetadata {
  id: string
  ownerId: string | null
  promptHistory: ModelMessage[]
  createdAt: string
  updatedAt: string
}

export async function upsertDesignMetadata(params: {
  id: string
  ownerId?: string | null
  promptHistory: ModelMessage[]
  s3Key: string
}): Promise<void> {
  await pool.query(
    `insert into designs (id, owner_id, prompt_history, s3_key, updated_at)
     values ($1, $2, $3::jsonb, $4, now())
     on conflict (id) do update
       set prompt_history = excluded.prompt_history,
           s3_key = excluded.s3_key,
           updated_at = now()`,
    [params.id, params.ownerId ?? null, JSON.stringify(params.promptHistory), params.s3Key]
  )
}

export async function getDesignMetadata(id: string): Promise<DesignMetadata | null> {
  const result = await pool.query(
    `select id, owner_id, prompt_history, created_at, updated_at from designs where id = $1`,
    [id]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: row.id,
    ownerId: row.owner_id,
    promptHistory: row.prompt_history,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
