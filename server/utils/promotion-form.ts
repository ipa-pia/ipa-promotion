import { createError } from "h3"
import {
  PROMOTION_CATEGORY_ORDER,
} from "#shared/types/promotion"
import type {
  PromotionCategory,
  PromotionForm,
} from "#shared/types/promotion"

function isCategory(value: unknown): value is PromotionCategory {
  return typeof value === "string" && (PROMOTION_CATEGORY_ORDER as string[]).includes(value)
}

function optionalString(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const value = raw.trim()
  return value === "" ? null : value
}

/** 完整表单校验（创建 / 整体更新） */
export function parsePromotionForm(input: unknown): PromotionForm {
  if (!input || typeof input !== "object") {
    throw createError({ statusCode: 400, statusMessage: "invalid body" })
  }
  const raw = input as Record<string, unknown>
  const name = typeof raw.name === "string" ? raw.name.trim() : ""
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: "name is required" })
  }
  const url = typeof raw.url === "string" ? raw.url.trim() : ""
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: "url is required" })
  }
  const category = raw.category ?? "other"
  if (!isCategory(category)) {
    throw createError({ statusCode: 400, statusMessage: "invalid category" })
  }
  return {
    name,
    url,
    category,
    description: typeof raw.description === "string" ? raw.description : "",
    rebate: optionalString(raw.rebate),
    inviteCode: optionalString(raw.inviteCode),
    coverUrl: optionalString(raw.coverUrl),
    sort: typeof raw.sort === "number" && Number.isFinite(raw.sort) ? raw.sort : 0,
    isActive: typeof raw.isActive === "boolean" ? raw.isActive : true,
  }
}

/** 部分更新校验（PATCH），仅返回提供的字段 */
export function parsePromotionFormPartial(input: unknown): Partial<PromotionForm> {
  if (!input || typeof input !== "object") {
    throw createError({ statusCode: 400, statusMessage: "invalid body" })
  }
  const raw = input as Record<string, unknown>
  const patch: Partial<PromotionForm> = {}
  if (raw.name !== undefined) {
    const name = typeof raw.name === "string" ? raw.name.trim() : ""
    if (!name) {
      throw createError({ statusCode: 400, statusMessage: "name is required" })
    }
    patch.name = name
  }
  if (raw.url !== undefined) {
    const url = typeof raw.url === "string" ? raw.url.trim() : ""
    if (!url) {
      throw createError({ statusCode: 400, statusMessage: "url is required" })
    }
    patch.url = url
  }
  if (raw.category !== undefined) {
    if (!isCategory(raw.category)) {
      throw createError({ statusCode: 400, statusMessage: "invalid category" })
    }
    patch.category = raw.category
  }
  if (raw.description !== undefined) {
    patch.description = typeof raw.description === "string" ? raw.description : ""
  }
  if (raw.rebate !== undefined) {
    patch.rebate = optionalString(raw.rebate)
  }
  if (raw.inviteCode !== undefined) {
    patch.inviteCode = optionalString(raw.inviteCode)
  }
  if (raw.coverUrl !== undefined) {
    patch.coverUrl = optionalString(raw.coverUrl)
  }
  if (raw.sort !== undefined) {
    patch.sort = typeof raw.sort === "number" && Number.isFinite(raw.sort) ? raw.sort : 0
  }
  if (raw.isActive !== undefined) {
    patch.isActive = typeof raw.isActive === "boolean" ? raw.isActive : undefined
  }
  return patch
}

/** PromotionForm → 插入行（snake_case） */
export function toPromotionInsert(form: PromotionForm): Record<string, unknown> {
  return {
    name: form.name,
    description: form.description ?? "",
    url: form.url,
    category: form.category,
    rebate: form.rebate ?? null,
    invite_code: form.inviteCode ?? null,
    cover_url: form.coverUrl ?? null,
    sort: form.sort ?? 0,
    is_active: form.isActive ?? true,
  }
}

/** PromotionForm → 更新行（snake_case，仅含提供的字段） */
export function toPromotionPatch(patch: Partial<PromotionForm>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.url !== undefined) row.url = patch.url
  if (patch.category !== undefined) row.category = patch.category
  if (patch.description !== undefined) row.description = patch.description
  if (patch.rebate !== undefined) row.rebate = patch.rebate
  if (patch.inviteCode !== undefined) row.invite_code = patch.inviteCode
  if (patch.coverUrl !== undefined) row.cover_url = patch.coverUrl
  if (patch.sort !== undefined) row.sort = patch.sort
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  return row
}