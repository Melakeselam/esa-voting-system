-- Only needed if you already ran an earlier schema.sql without closes_at.
alter table resolutions add column if not exists closes_at timestamptz;
