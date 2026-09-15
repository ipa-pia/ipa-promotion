export type PromotionCategory = "llm" | "vpn" | "other"

export const PROMOTION_CATEGORY_ORDER: PromotionCategory[] = ["llm", "vpn", "other"]

export const PROMOTION_CATEGORY_LABELS: Record<PromotionCategory, string> = {
  llm: "大模型",
  vpn: "网络工具",
  other: "其他",
}

/** Supabase 表 promotion 的原始行（snake_case） */
export interface PromotionRow {
  id: string
  name: string
  description: string
  url: string
  category: string
  rebate: string | null
  invite_code: string | null
  cover_url: string | null
  sort: number
  is_active: boolean
  created_at: string
  updated_at: string
}

/** DB 行（promotion 表） */
export interface Promotion {
  id: string
  name: string
  description: string
  url: string
  category: PromotionCategory
  rebate: string | null
  inviteCode: string | null
  coverUrl: string | null
  sort: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** 创建/编辑提交载荷 */
export interface PromotionForm {
  name: string
  url: string
  category: PromotionCategory
  description?: string
  rebate?: string | null
  inviteCode?: string | null
  coverUrl?: string | null
  sort?: number
  isActive?: boolean
}

/** 列表查询参数 */
export interface PromotionListParams {
  category?: PromotionCategory
  includeInactive?: boolean
}

/** 封面上传响应 */
export interface PromotionCoverResult {
  path: string
  publicUrl: string
}

/** /api/me 响应 */
export interface MeResult {
  userId: string
  email: string
  isAdmin: boolean
}

export function mapPromotionRow(row: PromotionRow): Promotion {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    category: row.category as PromotionCategory,
    rebate: row.rebate,
    inviteCode: row.invite_code,
    coverUrl: row.cover_url,
    sort: row.sort,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}