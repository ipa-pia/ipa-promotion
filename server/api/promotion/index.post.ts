import { mapPromotionRow } from "#shared/types/promotion"
import type { PromotionRow } from "#shared/types/promotion"
import { parsePromotionForm, toPromotionInsert } from "../../utils/promotion-form"
import { requireAdminSession } from "../../utils/promotion-admin"

export default defineApiHandler(async (event) => {
  await requireAdminSession(event)
  const body = await readBody(event)
  const form = parsePromotionForm(body)
  const supabase = createServerSupabaseClient(event)
  const { data, error } = await supabase
    .from("promotion")
    .insert(toPromotionInsert(form))
    .select()
    .single()
  if (error) throw error
  return mapPromotionRow(data as PromotionRow)
})