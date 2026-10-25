import type { User } from "@supabase/supabase-js"
import type { H3Event } from "h3"
import {
  assertAdmin,
  isAdminUser,
  resolveSessionUser,
  resolveTokenUser,
} from "./auth-identity"

export interface SessionUser {
  user: User | null
  isAdmin: boolean
}

/** Compatibility facade for existing HTTP routes. */
export async function getSessionUser(event: H3Event): Promise<SessionUser> {
  const user = await resolveSessionUser(event)
  return { user, isAdmin: isAdminUser(user) }
}

export async function requireAdminSession(event: H3Event): Promise<{ user: User; isAdmin: true }> {
  return assertAdmin(await resolveSessionUser(event))
}

export async function requireAdminToken(event: H3Event, token: string): Promise<{ user: User; isAdmin: true }> {
  return assertAdmin(await resolveTokenUser(event, token))
}
