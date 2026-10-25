import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { once } from "node:events"
import { resolve } from "node:path"
import { createServer } from "node:net"
import {
  compareMcpToolSchemas,
  confirmRecordDeleted,
  createCheckReporter,
  verifyWriteIsolationFlow,
} from "./verify-mcp-helpers.mjs"

const root = process.cwd()
const missing = []
const reporter = createCheckReporter()
const { check } = reporter

class CheckFailure extends Error {}

function requireCheck(label, condition, detail = "") {
  check(label, condition, detail)
  if (!condition) throw new CheckFailure(`${label}${detail ? `；${detail}` : ""}`)
}

function preflight(condition, message) {
  if (!condition) missing.push(message)
}

if (!existsSync(resolve(root, "node_modules"))) {
  console.error("MCP 验收无法启动：尚未安装依赖，请先执行 pnpm install --frozen-lockfile。")
  process.exit(1)
}
if (!existsSync(resolve(root, "node_modules/dotenv/config.js")) || !existsSync(resolve(root, "node_modules/@modelcontextprotocol/sdk"))) {
  console.error("MCP 验收无法启动：依赖未完整安装，请执行 pnpm install --frozen-lockfile。")
  process.exit(1)
}

// dotenv does not fail on a missing .env; the checks below can then give a useful message.
if (!existsSync(resolve(root, ".env"))) {
  console.error("MCP 验收提示：未找到 .env 文件；请复制 .env.example 为 .env 并补齐验收环境变量。")
}
await import("dotenv/config")

const requiredVariables = [
  ["NUXT_PUBLIC_SUPABASE_URL", "目标 Supabase 项目 URL"],
  ["NUXT_PUBLIC_SUPABASE_ANON_KEY", "Supabase anon/publishable key"],
  ["MCP_TEST_ADMIN_ACCESS_TOKEN", "真实 OAuth 管理员 access token"],
  ["MCP_TEST_USER_ACCESS_TOKEN", "真实 OAuth 普通用户 access token"],
  ["MCP_TEST_ADMIN_SESSION_COOKIE", "管理员浏览器会话 Cookie header（HTTP API 对照）"],
  ["MCP_TEST_DATABASE_URL", "目标 Supabase 数据库只读连接串（RLS 核验）"],
]
for (const [name, description] of requiredVariables) {
  preflight(Boolean(process.env[name]?.trim()), `${name}（${description}）`)
}
preflight(existsSync(resolve(root, "node_modules/@modelcontextprotocol/sdk")), "官方 MCP SDK 依赖；请执行 pnpm install")
preflight(existsSync(resolve(root, ".output/server/index.mjs")), "生产构建产物 .output/server/index.mjs；请先用 supabase provider 执行 pnpm build")

if (missing.length) {
  console.error("MCP 验收无法启动，缺少以下前置条件：")
  for (const item of missing) console.error(`- ${item}`)
  console.error("请补齐真实 OAuth、目标 Supabase 和只读 RLS 核验条件后重试；缺配置不算验收通过。")
  process.exit(1)
}

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js")
const { createClient } = await import("@supabase/supabase-js")
const { Client: PostgresClient } = await import("pg")

const supabaseUrl = process.env.NUXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY
const adminToken = process.env.MCP_TEST_ADMIN_ACCESS_TOKEN
const userToken = process.env.MCP_TEST_USER_ACCESS_TOKEN
const adminCookie = process.env.MCP_TEST_ADMIN_SESSION_COOKIE
let expectedIssuer
try {
  expectedIssuer = `${new URL(supabaseUrl).origin}/auth/v1`
}
catch {
  console.error("MCP 验收无法启动：NUXT_PUBLIC_SUPABASE_URL 不是有效 URL。")
  process.exit(1)
}

function jwtPayload(token) {
  const payload = token.split(".")[1]
  if (!payload) return null
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  }
  catch {
    return null
  }
}

