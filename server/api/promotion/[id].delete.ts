import { requireAdminSession } from "../../utils/promotion-admin"

export default defineApiHandler(async (event) => {
  await requireAdminSession(event)
  const id = getRouterParam(event, "id")
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "id is required" })
  }
  const supabase = createServerSupabaseClient(event)
  const { data, error } = await supabase
    .from("promotion")
    .update({ is_active: false })
    .eq("id", id)
    .select("id")
  if (error) throw error
  if (!data || data.length === 0) {
    throw createError({ statusCode: 404, statusMessage: "promotion not found" })
  }
  return { id }
})