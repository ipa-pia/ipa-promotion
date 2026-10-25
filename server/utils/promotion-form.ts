import { createError } from "h3"
import {
  promotionCreateSchema,
  promotionUpdateSchema,
} from "../../shared/contracts/promotion"
import type { PromotionForm } from "../../shared/types/promotion"
import { toAbsoluteUrl } from "../../shared/utils/url"

function parseOrBadRequest<T>(result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }): T {
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? "invalid body" })
  }
  return result.data
}

/** 完整表单校验（创建 / 整体更新）；契约定义见 shared/contracts/promotion.ts。 */
export function parsePromotionForm(input: unknown): PromotionForm {
  return parseOrBadRequest(promotionCreateSchema.safeParse(input))
}

/** 部分更新校验（PATCH），只返回显式提供的字段。 */
export function parsePromotionFormPartial(input: unknown): Partial<PromotionForm> {
  return parseOrBadRequest(promotionUpdateSchema.safeParse(input))
}

/** PromotionForm → 插入行（snake_case），也是 URL 与空文本的唯一归一化入口。 */
export function toPromotionInsert(form: PromotionForm): Record<string, unknown> {
  return {
    name: form.name,
    description: form.description ?? "",
    url: toAbsoluteUrl(form.url),
    category: form.category,
    rebate: form.rebate || null,
    invite_code: form.inviteCode || null,
    cover_url: form.coverUrl || null,
    sort: form.sort ?? 0,
    is_active: form.isActive ?? true,
  }
}

/** PromotionForm → 更新行（snake_case，仅含提供字段）。 */
export function toPromotionPatch(patch: Partial<PromotionForm>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.url !== undefined) row.url = toAbsoluteUrl(patch.url)
  if (patch.category !== undefined) row.category = patch.category
  if (patch.description !== undefined) row.description = patch.description
  if (patch.rebate !== undefined) row.rebate = patch.rebate || null
  if (patch.inviteCode !== undefined) row.invite_code = patch.inviteCode || null
  if (patch.coverUrl !== undefined) row.cover_url = patch.coverUrl || null
  if (patch.sort !== undefined) row.sort = patch.sort
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  return row
}
