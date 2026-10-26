-- Only needed if you already ran an earlier schema.sql without quorum/threshold.
alter table resolutions add column if not exists quorum int;
alter table resolutions add column if not exists threshold text not null default 'simple'
  check (threshold in ('simple', 'two_thirds'));
