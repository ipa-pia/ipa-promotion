import { randomUUID } from "node:crypto"
import { requireAdminSession } from "../../utils/promotion-admin"

const COVER_BUCKET = "promotion-covers"
const MAX_COVER_BYTES = 5 * 1024 * 1024

const ALLOWED_COVER_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

const ALLOWED_COVER_MIME = new Set(Object.values(ALLOWED_COVER_TYPES))

export default defineApiHandler(async (event) => {
  await requireAdminSession(event)
  const formData = await readMultipartFormData(event)
  const file = formData?.find((part) => part.name === "file")
  if (!file?.data || !file.filename) {
    throw createError({ statusCode: 400, statusMessage: "file is required" })
  }
  if (file.data.byteLength > MAX_COVER_BYTES) {
    throw createError({ statusCode: 400, statusMessage: "file too large (max 5MB)" })
  }
  const ext = file.filename.split(".").pop()?.toLowerCase() ?? ""
  const contentType = ALLOWED_COVER_TYPES[ext]
  if (!contentType) {
    throw createError({
      statusCode: 400,
      statusMessage: "unsupported image format (png/jpeg/webp/gif only)",
    })
  }
  const receivedType = file.type ?? ""
  if (!ALLOWED_COVER_MIME.has(receivedType)) {
    throw createError({
      statusCode: 400,
      statusMessage: "unsupported image content-type",
    })
  }
  const path = `covers/${Date.now()}-${randomUUID()}.${ext}`
  const supabase = createServerSupabaseClient(event)
  const { error } = await supabase.storage
    .from(COVER_BUCKET)
    .upload(path, file.data, { contentType })
  if (error) throw error
  const { data } = supabase.storage.from(COVER_BUCKET).getPublicUrl(path)
  return { path, publicUrl: data.publicUrl }
})