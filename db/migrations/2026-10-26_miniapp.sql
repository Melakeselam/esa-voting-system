-- Mini App support: key/value settings, known assembly group topics,
-- and admins managed from the app (in addition to ADMIN_TELEGRAM_IDS).
-- Safe to run on an existing database.

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Forum topics the bot has seen in the assembly group. thread_id 0 = General.
create table if not exists chat_topics (
  chat_id    bigint not null,
  thread_id  bigint not null default 0,
  name       text,
  chat_title text,
  updated_at timestamptz not null default now(),
  primary key (chat_id, thread_id)
);

-- Additional admins added from the Mini App (env ADMIN_TELEGRAM_IDS still apply).
create table if not exists admins (
  telegram_user_id bigint primary key,
  name             text,
  added_by         text,
  created_at       timestamptz not null default now()
);

alter table app_settings enable row level security;
alter table chat_topics  enable row level security;
alter table admins       enable row level security;
