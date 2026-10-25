import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  RLS_POLICIES,
  RLS_TARGET,
  evaluateRoles,
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

// Postgres 的子句缺省：`create policy` 不写 `to` 即授 PUBLIC（角色全集），不写 `as` 即 PERMISSIVE。
// 这是数据库语义，不是真源的期望值——真源的期望与它是否自洽由 expectPolicyClauses 比对。
const DEFAULT_ROLE = "public"
const DEFAULT_PERMISSIVE = true

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

// 语句里的授权子句。Postgres 的语法顺序是 `… ON table [AS permissive|restrictive] [FOR cmd] [TO roles] [USING …]`，
// 所以 `to` 只在 `for <cmd>` 之后、`as` 只在 `using (` 之前找；行首锚定会被 `for select to authenticated`
// 这种同行书写骗成"省略了子句"（复验的 V7 漏）。
function parseClauses(statement) {
  const using = statement.toLowerCase().indexOf("using (")
  const head = statement.slice(0, using < 0 ? statement.length : using)
  const asMatch = /\bas\s+(permissive|restrictive)\b/i.exec(head)
  const forMatch = /\bfor\s+(?:select|insert|update|delete|all)\b/i.exec(head)
  const afterCommand = forMatch ? head.slice(forMatch.index + forMatch[0].length) : ""
  const toMatch = /\bto\s+(.+?)(?:\s+as\s+(?:permissive|restrictive))?\s*$/is.exec(afterCommand.trim())
  return {
    roles: toMatch ? toMatch[1].split(",").map(name => name.trim().toLowerCase()).filter(Boolean).sort() : null,
    permissive: asMatch ? asMatch[1].toLowerCase() === "permissive" : null,
  }
}

// 生效语义：解析到的子句，缺省按 Postgres 的省略默认补齐。
function effectiveClauses(statement) {
  const clauses = parseClauses(statement)
  return { roles: clauses.roles ?? [DEFAULT_ROLE], permissive: clauses.permissive ?? DEFAULT_PERMISSIVE }
}

// 子句检查对工件与 §3.5 的块用同一份：分授写法今天只在工件里，块里单独改子句以前没人比（V8 漏）。
function expectPolicyClauses(sql) {
  for (const policy of RLS_POLICIES) {
    const statement = createPolicyStatement(sql, policy.name)
    expect(statement, `缺少 create policy ${policy.name}`).not.toBeNull()
    const clauses = effectiveClauses(statement)
    expect(clauses.roles, `${policy.name} 的生效角色集与真源期望不一致：块里是 ${clauses.roles.join(" / ")}，真源要求 ${[...policy.roles].sort().join(" / ")}`).toEqual([...policy.roles].sort())
    expect(clauses.permissive, `${policy.name} 的生效叠加方式是 ${clauses.permissive ? "permissive" : "restrictive"}，真源要求 ${policy.permissive ? "permissive" : "restrictive"}`).toBe(policy.permissive)
  }
}

