// `promotion` 表 RLS 的唯一真源。
// migration 工件（supabase/migrations/*_promotion_rls.sql）与 `verify-mcp.mjs` 的数据库断言都由本文件生成，
// 语义依据 docs/mcp-design.md §3.5；漂移由 scripts/rls-policy-spec.test.mjs 拦下。
// 本文件只描述期望状态：它不会连接数据库，也不代表任何库已执行过这些语句。

export const RLS_TARGET = Object.freeze({
  schema: "public",
  table: "promotion",
  qualified: "public.promotion",
})

// 管理员判据与 `server/utils/auth-identity.ts` 的 `isAdminUser()` 必须同义：只认 app_metadata。
const ADMIN_ROLE_PREDICATES = Object.freeze(["auth.jwt()", "app_metadata", "role", "admin"])

// 策略里出现 client 可写的 user_metadata 即为越权面（§3.5「两层的判据必须一致」）。
const FORBIDDEN_PREDICATES = Object.freeze(["user_metadata"])

export const RLS_POLICIES = Object.freeze([
  Object.freeze({
    name: "promotion_select_active",
    command: "SELECT",
    using: "is_active = true",
    withCheck: null,
    label: "存在仅允许读取上架记录的 promotion_select_active 策略",
    comment: "读：公开读已上架的（网站匿名读 + 任意已认证用户的 MCP 读都命中这条）",
    requiredPredicates: Object.freeze(["is_active", "true"]),
  }),
  Object.freeze({
    name: "promotion_select_admin",
    command: "SELECT",
    using: "auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'",
    withCheck: null,
    label: "存在基于 app_metadata.role 的 promotion_select_admin 策略",
    comment: "读：管理员可读全部（含已下架），缺失时 includeInactive=true 会静默返回空集",
    requiredPredicates: ADMIN_ROLE_PREDICATES,
  }),
  Object.freeze({
    name: "promotion_write_admin",
    command: "ALL",
    using: "auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'",
    withCheck: "auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'",
    label: "存在基于 app_metadata.role 的 promotion_write_admin 策略",
    comment: "写：仅管理员（insert/update/delete）",
    requiredPredicates: ADMIN_ROLE_PREDICATES,
  }),
])

// Supabase CLI Migration 约定的时间戳前缀（文件名 <ts>_<name>.sql）。
export const MIGRATION_TIMESTAMP = "20261026000000"
export const MIGRATION_FILE_NAME = "promotion_rls.sql"

function normalizeExpression(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "")
}

function isAlwaysTrue(value) {
  return normalizeExpression(value) === "true"
}

function missingPredicates(expression, predicates) {
  const haystack = normalizeExpression(expression)
  return predicates.filter(predicate => !haystack.includes(predicate.toLowerCase()))
}

function forbiddenPredicates(expression) {
  const haystack = normalizeExpression(expression)
  return FORBIDDEN_PREDICATES.filter(predicate => haystack.includes(predicate))
}

export function renderPolicySql(policy) {
  const body = [
    `create policy "${policy.name}"`,
    `  on ${RLS_TARGET.qualified} for ${policy.command.toLowerCase()}`,
    `  using (${policy.using})`,
  ]
  if (policy.withCheck) body.push(`  with check (${policy.withCheck})`)
  body[body.length - 1] += ";"
  return [
    `-- ${policy.comment}`,
    `drop policy if exists "${policy.name}" on ${RLS_TARGET.qualified};`,
    ...body,
  ].join("\n")
}

export function renderMigrationSql() {
  return [
    `-- ${RLS_TARGET.qualified} 的 RLS 策略（幂等：可重复执行，结果一致）`,
    "-- 真源：scripts/rls-policy-spec.mjs —— 改策略请改那里并重跑 pnpm test，不要手改本文件。",
    "-- 语义依据：docs/mcp-design.md §3.5。",
    "-- 合入本文件不等于已上线：执行到共享 Supabase 库需要 leoking 逐次批准。",
    "",
    `alter table ${RLS_TARGET.qualified} enable row level security;`,
    "",
    RLS_POLICIES.map(renderPolicySql).join("\n\n"),
    "",
  ].join("\n")
}

export function migrationFileName() {
  return `${MIGRATION_TIMESTAMP}_${MIGRATION_FILE_NAME}`
}

export function rlsVerificationQueries() {
  return {
    table: `
      select c.relrowsecurity as enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = '${RLS_TARGET.schema}' and c.relname = '${RLS_TARGET.table}'
    `,
    policies: `
      select policyname, cmd, qual, with_check
      from pg_policies
      where schemaname = '${RLS_TARGET.schema}' and tablename = '${RLS_TARGET.table}'
      order by policyname
    `,
  }
}

function evaluatePolicy(policy, row) {
  if (!row) return { ok: false, detail: `目标库没有 ${policy.name}；期望见 ${migrationFileName()}` }
  const actualCommand = String(row.cmd ?? "").toUpperCase()
  if (actualCommand !== policy.command) return { ok: false, detail: `${policy.name} 的 cmd 是 ${actualCommand}，工件要求 ${policy.command}` }
  if (isAlwaysTrue(row.qual)) return { ok: false, detail: `${policy.name} 的 using 恒真（RLS 被写宽成放行）` }
  const forbidden = forbiddenPredicates(`${row.qual} ${row.with_check}`)
  if (forbidden.length) return { ok: false, detail: `${policy.name} 引用了客户端可改的 ${forbidden.join(" / ")}，不得出现在策略里` }
  const usingMissing = missingPredicates(row.qual, policy.requiredPredicates)
  if (usingMissing.length) return { ok: false, detail: `${policy.name} 的 using 缺少 ${usingMissing.join(" / ")}` }
  if (policy.withCheck) {
    if (!String(row.with_check ?? "").trim()) return { ok: false, detail: `${policy.name} 缺少 with check，写入侧未受约束` }
    if (isAlwaysTrue(row.with_check)) return { ok: false, detail: `${policy.name} 的 with check 恒真` }
    const checkMissing = missingPredicates(row.with_check, policy.requiredPredicates)
    if (checkMissing.length) return { ok: false, detail: `${policy.name} 的 with check 缺少 ${checkMissing.join(" / ")}` }
  }
  return { ok: true, detail: "" }
}

/**
 * 把只读查询结果（`pg_class.relrowsecurity` + `pg_policies` 行）对照到工件期望。
 * 返回的每一项都是 `{ label, ok, detail }`，由调用方决定如何记账或失败。
 */
export function evaluateRlsState({ rlsEnabled, policies }) {
  const rows = new Map((policies ?? []).map(row => [row.policyname, row]))
  const checks = [
    {
      label: `${RLS_TARGET.table} 表存在且已启用 RLS`,
      ok: rlsEnabled === true,
      detail: rlsEnabled === true ? "" : `relrowsecurity=${rlsEnabled === undefined ? "查询无结果" : rlsEnabled}`,
    },
    ...RLS_POLICIES.map(policy => ({ ...evaluatePolicy(policy, rows.get(policy.name)), label: policy.label })),
  ]
  const expected = new Set(RLS_POLICIES.map(policy => policy.name))
  const unexpected = [...rows.keys()].filter(name => !expected.has(name)).sort()
  checks.push({
    label: "目标库策略集合与仓库工件一致（无未登记的额外策略）",
    ok: unexpected.length === 0,
    detail: unexpected.length ? `未登记：${unexpected.join(" / ")}` : "",
  })
  return checks
}
