import { Pool } from "pg";

import type {
  Db,
  DesignMetadata,
  StoredGenerateRequestStatus,
  UpsertDesignParams,
} from "./interface";

export class PostgresDb implements Db {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async upsertDesignMetadata(params: UpsertDesignParams): Promise<void> {
    await this.pool.query(
      `insert into designs (id, owner_id, prompt_history, s3_key, updated_at)
       values ($1, $2, $3::jsonb, $4, now())
       on conflict (id) do update
         set prompt_history = excluded.prompt_history,
             s3_key = excluded.s3_key,
             updated_at = now()`,
      [params.id, params.ownerId ?? null, JSON.stringify(params.promptHistory), params.s3Key],
    );
  }

  async getDesignMetadata(id: string): Promise<DesignMetadata | null> {
    const result = await this.pool.query(
      `select id, owner_id, prompt_history, created_at, updated_at from designs where id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      ownerId: row.owner_id,
      promptHistory: row.prompt_history,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async upsertGenerateRequestStatus(status: StoredGenerateRequestStatus): Promise<void> {
    await this.pool.query(
      `insert into generate_requests (
         request_id,
         started_at,
         completed_at,
         queue_position,
         failed_at,
         saved_at,
         error,
         result,
         processing
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       on conflict (request_id) do update
         set started_at = excluded.started_at,
             completed_at = excluded.completed_at,
             queue_position = excluded.queue_position,
             failed_at = excluded.failed_at,
             saved_at = excluded.saved_at,
             error = excluded.error,
             result = excluded.result,
             processing = excluded.processing`,
      [
        status.requestId,
        status.startedAt,
        status.completedAt,
        status.queuePosition,
        status.failedAt,
        status.savedAt,
        status.error,
        JSON.stringify(status.result),
        status.processing,
      ],
    );
  }

  async getGenerateRequestStatus(requestId: string): Promise<StoredGenerateRequestStatus | null> {
    const result = await this.pool.query(
      `select
         request_id,
         started_at,
         completed_at,
         queue_position,
         failed_at,
         saved_at,
         error,
         result,
         processing
       from generate_requests
       where request_id = $1`,
      [requestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      requestId: row.request_id,
      startedAt: Number(row.started_at),
      completedAt: row.completed_at === null ? null : Number(row.completed_at),
      queuePosition: row.queue_position,
      failedAt: row.failed_at === null ? null : Number(row.failed_at),
      savedAt: row.saved_at === null ? null : Number(row.saved_at),
      error: row.error,
      result: row.result,
      processing: row.processing,
    };
  }

  async deleteGenerateRequestStatus(requestId: string): Promise<void> {
    await this.pool.query(`delete from generate_requests where request_id = $1`, [requestId]);
  }
}
