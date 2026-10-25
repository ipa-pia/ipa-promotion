import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  RLS_POLICIES,
  RLS_TARGET,
  evaluateRlsState,
  migrationFileName,
  renderMigrationSql,
  rlsVerificationQueries,
} from "./rls-policy-spec.mjs"

const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${migrationFileName()}`, import.meta.url))
const migrationsDir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url))
const designPath = fileURLToPath(new URL("../docs/mcp-design.md", import.meta.url))

function sqlBlocks(markdown) {
  return [...markdown.matchAll(/```sql\n([\s\S]*?)```/g)].map(match => match[1])
}

function isPromotionRlsBlock(block) {
  return block.includes(`on ${RLS_TARGET.qualified} for`)
}

// 手工构造 `pg_policies` 可能返回的样子（带 Postgres 补的括号与 ::text cast），
// 用来证明 matcher 容忍表达式规范化差异。
function selectActiveRow() {
  return { policyname: "promotion_select_active", cmd: "SELECT", qual: `(${RLS_TARGET.table}.is_active) = true`, with_check: null }
}

function adminRow(name) {
  return { policyname: name, cmd: "SELECT", qual: "((auth.jwt() -> 'app_metadata' ->> 'role'::text) = 'admin'::text)", with_check: null }
}

function writeRow() {
  const expression = "((auth.jwt() -> 'app_metadata' ->> 'role'::text) = 'admin'::text)"
  return { policyname: "promotion_write_admin", cmd: "ALL", qual: expression, with_check: expression }
}

function committedRows() {
  return [selectActiveRow(), adminRow("promotion_select_admin"), writeRow()]
}

function createPolicyStatement(sql, name) {
  const start = sql.indexOf(`create policy "${name}"`)
  if (start < 0) return null
  const end = sql.indexOf(";", start)
  return sql.slice(start, end + 1)
}

// 同一条比对同时用于生成的 migration 工件与 docs/mcp-design.md §3.5 的 SQL 块。
function expectPolicyStatements(sql) {
  for (const policy of RLS_POLICIES) {
    const statement = createPolicyStatement(sql, policy.name)
    expect(statement, `缺少 create policy ${policy.name}`).not.toBeNull()
    expect(statement).toContain(`  on ${RLS_TARGET.qualified} for ${policy.command.toLowerCase()}`)
    expect(statement).toContain(`using (${policy.using})`)
    if (policy.withCheck) expect(statement).toContain(`with check (${policy.withCheck})`)
    else expect(statement).not.toContain("with check")
  }
}

describe("promotion RLS 工件与真源一致", () => {
  it("仓库内只有一份 promotion_rls migration，且内容与真源渲染结果逐字节相同", () => {
    const files = readdirSync(migrationsDir).filter(name => name.endsWith("_promotion_rls.sql"))
    expect(files).toEqual([migrationFileName()])
    expect(readFileSync(migrationPath, "utf8")).toBe(renderMigrationSql())
  })

  it("工件是幂等的：每条策略先 drop policy if exists 再 create policy", () => {
    const sql = renderMigrationSql()
    for (const policy of RLS_POLICIES) {
      const drop = sql.indexOf(`drop policy if exists "${policy.name}" on ${RLS_TARGET.qualified};`)
      const create = sql.indexOf(`create policy "${policy.name}"`)
      expect(drop, policy.name).toBeGreaterThanOrEqual(0)
      expect(create, policy.name).toBeGreaterThan(drop)
    }
    expect(sql).toContain(`alter table ${RLS_TARGET.qualified} enable row level security;`)
  })

  it("工件与设计文档 §3.5 的策略语句都和真源同义", () => {
    const sql = renderMigrationSql()
    expect(sql).toContain(`alter table ${RLS_TARGET.qualified} enable row level security;`)
    expectPolicyStatements(sql)
    const design = sqlBlocks(readFileSync(designPath, "utf8"))
    expect(design.some(block => block.includes(`create policy "${RLS_POLICIES[0].name}"`)), "§3.5 缺少策略 SQL").toBe(true)
    for (const block of design.filter(isPromotionRlsBlock)) expectPolicyStatements(block)
  })

  it("真源自洽：每条策略的判据都满足自己声明的必需项", () => {
    for (const policy of RLS_POLICIES) {
      const satisfied = predicates => policy.requiredPredicates.every(
        predicate => predicates.toLowerCase().includes(predicate.toLowerCase()),
      )
      expect(satisfied(policy.using), `${policy.name} using`).toBe(true)
      if (policy.withCheck) expect(satisfied(policy.withCheck), `${policy.name} with check`).toBe(true)
    }
  })

  it("工件里没有 client 可改的 user_metadata 判据", () => {
    expect(renderMigrationSql().toLowerCase()).not.toContain("user_metadata")
  })
})

describe("verify-mcp 的 RLS 断言只认真源", () => {
  it("目标库现状与工件一致时全部通过（含 Postgres 规范化后的括号与 ::text）", () => {
    const checks = evaluateRlsState({ rlsEnabled: true, policies: committedRows() })
    expect(checks.filter(check => !check.ok)).toEqual([])
    expect(checks.map(check => check.label)).toEqual([
      "promotion 表存在且已启用 RLS",
      ...RLS_POLICIES.map(policy => policy.label),
      "目标库策略集合与仓库工件一致（无未登记的额外策略）",
    ])
  })

  it("RLS 未开启即失败（§7 R1）", () => {
    const checks = evaluateRlsState({ rlsEnabled: false, policies: committedRows() })
    expect(checks[0].ok).toBe(false)
  })

  it("缺 promotion_write_admin 时写侧断言失败（A7）", () => {
    const checks = evaluateRlsState({ rlsEnabled: true, policies: committedRows().slice(0, 2) })
    expect(checks.filter(check => !check.ok).map(check => check.label)).toEqual([
      "存在基于 app_metadata.role 的 promotion_write_admin 策略",
    ])
  })

  it("缺 promotion_select_admin 时读侧断言失败（A8b 的静默空集）", () => {
    const checks = evaluateRlsState({ rlsEnabled: true, policies: [selectActiveRow(), writeRow()] })
    expect(checks.find(check => check.label === "存在基于 app_metadata.role 的 promotion_select_admin 策略").ok).toBe(false)
  })

  it("策略被写宽成 using (true) 时失败而不是放行", () => {
    const rows = committedRows().map(row => row.policyname === "promotion_select_admin" ? { ...row, qual: "true" } : row)
    const check = evaluateRlsState({ rlsEnabled: true, policies: rows }).find(item => item.label === "存在基于 app_metadata.role 的 promotion_select_admin 策略")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("恒真")
  })

  it("管理员判据改用 client 可写的 user_metadata 时失败", () => {
    const tampered = "((auth.jwt() -> 'user_metadata' ->> 'role'::text) = 'admin'::text)"
    const rows = committedRows().map(row => row.policyname === "promotion_select_admin" ? { ...row, qual: tampered } : row)
    const check = evaluateRlsState({ rlsEnabled: true, policies: rows }).find(item => item.label === "存在基于 app_metadata.role 的 promotion_select_admin 策略")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("user_metadata")
  })

  it("写策略缺 with check 时失败", () => {
    const rows = committedRows().map(row => row.policyname === "promotion_write_admin" ? { ...row, with_check: null } : row)
    expect(evaluateRlsState({ rlsEnabled: true, policies: rows }).find(item => item.label === "存在基于 app_metadata.role 的 promotion_write_admin 策略").ok).toBe(false)
  })

  it("写策略被收窄成只读时 cmd 不符", () => {
    const rows = committedRows().map(row => row.policyname === "promotion_write_admin" ? { ...row, cmd: "SELECT" } : row)
    expect(evaluateRlsState({ rlsEnabled: true, policies: rows }).find(item => item.label === "存在基于 app_metadata.role 的 promotion_write_admin 策略").ok).toBe(false)
  })

  it("目标库存在未登记的额外策略时报漂移", () => {
    const rows = [...committedRows(), { policyname: "promotion_anyone_writes", cmd: "ALL", qual: "true", with_check: "true" }]
    const check = evaluateRlsState({ rlsEnabled: true, policies: rows }).at(-1)
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("promotion_anyone_writes")
  })

  it("核验查询是只读的", () => {
    const queries = rlsVerificationQueries()
    for (const sql of Object.values(queries)) {
      expect(sql.trim().toLowerCase()).toMatch(/^select\b/)
      expect(sql.toLowerCase()).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant)\b/)
    }
    expect(queries.table).toContain("pg_class")
    expect(queries.policies).toContain("pg_policies")
  })

  it("断言使用的策略名来自真源而不是脚本硬编码", () => {
    const verifier = readFileSync(fileURLToPath(new URL("./verify-mcp.mjs", import.meta.url)), "utf8")
    expect(verifier).toContain("evaluateRlsState")
    for (const policy of RLS_POLICIES) expect(verifier, policy.name).not.toContain(`"${policy.name}"`)
  })
})
