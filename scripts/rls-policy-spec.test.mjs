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
const verifierPath = fileURLToPath(new URL("./verify-mcp.mjs", import.meta.url))

const policyNames = RLS_POLICIES.map(policy => policy.name).sort()
const ADMIN_EXPRESSION = "((auth.jwt() -> 'app_metadata' ->> 'role'::text) = 'admin'::text)"

function sqlBlocks(markdown) {
  return [...markdown.matchAll(/```sql\n([\s\S]*?)```/g)].map(match => match[1])
}

function isPromotionRlsBlock(block) {
  return block.includes(`on ${RLS_TARGET.qualified} for`)
}

function designRlsBlocks() {
  return sqlBlocks(readFileSync(designPath, "utf8")).filter(isPromotionRlsBlock)
}

// 手工构造 `pg_policies` 可能返回的样子（带 Postgres 补的括号与 ::text cast），
// 用来证明规范化能吸收 deparse 差异；roles/permissive 是工件不带 `to`/`as` 时的实际取值。
function selectActiveRow() {
  return { policyname: "promotion_select_active", cmd: "SELECT", qual: `(${RLS_TARGET.table}.is_active) = true`, with_check: null, roles: ["public"], permissive: true }
}

function adminRow(name) {
  return { policyname: name, cmd: "SELECT", qual: ADMIN_EXPRESSION, with_check: null, roles: ["public"], permissive: true }
}

function writeRow() {
  return { policyname: "promotion_write_admin", cmd: "ALL", qual: ADMIN_EXPRESSION, with_check: ADMIN_EXPRESSION, roles: ["public"], permissive: true }
}

function committedRows() {
  return [selectActiveRow(), adminRow("promotion_select_admin"), writeRow()]
}

function evaluateWith(mutations) {
  const rows = committedRows().map(row => mutations[row.policyname] ? { ...row, ...mutations[row.policyname] } : row)
  return evaluateRlsState({ rlsEnabled: true, policies: rows })
}

function checkFor(label) {
  return checks => checks.find(item => item.label === label)
}

const selectActiveCheck = checkFor("存在仅允许读取上架记录的 promotion_select_active 策略")
const selectAdminCheck = checkFor("存在基于 app_metadata.role 的 promotion_select_admin 策略")
const writeAdminCheck = checkFor("存在基于 app_metadata.role 的 promotion_write_admin 策略")

function createPolicyStatement(sql, name) {
  const start = sql.indexOf(`create policy "${name}"`)
  if (start < 0) return null
  const end = sql.indexOf(";", start)
  return sql.slice(start, end + 1)
}

function createPolicyNames(sql) {
  return [...sql.matchAll(/create policy "([^"]+)"/g)].map(match => match[1]).sort()
}

// 同一条比对同时用于生成的 migration 工件与 docs/mcp-design.md §3.5 的 SQL 块。
// 双向：既要求三条都在且判据逐字相同，也要求块里没有第四条未登记的策略、事务包装与 enable 语句没被删掉。
function expectRlsSqlBlock(sql) {
  expect(createPolicyNames(sql), "create policy 的名字集合必须与真源一致").toEqual(policyNames)
  expect(sql, "缺少 enable row level security").toContain(`alter table ${RLS_TARGET.qualified} enable row level security;`)
  expect(sql, "缺少事务包装 begin;").toMatch(/^begin;$/m)
  expect(sql, "缺少事务包装 commit;").toMatch(/^commit;$/m)
  // enable 三条之外不许夹带别的 DDL：force row level security 会让表 owner 也受 RLS 约束，
  // 在 Supabase 上正好打断 service_role 的写入；grant/revoke 改变授权面。两者都不在工件里。
  expect(sql, "块里夹带了工件之外的 DDL").not.toMatch(/\b(force\s+row\s+level\s+security|grant|revoke)\b/i)
  for (const policy of RLS_POLICIES) {
    const statement = createPolicyStatement(sql, policy.name)
    expect(statement, `缺少 create policy ${policy.name}`).not.toBeNull()
    expect(statement).toContain(`  on ${RLS_TARGET.qualified} for ${policy.command.toLowerCase()}`)
    expect(statement).toContain(`using (${policy.using})`)
    if (policy.withCheck) expect(statement).toContain(`with check (${policy.withCheck})`)
    else expect(statement).not.toContain("with check")
  }
}

