import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import type { User } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"
import {
  compareMcpToolSchemas,
  confirmRecordDeleted,
  inspectNoUnexpectedRows,
  isRlsInsertRejected,
  verifyRlsUpdateDenied,
  verifyWriteIsolationFlow,
} from "../../scripts/verify-mcp-helpers.mjs"
import { createPromotionMcpServer } from "./mcp"

describe("promotion MCP tools", () => {
  it("lists the six designed tools and enforces strict tool input schemas", async () => {
    const create = vi.fn()
    const access = {
      list: vi.fn(async () => ({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 })),
      get: vi.fn(),
      create,
      update: vi.fn(),
      remove: vi.fn(),
      setActive: vi.fn(),
    } as never
    const server = createPromotionMcpServer({
      token: "unit-test-token",
      user: { id: "user-1", app_metadata: {} } as User,
      dataAccess: access,
    })
    const client = new Client({ name: "mcp-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    await server.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const tools = await client.listTools()
      expect(tools.tools.map(tool => tool.name)).toEqual([
        "list_promotions",
        "get_promotion",
        "create_promotion",
        "update_promotion",
        "delete_promotion",
        "set_promotion_active",
      ])
      expect(compareMcpToolSchemas(tools.tools)).toEqual([])

      const changedSchema = structuredClone(tools.tools) as unknown as Array<{
        name: string
        inputSchema: { properties: Record<string, Record<string, unknown>> }
      }>
      const listSchema = changedSchema.find(tool => tool.name === "list_promotions")
      if (!listSchema) throw new Error("list_promotions tool missing from test client")
      listSchema.inputSchema.properties.limit = { maximum: 100 }
      expect(compareMcpToolSchemas(changedSchema)).toContain("list_promotions.limit: schema does not match")

      const patternDrift = structuredClone(tools.tools) as unknown as Array<{
        name: string
        inputSchema: { properties: Record<string, Record<string, unknown>> }
      }>
      const createSchema = patternDrift.find(tool => tool.name === "create_promotion")
      if (!createSchema) throw new Error("create_promotion tool missing from test client")
      const nameSchema = createSchema.inputSchema.properties.name
      if (!nameSchema) throw new Error("create_promotion name schema missing from test client")
      nameSchema.pattern = "^[A-Z]"
      expect(compareMcpToolSchemas(patternDrift)).toContain("create_promotion.name: schema does not match")

      const invalid = await client.callTool({
        name: "create_promotion",
        arguments: { name: "Example", url: "https://example.com", unexpected: true },
      })
      expect(invalid.isError).toBe(true)
      expect(create).not.toHaveBeenCalled()

      const invalidPagination = await client.callTool({
        name: "list_promotions",
        arguments: { limit: 51 },
      })
      expect(invalidPagination.isError).toBe(true)
    }
    finally {
      await client.close()
      await server.close()
    }
  })
})

describe("MCP acceptance verification helpers", () => {
  it("requires an RLS error code and admin-confirmed absence for rejected inserts", () => {
    expect(isRlsInsertRejected({ code: "42501" }, [])).toBe(true)
    expect(isRlsInsertRejected(null, [])).toBe(false)
    expect(isRlsInsertRejected({ code: "42501" }, [{ id: "unexpected-row" }])).toBe(false)
    expect(isRlsInsertRejected({ code: "23505" }, [])).toBe(false)
  })

  it("treats RLS zero-row updates as denied only when admin confirms no change", () => {
    const unchanged = { data: { id: "fixture-1", name: "before", is_active: true } }
    const expected = { id: "fixture-1", name: "before", is_active: true }
    expect(verifyRlsUpdateDenied({ data: null, error: null }, unchanged, expected)).toEqual({ ok: true })
    expect(verifyRlsUpdateDenied({ data: [], error: null }, unchanged, expected)).toEqual({ ok: true })
    expect(verifyRlsUpdateDenied({ data: null, error: { code: "42501" } }, unchanged, expected)).toEqual({ ok: true })
    expect(verifyRlsUpdateDenied({ data: null, error: { code: "ECONNRESET" } }, unchanged, expected).ok).toBe(false)
    expect(verifyRlsUpdateDenied({ data: { id: "fixture-1" }, error: null }, unchanged, expected).ok).toBe(false)
    expect(verifyRlsUpdateDenied({ data: null, error: null }, { data: null, error: { message: "query failed" } }, expected).ok).toBe(false)
    expect(verifyRlsUpdateDenied({ data: null, error: null }, { data: { ...unchanged.data, name: "tampered" } }, expected).ok).toBe(false)
  })

  it("fails when denied-write verification queries error or find unexpected rows", () => {
    expect(inspectNoUnexpectedRows({ data: [], error: null })).toEqual({ ok: true, rows: [] })
    expect(inspectNoUnexpectedRows({ error: null }).ok).toBe(false)
    expect(inspectNoUnexpectedRows({ data: null, error: { message: "database unavailable" } }).ok).toBe(false)
    expect(inspectNoUnexpectedRows({ data: [{ id: "unexpected" }], error: null }).ok).toBe(false)
  })

  it("runs the write-isolation flow and accepts an RLS zero-row update after admin verification", async () => {
    const checks: Array<[string, boolean, string?]> = []
    const flow = await verifyWriteIsolationFlow({
      check: (label: string, condition: boolean, detail?: string) => checks.push([label, condition, detail]),
      findUnexpectedCreate: async () => ({ data: [], error: null }),
      attemptRlsInsert: async () => ({ data: null, error: { code: "42501" } }),
      findRlsInsert: async () => ({ data: [], error: null }),
      attemptRlsUpdate: async () => ({ data: null, error: null }),
      findFixture: async () => ({ data: { id: "fixture-1", name: "before", is_active: true } }),
      fixture: { id: "fixture-1", name: "before", is_active: true },
      rlsProbeName: "probe-1",
    })
    expect(flow.insertDenied).toBe(true)
    expect(flow.updateAudit).toEqual({ ok: true })
    expect(checks).toHaveLength(3)
    expect(checks.every(([, condition]) => condition)).toBe(true)
  })

  it("confirms fixture and rogue deletes and catches no-op, residual rows, query errors and exceptions", async () => {
    const input = {
      expectedId: "fixture-1",
      deleteRecord: async () => ({ data: { id: "fixture-1" } }),
      findRecord: async () => ({ data: null }),
    }
    await expect(confirmRecordDeleted(input)).resolves.toEqual({ ok: true })
    await expect(confirmRecordDeleted({
      ...input,
      deleteRecord: async () => ({ data: null }),
    })).resolves.toEqual({ ok: false, reason: "delete did not return the target id" })
    await expect(confirmRecordDeleted({
      ...input,
      findRecord: async () => ({ data: { id: "fixture-1" } }),
    })).resolves.toEqual({ ok: false, reason: "record still exists" })
    await expect(confirmRecordDeleted({
      ...input,
      deleteRecord: async () => ({ data: { id: "fixture-1" }, error: new Error("delete failed") }),
    })).resolves.toEqual({ ok: false, reason: "delete request failed" })
    await expect(confirmRecordDeleted({
      ...input,
      findRecord: async () => ({ data: null, error: new Error("query failed") }),
    })).resolves.toEqual({ ok: false, reason: "post-delete query failed" })
    await expect(confirmRecordDeleted({
      ...input,
      findRecord: async () => { throw new Error("network failure") },
    })).resolves.toEqual({ ok: false, reason: "cleanup threw an error" })

    await expect(confirmRecordDeleted({
      deleteRecord: async () => ({ data: [] }),
      findRecord: async () => ({ data: [{ id: "rogue-1" }] }),
    })).resolves.toEqual({ ok: false, reason: "record still exists" })
    await expect(confirmRecordDeleted({
      deleteRecord: async () => ({ data: [] }),
      findRecord: async () => ({ data: null, error: new Error("query failed") }),
    })).resolves.toEqual({ ok: false, reason: "post-delete query failed" })
  })

  it("propagates acceptance guard-flow failures to the real nonzero process exit", () => {
    const result = spawnSync(process.execPath, [resolve(process.cwd(), "scripts/verify-mcp-guard-flow.mjs")], { encoding: "utf8" })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain("MCP guard flow: 4 failures; exit 1")
  })
})
