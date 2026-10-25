import {
  compareMcpToolSchemas,
  confirmRecordDeleted,
  createCheckReporter,
  expectedMcpToolSchemas,
  verifyWriteIsolationFlow,
} from "./verify-mcp-helpers.mjs"

const reporter = createCheckReporter({ log: () => {}, error: () => {} })
const tools = Object.entries(expectedMcpToolSchemas).map(([name, expected]) => ({
  name,
  inputSchema: {
    type: "object",
    properties: structuredClone(expected.properties),
    required: expected.required,
    additionalProperties: false,
  },
}))
tools.find(tool => tool.name === "create_promotion").inputSchema.properties.name.pattern = "^[A-Z]"
reporter.check("schema rejects undeclared pattern constraint", compareMcpToolSchemas(tools).length === 0)

await verifyWriteIsolationFlow({
  check: reporter.check,
  findUnexpectedCreate: async () => ({ data: null, error: { message: "database unavailable" } }),
  attemptRlsInsert: async () => ({ data: null, error: { code: "42501" } }),
  findRlsInsert: async () => ({ data: [], error: null }),
  attemptRlsUpdate: async () => ({ data: null, error: { code: "ECONNRESET" } }),
  findFixture: async () => ({ data: { id: "fixture-1", name: "original", is_active: true } }),
  fixture: { id: "fixture-1", name: "original", is_active: true },
  rlsProbeName: "fixture-rls-insert",
})

const cleanup = await confirmRecordDeleted({
  expectedId: "rogue-1",
  deleteRecord: async () => ({ data: null }),
  findRecord: async () => ({ data: { id: "rogue-1" } }),
})
reporter.check("no-op rogue cleanup with a residual row fails", cleanup.ok)

console.log(`MCP guard flow: ${reporter.failures} failures; exit ${reporter.exitCode}`)
process.exit(reporter.exitCode)
