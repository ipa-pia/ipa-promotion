// `promotion` 表 RLS 的唯一真源。
// migration 工件（supabase/migrations/*_promotion_rls.sql）与 `verify-mcp.mjs` 的数据库断言都由本文件生成，
// 语义依据 docs/mcp-design.md §3.5；漂移由 scripts/rls-policy-spec.test.mjs 拦下。
// 本文件只描述期望状态：它不会连接数据库，也不代表任何库已执行过这些语句。

export const RLS_TARGET = Object.freeze({
  schema: "public",
  table: "promotion",
  qualified: "public.promotion",
})

// 策略里出现 client 可写的 user_metadata / raw_user_meta_data 即为越权面（§3.5「两层的判据必须一致」）。
// `raw_user_meta_data` 是 auth.users 的列拼写，不含 "user_metadata" 子串，必须单列。
const FORBIDDEN_PREDICATES = Object.freeze(["user_metadata", "raw_user_meta_data"])

// 工件的 create policy 不带 `to`/`as`，隐含语义就是 `to public as permissive`：
// roles 决定"谁能命中这条策略"（收窄到 authenticated 会让匿名读整片落空），
// permissive 决定"多条策略之间是 OR 还是 AND"（restrictive 会把公开读 AND 掉）。
// 这两列必须显式比对，否则同名同判据的写宽/收窄看不见。
//
// 静态绑定：`["public"] + permissive` 是工件省略 `to`/`as` 时唯一自洽的取值，由
// rls-policy-spec.test.mjs 的「to/as 不变量」用例钉住。真要按角色分授（例如公开读拆成
// anon + authenticated），必须同时让 renderPolicySql() 显式渲染 `to …`/`as …` 并同步 §3.5
// 的 SQL 块——只改这两行期望会让工件与断言各走各的，而且只有连上真实库才暴露。
const EXPECTED_ROLES = Object.freeze(["public"])
const EXPECTED_PERMISSIVE = true

// `public` 是角色全集：工件已授 public 时，多出来的角色是等价冗余声明；
// 工件没授 public 时，多出来的角色才是真正的授权面扩大。
const UNIVERSAL_ROLE = "public"

export const RLS_POLICIES = Object.freeze([
  Object.freeze({
    name: "promotion_select_active",
    command: "SELECT",
    using: "is_active = true",
    withCheck: null,
    roles: EXPECTED_ROLES,
    permissive: EXPECTED_PERMISSIVE,
    label: "存在仅允许读取上架记录的 promotion_select_active 策略",
    comment: "读：公开读已上架的（网站匿名读 + 任意已认证用户的 MCP 读都命中这条）",
  }),
  Object.freeze({
    name: "promotion_select_admin",
    command: "SELECT",
    using: "auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'",
    withCheck: null,
    roles: EXPECTED_ROLES,
    permissive: EXPECTED_PERMISSIVE,
    label: "存在基于 app_metadata.role 的 promotion_select_admin 策略",
    comment: "读：管理员可读全部（含已下架），缺失时 includeInactive=true 会静默返回空集",
  }),
  Object.freeze({
    name: "promotion_write_admin",
    command: "ALL",
    using: "auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'",
    withCheck: "auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'",
    roles: EXPECTED_ROLES,
    permissive: EXPECTED_PERMISSIVE,
    label: "存在基于 app_metadata.role 的 promotion_write_admin 策略",
    comment: "写：仅管理员（insert/update/delete）",
  }),
])

// Supabase CLI Migration 约定的时间戳前缀（文件名 <ts>_<name>.sql）。
export const MIGRATION_TIMESTAMP = "20261026000000"
export const MIGRATION_FILE_NAME = "promotion_rls.sql"

const UNRECOGNISED = "未识别形状，需人工复核"
const UNRECOGNISED_REDUNDANT = "未识别形状·等价冗余·需人工复核"

function normalizeExpression(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "")
}

function isAlwaysTrue(value) {
  return normalizeExpression(value) === "true"
}

// 只剥"分组括号"（前面不是标识符字符的左括号），保留 `auth.jwt()` 这类调用括号。
function stripGroupingParens(expression) {
  const dropped = new Set()
  const openers = []
  for (let index = 0; index < expression.length; index++) {
    const char = expression[index]
    if (char === "(") {
      openers.push({ index, grouping: !/[\w]/.test(expression[index - 1] ?? "") })
    }
    else if (char === ")") {
      const opener = openers.pop()
      if (!opener) break
      if (opener.grouping) {
        dropped.add(opener.index)
        dropped.add(index)
      }
    }
  }
  return [...expression].filter((char, index) => !dropped.has(index)).join("")
}

