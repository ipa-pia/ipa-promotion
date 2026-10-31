import { createError } from "h3"
import { mapPromotionRow } from "../../shared/types/promotion"
import type { PromotionForm, PromotionRow } from "../../shared/types/promotion"
import { toPromotionInsert, toPromotionPatch } from "./promotion-form"

export interface PromotionMcpIdentity {
  token: string
  isAdmin: boolean
}

function fail(statusCode: number, message: string): never {
  throw createError({ statusCode, statusMessage: message })
}

function throwDatabaseError(error: { message: string }): never {
  throw createError({ statusCode: 500, statusMessage: error.message || "promotion database error" })
}

/** Request-scoped adapter: every PostgREST request carries the caller JWT for RLS. */
export function createPromotionMcpDataAccess(identity: PromotionMcpIdentity) {
  const supabase = createTokenSupabaseClient(identity.token)

  return {
    async list(input: { category?: "llm" | "vpn" | "other"; includeInactive: boolean; page: number; limit: number }) {
      if (input.includeInactive && !identity.isAdmin) fail(403, "forbidden: admin required")

      const from = (input.page - 1) * input.limit
      let query = supabase.from("promotion").select("*", { count: "exact" })
      if (!input.includeInactive) query = query.eq("is_active", true)
      if (input.category) query = query.eq("category", input.category)
      const { data, error, count } = await query
        .order("sort", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, from + input.limit - 1)
      if (error) throwDatabaseError(error)
      const total = count ?? 0
      return {
        items: (data ?? []).map(row => mapPromotionRow(row as PromotionRow)),
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      }
    },

    async get(id: string) {
      let query = supabase.from("promotion").select("*").eq("id", id)
      if (!identity.isAdmin) query = query.eq("is_active", true)
      const { data, error } = await query.maybeSingle()
      if (error) throwDatabaseError(error)
      if (!data) fail(404, "promotion not found")
      return { promotion: mapPromotionRow(data as PromotionRow) }
    },

    async create(form: PromotionForm) {
      if (!identity.isAdmin) fail(403, "forbidden: admin required")
      const { data, error } = await supabase.from("promotion")
        .insert(toPromotionInsert(form))
        .select()
        .single()
      if (error) throwDatabaseError(error)
      return { promotion: mapPromotionRow(data as PromotionRow) }
    },

    async update(id: string, patch: Partial<PromotionForm>) {
      if (!identity.isAdmin) fail(403, "forbidden: admin required")
      const row = toPromotionPatch(patch)
      if (Object.keys(row).length === 0) fail(400, "empty patch")
      const { data, error } = await supabase.from("promotion")
        .update(row)
        .eq("id", id)
        .select()
        .maybeSingle()
      if (error) throwDatabaseError(error)
      if (!data) fail(404, "promotion not found")
      return { promotion: mapPromotionRow(data as PromotionRow) }
    },

    async remove(id: string) {
      if (!identity.isAdmin) fail(403, "forbidden: admin required")
      const { data, error } = await supabase.from("promotion")
        .update({ is_active: false })
        .eq("id", id)
        .select("id, is_active")
        .maybeSingle()
      if (error) throwDatabaseError(error)
      if (!data) fail(404, "promotion not found")
      return { id: data.id as string, isActive: false as const }
    },

    async setActive(id: string, isActive: boolean) {
      if (!identity.isAdmin) fail(403, "forbidden: admin required")
      const { data, error } = await supabase.from("promotion")
        .update({ is_active: isActive })
        .eq("id", id)
        .select()
        .maybeSingle()
      if (error) throwDatabaseError(error)
      if (!data) fail(404, "promotion not found")
      return { promotion: mapPromotionRow(data as PromotionRow) }
    },
  }
}
