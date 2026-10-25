const category = { type: "string", enum: ["llm", "vpn", "other"] }
const id = { type: "string", minLength: 1, maxLength: 64 }
const name = { type: "string", minLength: 1, maxLength: 120 }
const url = { type: "string", minLength: 1, maxLength: 2048 }
const shortNullableText = { type: ["string", "null"], maxLength: 200 }
const coverNullableText = { type: ["string", "null"], maxLength: 2048 }
const description = { type: "string", maxLength: 2000 }
const sort = { type: "integer", minimum: -1_000_000, maximum: 1_000_000 }
const isActive = { type: "boolean" }

const createFields = {
  name,
  url,
  category: { ...category, default: "other" },
  description: { ...description, default: "" },
  rebate: { ...shortNullableText, default: null },
  inviteCode: { ...shortNullableText, default: null },
  coverUrl: { ...coverNullableText, default: null },
  sort: { ...sort, default: 0 },
  isActive: { ...isActive, default: true },
}
const updateFields = {
  id,
  name,
  url,
  category,
  description,
  rebate: shortNullableText,
  inviteCode: shortNullableText,
  coverUrl: coverNullableText,
  sort,
  isActive,
}

export const expectedMcpToolSchemas = {
  list_promotions: {
    required: [],
    properties: {
      category,
      includeInactive: { type: "boolean", default: false },
      page: { type: "integer", minimum: 1, maximum: 10_000, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    },
  },
  get_promotion: { required: ["id"], properties: { id } },
  create_promotion: { required: ["name", "url"], properties: createFields },
  update_promotion: { required: ["id"], properties: updateFields },
  delete_promotion: { required: ["id"], properties: { id } },
  set_promotion_active: { required: ["id", "isActive"], properties: { id, isActive } },
}

function nullableString(schema) {
  return (Array.isArray(schema?.type) && schema.type.includes("string") && schema.type.includes("null"))
    || [schema?.anyOf, schema?.oneOf].some(options => Array.isArray(options)
      && options.some(option => option.type === "string")
      && options.some(option => option.type === "null"))
}

function matchesField(actual, expected) {
  if (expected.type?.includes?.("null")) {
    if (!nullableString(actual)) return false
  }
  else if (actual?.type !== expected.type) {
    return false
  }

  const stringVariant = Array.isArray(actual?.anyOf)
    ? actual.anyOf.find(option => option.type === "string")
    : Array.isArray(actual?.oneOf)
      ? actual.oneOf.find(option => option.type === "string")
      : actual
  for (const key of ["enum", "minLength", "maxLength", "minimum", "maximum", "default"]) {
    const actualValue = key === "default" ? actual?.[key] : (stringVariant?.[key] ?? actual?.[key])
    if (Object.hasOwn(expected, key) && JSON.stringify(actualValue) !== JSON.stringify(expected[key])) return false
  }
  return true
}

export function compareMcpToolSchemas(tools) {
  const errors = []
  const byName = new Map(tools.map(tool => [tool.name, tool]))

  for (const [name, expected] of Object.entries(expectedMcpToolSchemas)) {
    const tool = byName.get(name)
    if (!tool) {
      errors.push(`${name}: missing tool`)
      continue
    }

    const schema = tool.inputSchema
    if (schema?.type !== "object") errors.push(`${name}: input schema must be an object`)
    if (schema?.additionalProperties !== false) errors.push(`${name}: schema must reject unknown fields`)
    if (JSON.stringify([...(schema?.required ?? [])].sort()) !== JSON.stringify([...expected.required].sort())) {
      errors.push(`${name}: required fields do not match`)
    }

    const actualProperties = schema?.properties ?? {}
    const expectedNames = Object.keys(expected.properties).sort()
    if (JSON.stringify(Object.keys(actualProperties).sort()) !== JSON.stringify(expectedNames)) {
      errors.push(`${name}: property names do not match`)
    }
    for (const [fieldName, fieldSchema] of Object.entries(expected.properties)) {
      if (!matchesField(actualProperties[fieldName], fieldSchema)) errors.push(`${name}.${fieldName}: schema does not match`)
    }
  }

  const extras = tools.map(tool => tool.name).filter(name => !Object.hasOwn(expectedMcpToolSchemas, name))
  if (extras.length) errors.push(`unexpected tools: ${extras.join(", ")}`)
  return errors
}

export function isRlsInsertRejected(error, rows) {
  return error?.code === "42501" && Array.isArray(rows) && rows.length === 0
}

export async function confirmRecordDeleted({ deleteRecord, findRecord }) {
  try {
    const deletion = await deleteRecord()
    if (deletion.error) return { ok: false, reason: "delete request failed" }
    if (String(deletion.data?.id ?? "") !== String(deletion.expectedId)) {
      return { ok: false, reason: "delete did not return the target id" }
    }

    const verification = await findRecord()
    if (verification.error) return { ok: false, reason: "post-delete query failed" }
    if (verification.data) return { ok: false, reason: "record still exists" }
    return { ok: true }
  }
  catch {
    return { ok: false, reason: "cleanup threw an error" }
  }
}