// 测试与审查实测过的"写宽/收窄"变异：整式相等 + roles/permissive 之后必须全部转为判失败。
const MUTATIONS = [
  {
    id: "M2",
    description: "管理员判据 OR (true)",
    check: selectAdminCheck,
    mutations: { promotion_select_admin: { qual: `(${ADMIN_EXPRESSION} OR (true))` } },
    expectDetail: ["未识别形状，需人工复核"],
  },
  {
    id: "M3",
    description: "公开读策略并上 is_active = false（匿名可读全部行）",
    check: selectActiveCheck,
    mutations: { promotion_select_active: { qual: `(${RLS_TARGET.table}.is_active) = true OR (${RLS_TARGET.table}.is_active) = false` } },
    expectDetail: ["未识别形状，需人工复核"],
  },
  {
    id: "M5",
    description: "->> 'role' <> 'notadmin'（四个词元都在）",
    check: selectAdminCheck,
    mutations: { promotion_select_admin: { qual: "((auth.jwt() -> 'app_metadata' ->> 'role'::text) <> 'notadmin'::text)" } },
    expectDetail: ["未识别形状，需人工复核"],
  },
  {
    id: "M6",
    description: "->> 'role' IN ('admin', 'service')",
    check: selectAdminCheck,
    mutations: { promotion_select_admin: { qual: "((auth.jwt() -> 'app_metadata' ->> 'role'::text) IN ('admin'::text, 'service'::text))" } },
    expectDetail: ["未识别形状，需人工复核"],
  },
  {
    id: "M7",
    description: "写入侧 with check OR (true)",
    check: writeAdminCheck,
    mutations: { promotion_write_admin: { with_check: `(${ADMIN_EXPRESSION} OR (true))` } },
    expectDetail: ["with_check", "未识别形状，需人工复核"],
  },
  {
    id: "M9",
    description: "同名策略改成 to authenticated",
    check: selectActiveCheck,
    mutations: { promotion_select_active: { roles: ["authenticated"] } },
    expectDetail: ["授权面比工件窄", "缺少 public"],
  },
  {
    id: "M10",
    description: "同名策略改成 as restrictive",
    check: writeAdminCheck,
    mutations: { promotion_write_admin: { permissive: false } },
    expectDetail: ["restrictive"],
  },
  {
    id: "M14",
    description: "同名策略写成 to public, authenticated（授权面是工件超集）",
    check: selectActiveCheck,
    mutations: { promotion_select_active: { roles: ["public", "authenticated"] } },
    expectDetail: ["等价冗余", "未识别形状·等价冗余·需人工复核"],
  },
  {
    id: "M13",
    description: "app_metadata 判据 OR raw_user_meta_data 判据",
    check: selectAdminCheck,
    mutations: {
      promotion_select_admin: {
        qual: `(${ADMIN_EXPRESSION}) OR ((auth.jwt() -> 'raw_user_meta_data' ->> 'role'::text) = 'admin'::text)`,
      },
    },
    expectDetail: ["raw_user_meta_data"],
  },
]