// 去掉 `--` 注释行、按分号切句、空白规范化并小写，用来比较"块里到底执行了哪些语句"。
function sqlStatements(sql) {
  return sql
    .split("\n")
    .filter(line => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map(statement => statement.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .sort()
}

// 同一条比对同时用于生成的 migration 工件与 docs/mcp-design.md §3.5 的 SQL 块。
// 块里到底执行了哪些语句必须与真源渲染出的集合**相等**：操作员会照 §3.5 手工执行，
// 风险面是"块里多出的任何一条语句"，`drop table`/`owner to`/`truncate`/`create role`/`set role`
// 这类关键词黑名单永远追不上（复验 P3 的判定）。
function expectRlsSqlBlock(sql) {
  const expected = sqlStatements(renderMigrationSql())
  const actual = sqlStatements(sql)
  const extra = actual.filter(statement => !expected.includes(statement))
  const missing = expected.filter(statement => !actual.includes(statement))
  expect(extra, `块里夹带了工件之外的语句：${extra.join("；")}${missing.length ? `；还缺少：${missing.join("；")}` : ""}`).toEqual([])
  expect(missing, `块里缺少工件要求的语句：${missing.join("；")}${extra.length ? `；还夹带了：${extra.join("；")}` : ""}`).toEqual([])
  expect(createPolicyNames(sql), "create policy 的名字集合必须与真源一致").toEqual(policyNames)
  for (const policy of RLS_POLICIES) {
    const statement = createPolicyStatement(sql, policy.name)
    expect(statement, `缺少 create policy ${policy.name}`).not.toBeNull()
    expect(statement).toContain(`  on ${RLS_TARGET.qualified} for ${policy.command.toLowerCase()}`)
    expect(statement).toContain(`using (${policy.using})`)
    if (policy.withCheck) expect(statement).toContain(`with check (${policy.withCheck})`)
    else expect(statement).not.toContain("with check")
  }
  expectPolicyClauses(sql)
}

// 把子句插进每条 `create policy` 的 `using (` 之前（与工件一样的多行排布）。
function withClause(sql, clause) {
  return RLS_POLICIES.reduce((text, policy) => {
    const statement = createPolicyStatement(text, policy.name)
    return text.split(statement).join(statement.replace(/\n\s*using \(/, `\n  ${clause}\n  using (`))
  }, sql)
}

// 同行书写：`… for select to authenticated using (…)`。以前用行首锚定探测省略，这种写法会整条躲过检查。
function inlineClause(sql, clause) {
  return RLS_POLICIES.reduce((text, policy) => {
    const statement = createPolicyStatement(text, policy.name)
    const inlined = statement
      .replace(/;$/, "")
      .replace(/\s+/g, " ")
      .replace(/\bfor\s+(select|insert|update|delete|all)\b/i, (_match, command) => ` for ${command} ${clause}`)
    return text.split(statement).join(`${inlined};`)
  }, sql)
}

// 期望没动、工件或 §3.5 的授权子句先变了——复验实测的三个漏（V6/V7/V8）加一个只写 as 的变体。
const CLAUSE_MUTATIONS = [
  { id: "V6", description: "工件写 `to public, promotion_superuser`（期望只有 public）", clause: "to public, promotion_superuser", target: "artifact", inline: false, expectThrow: /生效角色集/ },
  { id: "V7", description: "`to authenticated` 与 `for select` 同行书写", clause: "to authenticated", target: "artifact", inline: true, expectThrow: /生效角色集/ },
  { id: "V8", description: "只有 §3.5 写 `to authenticated`（工件与真源都不动）", clause: "to authenticated", target: "design", inline: true, expectThrow: /生效角色集/ },
  { id: "V5", description: "只写 `as restrictive`（不带 to）", clause: "as restrictive", target: "artifact", inline: false, expectThrow: /生效叠加方式/ },
]

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

  // 语句集合相等一次封掉所有未登记的 DDL：操作员照 §3.5 手工执行，风险面是"块里多出的任何一条语句"，
  // 关键词黑名单永远追不上新写法（复验 P3 的判定）。
  const UNREGISTERED_DDL = [
    `alter table ${RLS_TARGET.qualified} force row level security;`,
    `grant select on ${RLS_TARGET.qualified} to anon;`,
    `revoke all on ${RLS_TARGET.qualified} from public;`,
    `drop table ${RLS_TARGET.qualified};`,
    `truncate ${RLS_TARGET.qualified};`,
    `alter table ${RLS_TARGET.qualified} owner to postgres;`,
    `create role promotion_writer;`,
    `set role promotion_writer;`,
  ]

  for (const ddl of UNREGISTERED_DDL) {
    it(`§3.5 夹带「${ddl}」时断言失败`, () => {
      expect(() => expectRlsSqlBlock(`${designRlsBlocks()[0]}\n${ddl}`), ddl).toThrow(/夹带了工件之外的语句/)
    })
  }

  // 省略写法（工件现在就是这个形状）必须解析成"没有子句"，生效语义由 Postgres 默认补齐，
  // 并与真源期望逐条一致——期望漂离默认值时这里红，不需要等连上真实库。
  it("省略 to/as 的工件：生效语义按 Postgres 默认补齐为 public + permissive", () => {
    for (const policy of RLS_POLICIES) {
      const statement = createPolicyStatement(renderMigrationSql(), policy.name)
      expect(parseClauses(statement).roles, `${policy.name} 不该解析出 to 子句`).toBeNull()
      expect(parseClauses(statement).permissive, `${policy.name} 不该解析出 as 子句`).toBeNull()
      expect(effectiveClauses(statement), policy.name).toEqual({ roles: ["public"], permissive: true })
      expect([...policy.roles].sort(), `${policy.name} 的期望角色集必须与省略默认一致`).toEqual(["public"])
      expect(policy.permissive, `${policy.name} 的期望叠加方式必须与省略默认一致`).toBe(true)
    }
  })

  // 不变量是双向的：渲染器写出与默认同义的显式子句时仍为绿（V4），写出不同的子句时红（V6/V7/V8）。
  it("V4：渲染器显式写出同义的 to public as permissive 时子句门禁仍为绿", () => {
    const explicit = withClause(renderMigrationSql(), "to public as permissive")
    expect(parseClauses(createPolicyStatement(explicit, "promotion_select_active"))).toEqual({ roles: ["public"], permissive: true })
    expect(() => expectPolicyClauses(explicit)).not.toThrow()
  })

  for (const mutation of CLAUSE_MUTATIONS) {
    it(`${mutation.id}：${mutation.description} 必须红`, () => {
      const source = mutation.target === "design" ? designRlsBlocks()[0] : renderMigrationSql()
      const mutated = mutation.inline ? inlineClause(source, mutation.clause) : withClause(source, mutation.clause)
      expect(() => expectPolicyClauses(mutated), mutation.clause).toThrow(mutation.expectThrow)
      // 只改 §3.5 时工件自己仍是绿的：证明报的是块与真源的分歧，不是块本身缺项。
      if (mutation.target === "design") expect(() => expectPolicyClauses(renderMigrationSql())).not.toThrow()
    })
  }

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

// `public` 是角色全集：`to public` 覆盖当前与未来的所有角色，所以它相对任何期望都是超集，
// 不是"缺角色"。分授落地后（期望不含 public）这个方向才可读，判定必须先写对。
describe("roles 的方向判定", () => {
  const policy = roles => ({ name: "promotion_select_active", roles, permissive: true })
  const detail = (expected, actual) => evaluateRoles(policy(expected), { roles: actual }).join("；")

  it("actual 含 public 时不再声称有角色命中不到，报的是扩大", () => {
    const messages = detail(["authenticated"], ["public"])
    expect(messages).toContain("授权面比工件宽")
    expect(messages).not.toContain("比工件窄")
    expect(messages).not.toContain("命中不到")
  })

  it("期望含 public 时，多出的任何角色都是等价冗余而不是免判失败", () => {
    for (const extra of [["public", "authenticated"], ["public", "anon"], ["public", "service_role"], ["public", "promotion_superuser"]]) {
      const messages = detail(["public"], extra)
      expect(messages, extra.join("/")).toContain("等价冗余")
      expect(messages, extra.join("/")).toContain("未识别形状·等价冗余·需人工复核")
      expect(messages, extra.join("/")).not.toContain("比工件宽")
    }
  })

  it("期望不含 public 时，多出的非 public 角色才是真实扩大", () => {
    for (const extra of [["authenticated", "service_role"], ["authenticated", "promotion_superuser"]]) {
      expect(detail(["authenticated"], extra), extra.join("/")).toContain("授权面比工件宽")
    }
  })

  it("缺少与多出同时成立时两段都拼进结果", () => {
    const messages = detail(["authenticated", "service_role"], ["anon"])
    expect(messages).toContain("比工件窄")
    expect(messages).toContain("比工件宽")
  })

  it("actual 缺 public 才是真实收窄", () => {
    const messages = detail(["public"], ["authenticated"])
    expect(messages).toContain("比工件窄")
    expect(messages).toContain("缺少 public")
  })
})