// Postgres 的 pg_policies 存的是 deparse 后的表达式，与工件写法必有差异（补括号、补表限定符、补 ::text）。
// 规范化到同一形状后做**整串相等**比对：词元子串匹配会被 `判据 OR (true)`、`<> 'notadmin'`、`IN ('admin', …)`
// 这类等价写宽蒙过去，整串相等不会。
function canonicalExpression(value) {
  const castFree = normalizeExpression(value).replaceAll("::text", "")
  return stripGroupingParens(
    castFree
      .replaceAll(`${RLS_TARGET.qualified}.`, "")
      .replaceAll(`${RLS_TARGET.table}.`, ""),
  )
}

function roleNames(value) {
  const names = Array.isArray(value)
    ? value.map(String)
    : String(value ?? "").replace(/^\{|\}$/g, "").split(",")
  return names.map(name => name.trim().toLowerCase()).filter(Boolean).sort()
}

function showValue(value) {
  if (value === null || value === undefined) return "（空）"
  if (Array.isArray(value)) return value.length ? value.map(item => `"${item}"`).join(", ") : "（空数组）"
  if (typeof value === "string") return `"${value}"`
  return String(value)
}

function rawState(row) {
  return `原始 qual=${showValue(row.qual)} / with_check=${showValue(row.with_check)} / roles=${showValue(row.roles)} / permissive=${showValue(row.permissive)}`
}

function forbiddenPredicates(expression) {
  const haystack = normalizeExpression(expression)
  return FORBIDDEN_PREDICATES.filter(predicate => haystack.includes(predicate))
}

function compareExpression(policy, field, actual) {
  const expected = field === "with_check" ? policy.withCheck : policy.using
  if (!String(actual ?? "").trim()) return `${policy.name} 的 ${field} 为空，工件要求 ${expected}`
  if (isAlwaysTrue(actual)) return `${policy.name} 的 ${field} 恒真（RLS 被写宽成放行）`
  const normalized = canonicalExpression(actual)
  if (!normalized) return `${policy.name} 的 ${field} 规范化后为空，${UNRECOGNISED}；工件要求 ${expected}`
  if (normalized !== canonicalExpression(expected)) {
    return `${policy.name} 的 ${field} 与工件不是同一表达式，${UNRECOGNISED}；工件要求 ${expected}`
  }
  return null
}

// 授权面分三种不符：缺少工件要求的角色＝真实收窄；多出角色但工件已授 public＝等价冗余；
// 多出角色且工件没授 public＝授权面扩大。三者都判失败，但只有后两种的复核方向不同。
function evaluateRoles(policy, row) {
  if (row.roles === undefined || row.roles === null) return `${policy.name} 的 roles 缺失，${UNRECOGNISED}`
  const actual = roleNames(row.roles)
  const expected = [...policy.roles].sort()
  const missing = expected.filter(role => !actual.includes(role))
  const extra = actual.filter(role => !expected.includes(role))
  if (missing.length) return `${policy.name} 的授权面比工件窄：缺少 ${missing.join(" / ")}，这些角色命中不到该策略；工件要求 ${expected.join(" / ")}`
  if (extra.length) {
    if (expected.includes(UNIVERSAL_ROLE)) {
      return `${policy.name} 的 roles 多出 ${extra.join(" / ")}；工件已授 ${UNIVERSAL_ROLE}（角色全集），多出的是等价冗余声明，${UNRECOGNISED_REDUNDANT}`
    }
    return `${policy.name} 的授权面比工件宽：多出 ${extra.join(" / ")}，工件只授 ${expected.join(" / ") || "（无）"}`
  }
  return null
}

function evaluatePolicy(policy, row) {
  if (!row) return { ok: false, detail: `目标库没有 ${policy.name}；期望见 ${migrationFileName()}` }

  const failures = []
  const actualCommand = String(row.cmd ?? "").toUpperCase()
  if (actualCommand !== policy.command) failures.push(`${policy.name} 的 cmd 是 ${actualCommand}，工件要求 ${policy.command}`)

  if (typeof row.permissive === "boolean") {
    if (row.permissive !== policy.permissive) failures.push(`${policy.name} 是 ${row.permissive ? "permissive" : "restrictive"}，工件要求 as permissive`)
  }
  else {
    failures.push(`${policy.name} 的 permissive 不是布尔值，${UNRECOGNISED}`)
  }

  const rolesMismatch = evaluateRoles(policy, row)
  if (rolesMismatch) failures.push(rolesMismatch)

  const forbidden = forbiddenPredicates(`${row.qual} ${row.with_check}`)
  if (forbidden.length) failures.push(`${policy.name} 引用了客户端可改的 ${forbidden.join(" / ")}，不得出现在策略里`)

  for (const field of ["qual", "with_check"]) {
    if (field === "with_check" && !policy.withCheck) {
      if (String(row.with_check ?? "").trim()) failures.push(`${policy.name} 是只读策略却带 with check ${row.with_check}，工件未登记`)
      continue
    }
    const mismatch = compareExpression(policy, field, row[field])
    if (mismatch) failures.push(mismatch)
  }

  if (!failures.length) return { ok: true, detail: "" }
  return { ok: false, detail: `${failures.join("；")}；${rawState(row)}` }
}

