-- =========================================================
-- أقساطي — اشتراكات Web Push لـ Android PWA وSafari PWA
-- نفّذ هذا الملف مرة واحدة في Supabase SQL Editor.
-- =========================================================

create table if not exists fazatak_push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_phone text not null references fazatak_users(phone) on delete cascade,
  endpoint text unique not null,
  subscription jsonb not null,
  expiration_time bigint,
  timezone text default 'Asia/Riyadh',
  last_notification_key text,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

create index if not exists idx_fazatak_push_subscriptions_phone
  on fazatak_push_subscriptions(user_phone);

alter table fazatak_push_subscriptions enable row level security;

drop policy if exists "Allow all operations for anon on push subscriptions"
  on fazatak_push_subscriptions;

create policy "Allow all operations for anon on push subscriptions"
  on fazatak_push_subscriptions
  for all using (true) with check (true);
