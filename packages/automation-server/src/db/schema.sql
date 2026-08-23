create table if not exists designs (
  id uuid primary key,
  owner_id text,
  prompt_history jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  s3_key text not null
);

create index if not exists designs_owner_id_idx on designs (owner_id);

create table if not exists generate_requests (
  request_id uuid primary key,
  started_at bigint not null,
  completed_at bigint,
  queue_position integer,
  failed_at bigint,
  saved_at bigint,
  error text,
  result jsonb,
  processing boolean not null default false
);
