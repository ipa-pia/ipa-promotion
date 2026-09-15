import { getSessionUser } from "../utils/promotion-admin"

export default defineApiHandler(async (event) => {
  const session = await getSessionUser(event)
  if (!session.user) {
    throw createError({ statusCode: 401, statusMessage: "unauthorized" })
  }
  return {
    userId: session.user.id,
    email: session.user.email ?? "",
    isAdmin: session.isAdmin,
  }
})