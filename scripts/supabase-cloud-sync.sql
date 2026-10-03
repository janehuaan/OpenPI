-- OpenPI 云端账号数据同步 —— Supabase 建表 + RLS（第一期）
-- 在目标 Supabase 项目的 SQL Editor 里整段执行一次即可（可重复执行）。
--
-- 设计要点：
--   * 每张表都带 user_id，主键 (user_id, id)，靠 RLS `auth.uid() = user_id` 隔离。
--   * anon key 是公开的；真正的隔离完全由 RLS 保证，所以每条策略都必须带 with check。
--   * updated_at 用于 Last-Write-Wins 合并；deleted_at 用于删除传播（软删）。
--   * 只同步：本地档案(key_values.profile) / 定时任务(tasks) / 运行记录(task_runs)。
--     API Key、会话历史、记忆等敏感数据不进云。

-- ── 本地档案 / 偏好（镜像 SQLite key_values） ──
create table if not exists public.cloud_kv (
  user_id    uuid        not null default auth.uid(),
  id         text        not null,                 -- 对应 key_values.key（第一期仅 "profile"）
  value      text        not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- ── 定时任务（镜像 SQLite tasks） ──
create table if not exists public.cloud_tasks (
  user_id    uuid        not null default auth.uid(),
  id         text        not null,
  title      text        not null,
  prompt     text        not null,
  cwd        text,
  schedule   text        not null,                 -- JSON 字符串，原样搬运
  status     text        not null,
  next_run_at text,
  model      text,
  steps      text,
  created_at text        not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- ── 任务运行记录（只增不改，便于多端查看历史） ──
create table if not exists public.cloud_task_runs (
  user_id    uuid        not null default auth.uid(),
  id         text        not null,
  task_id    text        not null,
  status     text        not null,
  trigger    text        not null,
  created_at text        not null,
  started_at text,
  finished_at text,
  exit_code  int,
  result     text,
  error      text,
  attempt    int,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- ── RLS ──
do $$
declare t text;
begin
  foreach t in array array['cloud_kv', 'cloud_tasks', 'cloud_task_runs']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists own_rows on public.%I;', t);
    execute format(
      'create policy own_rows on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t
    );
  end loop;
end $$;

-- ── 第二期：文件同步（记忆 memories/** + 技能 skills/** + 偏好 settings.json/app_settings.json） ──
create table if not exists public.cloud_files (
  user_id    uuid        not null default auth.uid(),
  path       text        not null,          -- 相对 ~/.openpi 的路径
  content    text        not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, path)
);
alter table public.cloud_files enable row level security;
drop policy if exists own_rows on public.cloud_files;
create policy own_rows on public.cloud_files
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 刷新 PostgREST schema 缓存
notify pgrst, 'reload schema';

