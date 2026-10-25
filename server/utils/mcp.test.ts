import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { User } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"
import { compareMcpToolSchemas, confirmRecordDeleted, isRlsInsertRejected } from "../../scripts/verify-mcp-helpers.mjs"
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

  it("confirms fixture deletion and catches no-op, remaining rows, query errors and exceptions", async () => {
    const input = {
      deleteRecord: async () => ({ expectedId: "fixture-1", data: { id: "fixture-1" } }),
      findRecord: async () => ({ data: null }),
    }
    await expect(confirmRecordDeleted(input)).resolves.toEqual({ ok: true })
    await expect(confirmRecordDeleted({
      ...input,
      deleteRecord: async () => ({ expectedId: "fixture-1", data: null }),
    })).resolves.toEqual({ ok: false, reason: "delete did not return the target id" })
    await expect(confirmRecordDeleted({
      ...input,
      findRecord: async () => ({ data: { id: "fixture-1" } }),
    })).resolves.toEqual({ ok: false, reason: "record still exists" })
    await expect(confirmRecordDeleted({
      ...input,
      deleteRecord: async () => ({ expectedId: "fixture-1", data: { id: "fixture-1" }, error: new Error("delete failed") }),
    })).resolves.toEqual({ ok: false, reason: "delete request failed" })
    await expect(confirmRecordDeleted({
      ...input,
      findRecord: async () => ({ data: null, error: new Error("query failed") }),
    })).resolves.toEqual({ ok: false, reason: "post-delete query failed" })
    await expect(confirmRecordDeleted({
      ...input,
      findRecord: async () => { throw new Error("network failure") },
    })).resolves.toEqual({ ok: false, reason: "cleanup threw an error" })
  })
})
