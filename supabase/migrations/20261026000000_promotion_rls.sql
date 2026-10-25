-- public.promotion 的 RLS 策略（幂等：可重复执行，结果一致）
-- 真源：scripts/rls-policy-spec.mjs —— 改策略请改那里并重跑 pnpm test，不要手改本文件。
-- 语义依据：docs/mcp-design.md §3.5。
-- 合入本文件不等于已上线：执行到共享 Supabase 库需要 leoking 逐次批准。

alter table public.promotion enable row level security;

-- 读：公开读已上架的（网站匿名读 + 任意已认证用户的 MCP 读都命中这条）
drop policy if exists "promotion_select_active" on public.promotion;
create policy "promotion_select_active"
  on public.promotion for select
  using (is_active = true);

-- 读：管理员可读全部（含已下架），缺失时 includeInactive=true 会静默返回空集
drop policy if exists "promotion_select_admin" on public.promotion;
create policy "promotion_select_admin"
  on public.promotion for select
  using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

-- 写：仅管理员（insert/update/delete）
drop policy if exists "promotion_write_admin" on public.promotion;
create policy "promotion_write_admin"
  on public.promotion for all
  using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  with check (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');
