import type { User } from "@supabase/supabase-js"
import { createError } from "h3"
import type { H3Event } from "h3"

export interface SessionUser {
  user: User | null
  isAdmin: boolean
}

/**
 * 服务端取 Supabase 会话。管理员判定以 `app_metadata.role === "admin"` 为权威，
 * 不使用 @nuxt-tmpl guard 的 `user_metadata.role`（客户端可改，不可用于鉴权）。
 */
export async function getSessionUser(event: H3Event): Promise<SessionUser> {
  const supabase = createServerSupabaseClient(event)
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    throw createError({ statusCode: 500, statusMessage: "failed to read supabase session" })
  }
  const user = data.session?.user ?? null
  return { user, isAdmin: user?.app_metadata?.role === "admin" }
}

/** 要求已登录且为管理员，否则 401/403。写库走管理员自身会话 + RLS 策略授权。 */
export async function requireAdminSession(event: H3Event): Promise<SessionUser> {
  const session = await getSessionUser(event)
  if (!session.user) {
    throw createError({ statusCode: 401, statusMessage: "unauthorized" })
  }
  if (!session.isAdmin) {
    throw createError({ statusCode: 403, statusMessage: "forbidden: admin required" })
  }
  return session
}