async function verifiedUser(token, label) {
  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await supabase.auth.getUser(token)
  assert.ifError(error && new Error(`${label} OAuth token 无法由目标 Supabase Auth 验证`))
  assert.ok(data.user, `${label} OAuth token 未解析出用户`)
  const claims = jwtPayload(token)
  assert.equal(claims?.iss, expectedIssuer, `${label} token issuer 与目标 Supabase 不匹配`)
  assert.equal(claims?.aud, "authenticated", `${label} token audience 不是 authenticated`)
  return data.user
}

let adminUser
let regularUser
try {
  adminUser = await verifiedUser(adminToken, "管理员")
  regularUser = await verifiedUser(userToken, "普通用户")
}
catch {
  console.error("MCP 验收无法启动：OAuth token 验证失败，或 token 的 issuer/audience 与目标 Supabase 不符。请重新授权并检查目标项目；不会输出凭据或原始 token。")
  process.exit(1)
}
if (adminUser.app_metadata?.role !== "admin" || regularUser.app_metadata?.role === "admin") {
  console.error("MCP 验收无法启动：管理员 token 必须含 app_metadata.role=admin，普通用户 token 必须不是 admin。请核实 Supabase OAuth 用户元数据后重新授权。")
  process.exit(1)
}

async function verifyRlsPolicies() {
  const db = new PostgresClient({ connectionString: process.env.MCP_TEST_DATABASE_URL, connectionTimeoutMillis: 10_000 })
  await db.connect()
  try {
    const table = await db.query(`
      select c.relrowsecurity as enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'promotion'
    `)
    requireCheck("promotion 表存在且已启用 RLS", table.rows[0]?.enabled === true)

    const policies = await db.query(`
      select policyname, cmd, qual, with_check
      from pg_policies
      where schemaname = 'public' and tablename = 'promotion'
    `)
    const byName = new Map(policies.rows.map(row => [row.policyname, row]))
    const active = byName.get("promotion_select_active")
    const adminSelect = byName.get("promotion_select_admin")
    const adminWrite = byName.get("promotion_write_admin")
    requireCheck("存在仅允许读取上架记录的 promotion_select_active 策略", Boolean(active && active.cmd === "SELECT" && /is_active\s*=\s*true/i.test(String(active.qual))))
    requireCheck("存在基于 app_metadata.role 的 promotion_select_admin 策略", Boolean(adminSelect && adminSelect.cmd === "SELECT" && /app_metadata/i.test(String(adminSelect.qual)) && /role/i.test(String(adminSelect.qual))))
    requireCheck("存在基于 app_metadata.role 的 promotion_write_admin 策略", Boolean(adminWrite && adminWrite.cmd === "ALL" && /app_metadata/i.test(`${adminWrite.qual} ${adminWrite.with_check}`) && /role/i.test(`${adminWrite.qual} ${adminWrite.with_check}`)))
  }
  finally {
    await db.end()
  }
}

async function freePort() {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  assert.ok(address && typeof address === "object")
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return address.port
}

function toolText(result) {
  return (result.content ?? []).filter(item => item.type === "text").map(item => item.text).join("\n")
}

function parseToolJson(result) {
  assert.notEqual(result.isError, true, toolText(result))
  const text = toolText(result)
  assert.ok(text, "MCP 工具没有返回 text 内容")
  return JSON.parse(text)
}

function sameRecord(left, right) {
  return Boolean(left && right)
    && JSON.stringify(Object.keys(left).sort()) === JSON.stringify(Object.keys(right).sort())
    && Object.keys(left).every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]))
}

