import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { User } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"
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
