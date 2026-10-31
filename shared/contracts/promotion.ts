import { z } from "zod"
import { toAbsoluteUrl } from "../utils/url"

export const PROMOTION_CATEGORIES = ["llm", "vpn", "other"] as const

export const promotionCategorySchema = z.enum(PROMOTION_CATEGORIES)
export const promotionIdSchema = z.string().trim().min(1).max(64)
export const promotionNameSchema = z.string().trim().min(1, "name is required").max(120)
export const promotionUrlSchema = z.string().trim().min(1, "url is required").max(2048)
  .refine(value => /^https?:\/\//i.test(toAbsoluteUrl(value)), "url must be an absolute http(s) URL")
export const promotionDescriptionSchema = z.string().max(2000)
export const promotionTextSchema = z.string().trim().max(200).nullable()
export const promotionCoverUrlSchema = z.string().trim().max(2048).nullable()
export const promotionSortSchema = z.number().int("sort must be an integer").min(-1_000_000).max(1_000_000)
export const promotionActiveSchema = z.boolean()

export const promotionCreateSchema = z.object({
  name: promotionNameSchema,
  url: promotionUrlSchema,
  category: promotionCategorySchema.default("other"),
  description: promotionDescriptionSchema.default(""),
  rebate: promotionTextSchema.default(null),
  inviteCode: promotionTextSchema.default(null),
  coverUrl: promotionCoverUrlSchema.default(null),
  sort: promotionSortSchema.default(0),
  isActive: promotionActiveSchema.default(true),
}).strict()

export const promotionUpdateSchema = z.object({
  name: promotionNameSchema.optional(),
  url: promotionUrlSchema.optional(),
  category: promotionCategorySchema.optional(),
  description: promotionDescriptionSchema.optional(),
  rebate: promotionTextSchema.optional(),
  inviteCode: promotionTextSchema.optional(),
  coverUrl: promotionCoverUrlSchema.optional(),
  sort: promotionSortSchema.optional(),
  isActive: promotionActiveSchema.optional(),
}).strict()

export const promotionListQuerySchema = z.object({
  category: promotionCategorySchema.optional(),
  includeInactive: z.boolean().default(false),
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(50).default(20),
}).strict()

export const promotionGetSchema = z.object({ id: promotionIdSchema }).strict()
export const promotionDeleteSchema = z.object({ id: promotionIdSchema }).strict()
export const promotionSetActiveSchema = z.object({
  id: promotionIdSchema,
  isActive: promotionActiveSchema,
}).strict()

export type PromotionCreateInput = z.infer<typeof promotionCreateSchema>
export type PromotionUpdateInput = z.infer<typeof promotionUpdateSchema>
export type PromotionListQuery = z.infer<typeof promotionListQuerySchema>