describe("promotion RLS 工件与真源一致", () => {
  it("仓库内只有一份 promotion_rls migration，且内容与真源渲染结果逐字节相同", () => {
    const files = readdirSync(migrationsDir).filter(name => name.endsWith("_promotion_rls.sql"))
    expect(files).toEqual([migrationFileName()])
    expect(readFileSync(migrationPath, "utf8")).toBe(renderMigrationSql())
    expectRlsSqlBlock(renderMigrationSql())
  })

  it("工件是幂等的：每条策略先 drop policy if exists 再 create policy", () => {
    const sql = renderMigrationSql()
    for (const policy of RLS_POLICIES) {
      const drop = sql.indexOf(`drop policy if exists "${policy.name}" on ${RLS_TARGET.qualified};`)
      const create = sql.indexOf(`create policy "${policy.name}"`)
      expect(drop, policy.name).toBeGreaterThanOrEqual(0)
      expect(create, policy.name).toBeGreaterThan(drop)
    }
    expect(sql.indexOf("begin;")).toBeLessThan(sql.indexOf(`alter table ${RLS_TARGET.qualified} enable row level security;`))
    expect(sql.indexOf("commit;")).toBeGreaterThan(sql.lastIndexOf("with check"))
  })

  it("工件与设计文档 §3.5 的策略语句都和真源同义", () => {
    const blocks = designRlsBlocks()
    expect(blocks, "§3.5 应恰有一个 promotion RLS 的 sql 块").toHaveLength(1)
    for (const block of blocks) expectRlsSqlBlock(block)
  })

  it("§3.5 多出未登记的 create policy 时断言失败（docs 校验是双向的）", () => {
    const widened = `${designRlsBlocks()[0]}\ncreate policy "legacy_read_everything"\n  on ${RLS_TARGET.qualified} for select\n  using (true);\n`
    expect(() => expectRlsSqlBlock(widened)).toThrow(/legacy_read_everything/)
  })

  it("§3.5 删掉 enable row level security 时断言失败", () => {
    const withoutEnable = designRlsBlocks()[0].replace(`alter table ${RLS_TARGET.qualified} enable row level security;`, "")
    expect(() => expectRlsSqlBlock(withoutEnable)).toThrow(/enable row level security/)
  })

  it("§3.5 删掉事务包装时断言失败", () => {
    const withoutTransaction = designRlsBlocks()[0].replace(/^begin;$/m, "").replace(/^commit;$/m, "")
    expect(() => expectRlsSqlBlock(withoutTransaction)).toThrow(/begin/)
  })

  it("§3.5 夹带 force row level security 时断言失败", () => {
    const forced = designRlsBlocks()[0].replace(
      `alter table ${RLS_TARGET.qualified} enable row level security;`,
      `alter table ${RLS_TARGET.qualified} enable row level security;\nalter table ${RLS_TARGET.qualified} force row level security;`,
    )
    expect(() => expectRlsSqlBlock(forced)).toThrow(/DDL/)
  })

  it("§3.5 夹带 grant/revoke 时断言失败", () => {
    for (const ddl of [`grant select on ${RLS_TARGET.qualified} to anon;`, `revoke all on ${RLS_TARGET.qualified} from public;`]) {
      expect(() => expectRlsSqlBlock(`${designRlsBlocks()[0]}\n${ddl}`), ddl).toThrow(/DDL/)
    }
  })

  // 真源的 roles/permissive 期望与工件的省略写法必须同进同退：只改期望会让断言与工件各说各话，
  // 而这个矛盾只有连上真实库核验才暴露（复验实测：改期望 + 同步夹具后 30 项仍全绿）。
  it("to/as 不变量：工件省略 to/as 时，期望必须恰好是 public + permissive", () => {
    const statements = RLS_POLICIES.map(policy => createPolicyStatement(renderMigrationSql(), policy.name))
    const omitsClause = statements.every(statement => !/^\s*(to|as)\s+[a-z]/im.test(statement))
    if (omitsClause) {
      for (const policy of RLS_POLICIES) {
        expect(policy.roles, `${policy.name} 的 roles 期望`).toEqual(["public"])
        expect(policy.permissive, `${policy.name} 的 permissive 期望`).toBe(true)
      }
    }
    else {
      for (const [index, policy] of RLS_POLICIES.entries()) {
        expect(statements[index], policy.name).toContain(`to ${policy.roles.join(", ")}`)
        expect(statements[index], policy.name).toContain(`as ${policy.permissive ? "permissive" : "restrictive"}`)
      }
    }
  })

  it("工件里没有 client 可改的 user_metadata / raw_user_meta_data 判据", () => {
    const sql = renderMigrationSql().toLowerCase()
    expect(sql).not.toContain("user_metadata")
    expect(sql).not.toContain("raw_user_meta_data")
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

  it("规范化能吸收等价写法（多重括号、表限定符、空白换行、大小写、::text、数组字面量）", () => {
    const equivalent = [
      { policyname: "promotion_select_active", cmd: "SELECT", qual: "(( public.promotion.is_active )) = TRUE", with_check: null, roles: "{PUBLIC}", permissive: true },
      { policyname: "promotion_select_admin", cmd: "SELECT", qual: "( ( AUTH.JWT() -> 'app_metadata'\n  ->> 'role' ) = 'admin' )", with_check: null, roles: "{public}", permissive: true },
      { policyname: "promotion_write_admin", cmd: "ALL", qual: "(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'", with_check: "(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'", roles: ["public"], permissive: true },
    ]
    expect(evaluateRlsState({ rlsEnabled: true, policies: equivalent }).filter(check => !check.ok)).toEqual([])
  })

  it("RLS 未开启即失败（§7 R1）", () => {
    const checks = evaluateRlsState({ rlsEnabled: false, policies: committedRows() })
    expect(checks[0].ok).toBe(false)
    expect(checks[0].detail).toContain("表存在但未启用 RLS")
  })

  it("表不存在时报「查询无结果」而不是 relrowsecurity=false", () => {
    const checks = evaluateRlsState({ rlsEnabled: undefined, policies: [] })
    expect(checks[0].ok).toBe(false)
    expect(checks[0].detail).toContain("pg_class 查询无结果")
    expect(checks[0].detail).not.toContain("relrowsecurity=false")
  })

  it("核验脚本传的是 relrowsecurity 原值而不是强转布尔", () => {
    expect(readFileSync(verifierPath, "utf8")).toContain("rlsEnabled: table.rows[0]?.enabled,")
  })

  it("缺 promotion_write_admin 时写侧断言失败（A7）", () => {
    const checks = evaluateRlsState({ rlsEnabled: true, policies: committedRows().slice(0, 2) })
    expect(checks.filter(check => !check.ok).map(check => check.label)).toEqual([
      "存在基于 app_metadata.role 的 promotion_write_admin 策略",
    ])
  })

  it("缺 promotion_select_admin 时读侧断言失败（A8b 的静默空集）", () => {
    const checks = evaluateRlsState({ rlsEnabled: true, policies: [selectActiveRow(), writeRow()] })
    expect(selectAdminCheck(checks).ok).toBe(false)
  })

  it("策略被写宽成 using (true) 时失败而不是放行", () => {
    const check = selectAdminCheck(evaluateWith({ promotion_select_admin: { qual: "true" } }))
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("恒真")
  })

  it("管理员判据改用 client 可写的 user_metadata 时失败", () => {
    const tampered = ADMIN_EXPRESSION.replace("'app_metadata'", "'user_metadata'")
    const check = selectAdminCheck(evaluateWith({ promotion_select_admin: { qual: tampered } }))
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("user_metadata")
  })

  it("写策略缺 with check 时失败", () => {
    expect(writeAdminCheck(evaluateWith({ promotion_write_admin: { with_check: null } })).ok).toBe(false)
  })

  it("写策略被收窄成只读时 cmd 不符", () => {
    expect(writeAdminCheck(evaluateWith({ promotion_write_admin: { cmd: "SELECT" } })).ok).toBe(false)
  })

  // 无网夹具：pg_policies 里这三行形状都不需要连库才能造出来。
  it("策略没有 using（qual 为 NULL）时判失败并显示原始空值", () => {
    const check = selectActiveCheck(evaluateWith({ promotion_select_active: { qual: null } }))
    expect(check.ok, check.detail).toBe(false)
    expect(check.detail).toContain("qual 为空")
    expect(check.detail).toContain("qual=（空）")
  })

  it("roles 是空数组时判为收窄（没有任何角色命中）而不是缺失字段", () => {
    const check = selectActiveCheck(evaluateWith({ promotion_select_active: { roles: [] } }))
    expect(check.ok, check.detail).toBe(false)
    expect(check.detail).toContain("缺少 public")
    expect(check.detail).toContain("roles=（空数组）")
  })

  it("只读策略却带 with check 时判失败：工件没有登记这一项", () => {
    const check = selectAdminCheck(evaluateWith({ promotion_select_admin: { with_check: ADMIN_EXPRESSION } }))
    expect(check.ok, check.detail).toBe(false)
    expect(check.detail).toContain("只读策略却带 with check")
    expect(check.detail).toContain("工件未登记")
  })

  it("目标库存在未登记的额外策略时报漂移", () => {
    const rows = [...committedRows(), { policyname: "promotion_anyone_writes", cmd: "ALL", qual: "true", with_check: "true", roles: ["public"], permissive: true }]
    const check = evaluateRlsState({ rlsEnabled: true, policies: rows }).at(-1)
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("promotion_anyone_writes")
    for (const column of ["cmd=", "permissive=", "qual="]) expect(check.detail, column).toContain(column)
    expect(check.detail).toContain("方向是放宽")
  })

  // 未登记策略不等于放宽：restrictive 的与工件三条 AND 叠加会收窄。
  // 无条件写"仍是 OR 放宽态"会把复核方向带偏，所以方向由 permissive 取值算出来。
  it("未登记的 restrictive 策略报收窄而不是放宽", () => {
    const rows = [...committedRows(), { policyname: "legacy_promotion_lock", cmd: "SELECT", qual: `(${RLS_TARGET.table}.is_active) = false`, with_check: null, roles: ["public"], permissive: false }]
    const check = evaluateRlsState({ rlsEnabled: true, policies: rows }).at(-1)
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("都是 restrictive")
    expect(check.detail).toContain("方向是收窄")
    expect(check.detail).not.toContain("方向是放宽")
    expect(check.detail).toContain(`qual="(${RLS_TARGET.table}.is_active) = false"`)
  })

  it("未登记策略同时有 permissive 与 restrictive 时报两个方向", () => {
    const rows = [
      ...committedRows(),
      { policyname: "legacy_wide_read", cmd: "SELECT", qual: "true", with_check: null, roles: ["public"], permissive: true },
      { policyname: "legacy_narrow_read", cmd: "SELECT", qual: "false", with_check: null, roles: ["public"], permissive: false },
    ]
    const check = evaluateRlsState({ rlsEnabled: true, policies: rows }).at(-1)
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("两个方向同时存在")
    expect(check.detail).toContain("legacy_narrow_read")
    expect(check.detail).toContain("legacy_wide_read")
  })

  it("未登记策略的 permissive 不是布尔值时不猜方向", () => {
    const rows = [...committedRows(), { policyname: "legacy_unknown", cmd: "SELECT", qual: "true", with_check: null, roles: ["public"], permissive: null }]
    const check = evaluateRlsState({ rlsEnabled: true, policies: rows }).at(-1)
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("permissive 取值未识别")
    expect(check.detail).toContain("未识别形状，需人工复核")
  })

  for (const mutation of MUTATIONS) {
    it(`${mutation.id}：${mutation.description} 必须判失败`, () => {
      const check = mutation.check(evaluateWith(mutation.mutations))
      expect(check.ok, check.detail).toBe(false)
      for (const fragment of mutation.expectDetail) expect(check.detail, `${mutation.id} ${fragment}`).toContain(fragment)
      for (const column of ["qual=", "with_check=", "roles=", "permissive="]) expect(check.detail, mutation.id).toContain(column)
    })
  }

  it("未识别形状时列原始全文，让正确库走人眼复核而不是静默通过", () => {
    const handWritten = { promotion_select_active: { qual: `(${RLS_TARGET.table}.is_active)` } }
    const check = selectActiveCheck(evaluateWith(handWritten))
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("未识别形状，需人工复核")
    expect(check.detail).toContain(`(${RLS_TARGET.table}.is_active)`)
  })

  it("核验查询是只读的，且取了 roles/permissive 两列", () => {
    const queries = rlsVerificationQueries()
    for (const sql of Object.values(queries)) {
      expect(sql.trim().toLowerCase()).toMatch(/^select\b/)
      expect(sql.toLowerCase()).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant)\b/)
    }
    expect(queries.table).toContain("pg_class")
    expect(queries.policies).toContain("pg_policies")
    for (const column of ["policyname", "cmd", "qual", "with_check", "roles", "permissive"]) expect(queries.policies, column).toContain(column)
  })

  it("断言使用的策略名来自真源而不是脚本硬编码", () => {
    const verifier = readFileSync(verifierPath, "utf8")
    expect(verifier).toContain("evaluateRlsState")
    for (const policy of RLS_POLICIES) expect(verifier, policy.name).not.toContain(`"${policy.name}"`)
  })
})
