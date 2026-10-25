import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { User } from "@supabase/supabase-js"
import { z } from "zod"
import {
  promotionCreateSchema,
  promotionDeleteSchema,
  promotionGetSchema,
  promotionListQuerySchema,
  promotionSetActiveSchema,
  promotionUpdateSchema,
} from "../../shared/contracts/promotion"
import { assertAdmin, isAdminUser } from "./auth-identity"
import { createPromotionMcpDataAccess } from "./mcp-data-access"
import { parsePromotionForm, parsePromotionFormPartial } from "./promotion-form"

const promotionUpdateWithIdSchema = z.object({
  id: z.string().trim().min(1).max(64),
  ...promotionUpdateSchema.shape,
}).strict()

function success(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] }
}

function failure(error: unknown) {
  const value = error as { statusCode?: number; status?: number; statusMessage?: string; message?: string }
  const status = value.statusCode ?? value.status ?? 500
  const message = value.statusMessage ?? value.message ?? "internal error"
  return { content: [{ type: "text" as const, text: `错误 ${status}：${message}` }], isError: true }
}

async function execute<T>(callback: () => Promise<T>) {
  try {
    return success(await callback())
  }
  catch (error) {
    return failure(error)
  }
}

export function createPromotionMcpServer(input: {
  token: string
  user: User
  dataAccess?: ReturnType<typeof createPromotionMcpDataAccess>
}) {
  const isAdmin = isAdminUser(input.user)
  const access = input.dataAccess ?? createPromotionMcpDataAccess({ token: input.token, isAdmin })
  const server = new McpServer({
    name: "ipa-promotion",
    version: "1.0.0",
  }, {
    instructions: "Read tools are available to any authenticated user. Write tools require app_metadata.role === admin.",
  })

  server.registerTool("list_promotions", {
    description: "列出推广链接。默认只返回已上架记录；includeInactive 仅管理员可用。",
    inputSchema: promotionListQuerySchema,
  }, args => execute(() => access.list(args)))

  server.registerTool("get_promotion", {
    description: "读取一条推广链接；非管理员读取下架记录时返回 404。",
    inputSchema: promotionGetSchema,
  }, args => execute(() => access.get(args.id)))

  server.registerTool("create_promotion", {
    description: "创建推广链接（管理员）。",
    inputSchema: promotionCreateSchema,
  }, args => execute(() => {
    assertAdmin(input.user)
    return access.create(parsePromotionForm(args))
  }))

  server.registerTool("update_promotion", {
    description: "部分更新推广链接（管理员）；至少提供一个要更新的字段。",
    inputSchema: promotionUpdateWithIdSchema,
  }, args => execute(() => {
    assertAdmin(input.user)
    const { id, ...patchInput } = args
    return access.update(id, parsePromotionFormPartial(patchInput))
  }))

  server.registerTool("delete_promotion", {
    description: "下架推广链接（软删除，管理员）。重复下架是幂等操作。",
    inputSchema: promotionDeleteSchema,
  }, args => execute(() => {
    assertAdmin(input.user)
    return access.remove(args.id)
  }))

  server.registerTool("set_promotion_active", {
    description: "启用或停用推广链接（管理员）。",
    inputSchema: promotionSetActiveSchema,
  }, args => execute(() => {
    assertAdmin(input.user)
    return access.setActive(args.id, args.isActive)
  }))

  return server
}
