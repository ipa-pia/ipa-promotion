import { mapPromotionRow } from "#shared/types/promotion"
import type { PromotionRow } from "#shared/types/promotion"
import { requireAdminSession } from "../../utils/promotion-admin"

export default defineApiHandler(async (event) => {
  await requireAdminSession(event)
  const supabase = createServerSupabaseClient(event)
  const { data, error } = await supabase
    .from("promotion")
    .select("*")
    .order("sort", { ascending: false })
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => mapPromotionRow(row as PromotionRow))
})