// 未登记策略的叠加方向取决于 permissive：permissive 之间 OR（放宽），restrictive 与它们 AND（收窄）。
// 所以只报"是放宽"会把复核方向带偏，必须附原文让复核者自己定性。
function describeUnregistered(rows) {
  const lines = rows.map(row => `${row.policyname}（cmd=${showValue(row.cmd)} / permissive=${showValue(row.permissive)} / roles=${showValue(row.roles)} / qual=${showValue(row.qual)}）`)
  const permissive = rows.filter(row => row.permissive === true).length
  const restrictive = rows.filter(row => row.permissive === false).length
  const direction = permissive && restrictive
    ? `其中 permissive 的与工件三条 OR 叠加（放宽），restrictive 的再与之 AND 叠加（收窄）——两个方向同时存在`
    : permissive
        ? "都是 permissive：与工件三条 OR 叠加，方向是放宽；工件不删除未登记策略，重放成功也收不回来"
        : restrictive
            ? "都是 restrictive：与工件三条 AND 叠加，方向是收窄（可能让公开读或管理写拿不到行）；仍与工件不一致"
            : `permissive 取值未识别（${UNRECOGNISED}）`
  return `未登记：${lines.join(" / ")}；${direction}`
}

/**
 * 把只读查询结果（`pg_class.relrowsecurity` + `pg_policies` 行）对照到工件期望。
 * 返回的每一项都是 `{ label, ok, detail }`，由调用方决定如何记账或失败。
 * `rlsEnabled` 传查询原值：`undefined`（表不存在、查询无结果）与 `false`（表在但没开 RLS）是两种不同的结论。
 */
export function evaluateRlsState({ rlsEnabled, policies }) {
  const rows = new Map((policies ?? []).map(row => [row.policyname, row]))
  const checks = [
    {
      label: `${RLS_TARGET.table} 表存在且已启用 RLS`,
      ok: rlsEnabled === true,
      detail: rlsEnabled === undefined
        ? `pg_class 查询无结果：目标库里没有 ${RLS_TARGET.qualified}（不是"RLS 未开启"）`
        : rlsEnabled === null
            ? `relrowsecurity 为 NULL，${UNRECOGNISED}`
            : rlsEnabled === false ? "relrowsecurity=false：表存在但未启用 RLS" : `relrowsecurity=${showValue(rlsEnabled)}，${UNRECOGNISED}`,
    },
    ...RLS_POLICIES.map(policy => ({ ...evaluatePolicy(policy, rows.get(policy.name)), label: policy.label })),
  ]
  const expected = new Set(RLS_POLICIES.map(policy => policy.name))
  const unregistered = (policies ?? [])
    .filter(row => !expected.has(row.policyname))
    .sort((left, right) => String(left.policyname).localeCompare(String(right.policyname)))
  checks.push({
    label: "目标库策略集合与仓库工件一致（无未登记的额外策略）",
    ok: unregistered.length === 0,
    detail: unregistered.length ? describeUnregistered(unregistered) : "",
  })
  return checks
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
    "-- 执行前置：先用只读连接核对目标库现有策略是否与下面三条重复/冲突。本工件只覆盖这三条名字，",
    "-- 从不删除其它策略；手工库若另有宽策略，重放成功之后 RLS 仍是多条策略 OR 叠加的放宽状态。",
    "",
    // 逐句自动提交会在"已 drop 公开读策略、还没 create"之间留下静默零行窗口，整体包进一个事务。
    "begin;",
    "",
    `alter table ${RLS_TARGET.qualified} enable row level security;`,
    "",
    RLS_POLICIES.map(renderPolicySql).join("\n\n"),
    "",
    "commit;",
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
      select policyname, cmd, qual, with_check, roles, permissive
      from pg_policies
      where schemaname = '${RLS_TARGET.schema}' and tablename = '${RLS_TARGET.table}'
      order by policyname
    `,
  }
}
