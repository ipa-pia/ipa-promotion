import { mapPromotionRow } from "#shared/types/promotion"
import type { PromotionRow } from "#shared/types/promotion"
import { parsePromotionFormPartial, toPromotionPatch } from "../../utils/promotion-form"
import { requireAdminSession } from "../../utils/promotion-admin"

export default defineApiHandler(async (event) => {
  await requireAdminSession(event)
  const id = getRouterParam(event, "id")
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "id is required" })
  }
  const body = await readBody(event)
  const patch = parsePromotionFormPartial(body)
  const row = toPromotionPatch(patch)
  if (Object.keys(row).length === 0) {
    throw createError({ statusCode: 400, statusMessage: "empty patch" })
  }
  const supabase = createServerSupabaseClient(event)
  const { data, error } = await supabase
    .from("promotion")
    .update(row)
    .eq("id", id)
    .select()
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: "promotion not found" })
  }
  return mapPromotionRow(data as PromotionRow)
})