async function withMcpClient(endpoint, token, callback) {
  const client = new Client({ name: "ipa-promotion-mcp-acceptance", version: "1.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  try {
    await client.connect(transport)
    return await callback(client)
  }
  finally {
    await client.close()
  }
}

async function waitForServer(child, baseUrl) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`生产构建进程提前退出（${child.exitCode}）`)
    try {
      const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/api/v1/mcp`)
      if (response.ok) return
      lastError = new Error(`发现端点返回 HTTP ${response.status}`)
    }
    catch (error) {
      lastError = error
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new Error(`等待生产构建服务超时：${lastError?.message ?? "未知错误"}`)
}

let child
let adminDb
let userDb
let fixtureId
const rogueNames = []
let fixtureName
try {
  await verifyRlsPolicies()

  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const endpoint = `${baseUrl}/api/v1/mcp`
  child = spawn(process.execPath, [resolve(root, ".output/server/index.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      NUXT_PORT: String(port),
      NITRO_PORT: String(port),
      NUXT_HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      NUXT_PUBLIC_AUTH_PROVIDER: "supabase",
      NUXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NUXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.resume()
  child.stderr.resume()
  await waitForServer(child, baseUrl)

  const metadataResponse = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/api/v1/mcp`)
  const metadata = await metadataResponse.json()
  requireCheck("RFC 9728 发现端点返回 200", metadataResponse.status === 200)
  requireCheck("RFC 9728 resource 指向 MCP 端点", metadata.resource === endpoint)
  requireCheck("RFC 9728 authorization_servers 指向目标 Supabase", metadata.authorization_servers?.[0] === expectedIssuer)
  requireCheck("RFC 9728 scopes 与 bearer 方法存在", Array.isArray(metadata.scopes_supported) && Array.isArray(metadata.bearer_methods_supported) && metadata.bearer_methods_supported.includes("header"))

  const consentResponse = await fetch(`${baseUrl}/oauth/consent`)
  const consentHtml = await consentResponse.text()
  requireCheck("模板 OAuth 同意页可访问且项目未覆盖", consentResponse.status === 200 && consentResponse.headers.get("content-type")?.includes("text/html") && consentHtml.includes("</html>") && !existsSync(resolve(root, "app/pages/oauth/consent.vue")))

  const challengeResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "unauthenticated-probe", version: "1" } } }),
  })
  requireCheck("无 token 返回 401 和 WWW-Authenticate", challengeResponse.status === 401 && Boolean(challengeResponse.headers.get("www-authenticate")?.includes("resource_metadata")))
  const invalidTokenResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer definitely-invalid-token" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "invalid-token-probe", version: "1" } } }),
  })
  requireCheck("坏 token 返回 401 和 WWW-Authenticate", invalidTokenResponse.status === 401 && Boolean(invalidTokenResponse.headers.get("www-authenticate")))
  const getResponse = await fetch(endpoint)
  const deleteResponse = await fetch(endpoint, { method: "DELETE" })
  requireCheck("GET /api/v1/mcp 返回 405 + Allow: POST", getResponse.status === 405 && getResponse.headers.get("allow") === "POST")
  requireCheck("DELETE /api/v1/mcp 返回 405 + Allow: POST", deleteResponse.status === 405 && deleteResponse.headers.get("allow") === "POST")

  adminDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${adminToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  await withMcpClient(endpoint, adminToken, async (client) => {
    const listedTools = await client.listTools()
    const expectedTools = ["list_promotions", "get_promotion", "create_promotion", "update_promotion", "delete_promotion", "set_promotion_active"]
    const schemaErrors = compareMcpToolSchemas(listedTools.tools)
    requireCheck("MCP initialize/tools/list 返回六个定稿工具及字段 schema", schemaErrors.length === 0, schemaErrors.join("; "))

    const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    fixtureName = `MCP验收-${marker}`
    const created = parseToolJson(await client.callTool({
      name: "create_promotion",
      arguments: { name: fixtureName, url: `https://example.com/mcp-acceptance/${marker}`, category: "other", description: "临时 MCP 验收数据", isActive: true },
    }))
    fixtureId = created.promotion?.id
    requireCheck("管理员 create_promotion 成功", Boolean(created.promotion?.id) && created.promotion?.name === fixtureName)
    assert.ok(fixtureId, "管理员 create_promotion 未返回记录 ID，无法继续隔离检查")

    const adminList = parseToolJson(await client.callTool({ name: "list_promotions", arguments: { page: 1, limit: 50 } }))
    const listedFixture = adminList.items.find(item => item.id === fixtureId)
    requireCheck("管理员 list_promotions 能读回新记录", Boolean(listedFixture && listedFixture.isActive === true))
    requireCheck("list_promotions 返回分页结构", ["items", "page", "limit", "total", "totalPages"].every(key => Object.hasOwn(adminList, key)))
    const adminGet = parseToolJson(await client.callTool({ name: "get_promotion", arguments: { id: fixtureId } }))
    requireCheck("管理员 get_promotion 能读取新记录", adminGet.promotion?.id === fixtureId)

    const httpResponse = await fetch(`${baseUrl}/api/promotion`, { headers: { Cookie: adminCookie } })
    const httpBody = await httpResponse.json()
    const httpRows = Array.isArray(httpBody) ? httpBody : httpBody.data
    const httpFixture = Array.isArray(httpRows) ? httpRows.find(item => item.id === fixtureId) : undefined
    requireCheck("list_promotions 记录与 GET /api/promotion 的领域对象一致", httpResponse.ok && sameRecord(httpFixture, listedFixture))
    requireCheck("get_promotion 记录与 GET /api/promotion 的领域对象一致", httpResponse.ok && sameRecord(httpFixture, adminGet.promotion))

    await withMcpClient(endpoint, userToken, async (regularClient) => {
      const regularTools = await regularClient.listTools()
      requireCheck("普通用户工具列表仍包含六个工具", regularTools.tools.length === expectedTools.length && expectedTools.every(name => regularTools.tools.some(tool => tool.name === name)))
      const regularList = parseToolJson(await regularClient.callTool({ name: "list_promotions", arguments: { page: 1, limit: 50 } }))
      requireCheck("普通用户读列表只含上架记录", regularList.items.every(item => item.isActive === true) && regularList.items.some(item => item.id === fixtureId))
      const regularGet = parseToolJson(await regularClient.callTool({ name: "get_promotion", arguments: { id: fixtureId } }))
      requireCheck("普通用户 get_promotion 返回领域对象", regularGet.promotion?.id === fixtureId && regularGet.promotion?.isActive === true)

      const privateList = await regularClient.callTool({ name: "list_promotions", arguments: { includeInactive: true } })
      requireCheck("普通用户 includeInactive 被拒绝（403）", privateList.isError === true && /403/.test(toolText(privateList)))
      const deniedCreate = await regularClient.callTool({ name: "create_promotion", arguments: { name: `${fixtureName}-denied`, url: "https://example.com/denied" } })
      const deniedUpdate = await regularClient.callTool({ name: "update_promotion", arguments: { id: fixtureId, name: "MCP验收-不应写入" } })
      const deniedDelete = await regularClient.callTool({ name: "delete_promotion", arguments: { id: fixtureId } })
      const deniedActive = await regularClient.callTool({ name: "set_promotion_active", arguments: { id: fixtureId, isActive: false } })
      requireCheck("普通用户四个写工具均返回 403", [deniedCreate, deniedUpdate, deniedDelete, deniedActive].every(result => result.isError === true && /403/.test(toolText(result))))
      const rlsProbeName = `${fixtureName}-rls-denied`
      const deniedCreateName = `${fixtureName}-denied`
      rogueNames.push(deniedCreateName)
      rogueNames.push(rlsProbeName)
      await verifyWriteIsolationFlow({
        check: requireCheck,
        findUnexpectedCreate: () => adminDb.from("promotion").select("id").eq("name", deniedCreateName),
        attemptRlsInsert: name => userDb.from("promotion").insert({
          name, url: "https://example.com/rls-denied", category: "other", description: "RLS 拒绝探针", is_active: false,
        }),
        findRlsInsert: name => adminDb.from("promotion").select("id").eq("name", name),
        attemptRlsUpdate: (id, name) => userDb.from("promotion").update({ name }).eq("id", id).select("id").maybeSingle(),
        findFixture: id => adminDb.from("promotion").select("id,name,is_active").eq("id", id).maybeSingle(),
        fixture: { id: fixtureId, name: fixtureName, is_active: true },
        rlsProbeName,
      })
    })

    const afterDeniedWrites = parseToolJson(await client.callTool({ name: "get_promotion", arguments: { id: fixtureId } }))
    requireCheck("被拒绝写操作未改变数据库记录", afterDeniedWrites.promotion?.name === fixtureName && afterDeniedWrites.promotion?.isActive === true)

    const invalidLimit = await client.callTool({ name: "list_promotions", arguments: { limit: 51 } })
    requireCheck("list_promotions 拒绝 limit 大于 50", invalidLimit.isError === true && /400|limit/i.test(toolText(invalidLimit)))

    const updatedName = `${fixtureName}-updated`
    const updated = parseToolJson(await client.callTool({ name: "update_promotion", arguments: { id: fixtureId, name: updatedName } }))
    requireCheck("管理员 update_promotion 成功", updated.promotion?.name === updatedName)
    const disabled = parseToolJson(await client.callTool({ name: "set_promotion_active", arguments: { id: fixtureId, isActive: false } }))
    requireCheck("管理员 set_promotion_active 可下架记录", disabled.promotion?.isActive === false)

    const adminInactive = parseToolJson(await client.callTool({ name: "list_promotions", arguments: { includeInactive: true, page: 1, limit: 50 } }))
    requireCheck("管理员 includeInactive 能读到下架记录（RLS 静默失败探针）", adminInactive.items.some(item => item.id === fixtureId && item.isActive === false))
    await withMcpClient(endpoint, userToken, async (regularClient) => {
      const hidden = await regularClient.callTool({ name: "get_promotion", arguments: { id: fixtureId } })
      requireCheck("普通用户读取下架记录返回 404", hidden.isError === true && /404/.test(toolText(hidden)))
    })

    const removed = parseToolJson(await client.callTool({ name: "delete_promotion", arguments: { id: fixtureId } }))
    const removedAgain = parseToolJson(await client.callTool({ name: "delete_promotion", arguments: { id: fixtureId } }))
    requireCheck("管理员 delete_promotion 软下架且重复调用幂等", removed.id === fixtureId && removed.isActive === false && removedAgain.id === fixtureId)
  })
}
catch (error) {
  if (error instanceof CheckFailure) {
    console.error(`验收执行中断：${error.message}`)
  }
  else {
    check("验收流程完整执行", false, error instanceof Error ? error.message : "未知错误")
  }
}
finally {
  if (fixtureId && adminDb) {
    const cleanup = await confirmRecordDeleted({
      expectedId: fixtureId,
      deleteRecord: async () => ({
        ...(await adminDb.from("promotion").delete().eq("id", fixtureId).select("id").maybeSingle()),
      }),
      findRecord: async () => adminDb.from("promotion").select("id").eq("id", fixtureId).maybeSingle(),
    })
    check("清理 MCP 临时验收记录并确认已删除", cleanup.ok, cleanup.reason ?? "")
  }
  for (const rogueName of rogueNames) {
    const cleanup = await confirmRecordDeleted({
      deleteRecord: async () => adminDb.from("promotion").delete().eq("name", rogueName).select("id"),
      findRecord: async () => adminDb.from("promotion").select("id").eq("name", rogueName),
    })
    check("清理意外验收记录并确认已删除", cleanup.ok, cleanup.reason ?? "")
  }
  if (child && child.exitCode === null) {
    child.kill("SIGTERM")
    const exited = Promise.race([
      once(child, "exit"),
      new Promise(resolveTimeout => setTimeout(() => resolveTimeout(null), 3_000)),
    ])
    if (await exited === null && child.exitCode === null) child.kill("SIGKILL")
  }
}

console.log(`MCP 验收汇总：${reporter.checks - reporter.failures}/${reporter.checks} 项通过，${reporter.failures} 项失败。`)
if (reporter.exitCode > 0) process.exit(reporter.exitCode)
console.log("MCP 端到端验收通过。")
