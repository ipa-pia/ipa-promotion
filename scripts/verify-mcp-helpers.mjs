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

function hasUnexpectedKeys(value, allowed) {
  return Object.keys(value ?? {}).some(key => !allowed.includes(key))
}

function matchesField(actual, expected) {
  if (expected.type?.includes?.("null")) {
    if (!nullableString(actual)) return false
  }
  else if (actual?.type !== expected.type) {
    return false
  }

  const nullableUnion = Array.isArray(actual?.anyOf) ? actual.anyOf
    : Array.isArray(actual?.oneOf) ? actual.oneOf
      : null
  const expectedKeys = Object.keys(expected).filter(key => key !== "type")
  if (nullableUnion) {
    const nullableKeys = ["anyOf", "oneOf", ...(Object.hasOwn(expected, "default") ? ["default"] : [])]
    if (hasUnexpectedKeys(actual, nullableKeys)) return false
    const stringVariant = nullableUnion.find(option => option.type === "string")
    const nullVariant = nullableUnion.find(option => option.type === "null")
    if (!stringVariant || !nullVariant
      || hasUnexpectedKeys(stringVariant, ["type", ...expectedKeys])
      || hasUnexpectedKeys(nullVariant, ["type"])) return false
  }
  else if (hasUnexpectedKeys(actual, ["type", ...expectedKeys])) {
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
    if (hasUnexpectedKeys(schema, ["type", "properties", "required", "additionalProperties", "$schema"])) {
      errors.push(`${name}: schema contains an unexpected constraint`)
    }
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

export function inspectNoUnexpectedRows(result) {
  if (result?.error) return { ok: false, reason: "verification query failed", rows: [] }
  if (!Array.isArray(result?.data)) return { ok: false, reason: "verification query returned no rowset", rows: [] }
  const rows = result.data
  if (rows.length) return { ok: false, reason: "unexpected rows were written", rows }
  return { ok: true, rows }
}

export function verifyRlsUpdateDenied(updateResult, adminRecordResult, expectedRecord) {
  const changedRows = Array.isArray(updateResult?.data) ? updateResult.data.length > 0 : updateResult?.data != null
  if (changedRows) {
    return { ok: false, reason: "update returned a changed row" }
  }
  if (updateResult?.error && updateResult.error.code !== "42501") {
    return { ok: false, reason: "update failed for a reason other than RLS" }
  }
  if (adminRecordResult?.error) return { ok: false, reason: "admin verification query failed" }
  if (!adminRecordResult?.data) return { ok: false, reason: "admin could not find the fixture" }
  for (const [key, value] of Object.entries(expectedRecord)) {
    if (adminRecordResult.data[key] !== value) return { ok: false, reason: `fixture changed: ${key}` }
  }
  return { ok: true }
}

export async function verifyWriteIsolationFlow({
  check,
  findUnexpectedCreate,
  attemptRlsInsert,
  findRlsInsert,
  attemptRlsUpdate,
  findFixture,
  fixture,
  rlsProbeName,
}) {
  const unexpectedWrite = await findUnexpectedCreate()
  const createAudit = inspectNoUnexpectedRows(unexpectedWrite)
  check("管理员查询确认被拒绝的 create 没有写入记录", createAudit.ok, createAudit.reason ?? "")

  const directInsert = await attemptRlsInsert(rlsProbeName)
  const insertedProbe = await findRlsInsert(rlsProbeName)
  const insertDenied = !insertedProbe?.error
    && Array.isArray(insertedProbe?.data)
    && isRlsInsertRejected(directInsert?.error, insertedProbe.data)
  check("普通用户直连 PostgREST insert 被 RLS 拒绝", insertDenied,
    insertedProbe?.error?.message ?? directInsert?.error?.code ?? "insert 未返回 RLS 错误 42501 或数据仍存在")

  const directUpdate = await attemptRlsUpdate(fixture.id, `${fixture.name}-rls-tampered`)
  const fixtureAfterUpdate = await findFixture(fixture.id)
  const updateAudit = verifyRlsUpdateDenied(directUpdate, fixtureAfterUpdate, fixture)
  check("普通用户直连 PostgREST update 被 RLS 拒绝或零行影响，且管理员确认记录未变", updateAudit.ok, updateAudit.reason ?? "")

  return { createAudit, insertDenied, updateAudit }
}

/**
 * @param {{ deleteRecord: () => Promise<any>, findRecord: () => Promise<any>, expectedId?: string | number | null }} options
 */
export async function confirmRecordDeleted(options) {
  const { deleteRecord, findRecord, expectedId = null } = options
  try {
    const deletion = await deleteRecord()
    if (deletion.error) return { ok: false, reason: "delete request failed" }
    const deletedRows = Array.isArray(deletion.data) ? deletion.data : deletion.data ? [deletion.data] : []
    if (expectedId != null && !deletedRows.some(row => String(row.id) === String(expectedId))) {
      return { ok: false, reason: "delete did not return the target id" }
    }

    const verification = await findRecord()
    if (verification.error) return { ok: false, reason: "post-delete query failed" }
    const remainingRows = Array.isArray(verification.data) ? verification.data : verification.data ? [verification.data] : []
    if (remainingRows.length) return { ok: false, reason: "record still exists" }
    return { ok: true }
  }
  catch {
    return { ok: false, reason: "cleanup threw an error" }
  }
}

export function createCheckReporter({ log = console.log, error = console.error } = {}) {
  let checks = 0
  let failures = 0
  function check(label, condition, detail = "") {
    checks++
    if (condition) {
      log(`通过：${label}`)
      return
    }
    failures++
    error(`失败：${label}${detail ? `；${detail}` : ""}`)
  }
  function requireCheck(label, condition, detail = "") {
    check(label, condition, detail)
    if (!condition) throw new Error(`${label}${detail ? `；${detail}` : ""}`)
  }
  return {
    check,
    requireCheck,
    get checks() { return checks },
    get failures() { return failures },
    get exitCode() { return failures > 0 ? 1 : 0 },
  }
}
