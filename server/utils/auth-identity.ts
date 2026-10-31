import type { User } from "@supabase/supabase-js"
import { createError } from "h3"
import type { H3Event } from "h3"

export interface AuthenticatedIdentity {
  user: User
  isAdmin: boolean
}

/** The sole source of truth for administrator identity throughout the server. */
export function isAdminUser(user: User | null | undefined): boolean {
  return user?.app_metadata?.role === "admin"
}

/** The single 401/403 mapping used by session routes and MCP tools. */
export function assertAdmin(user: User | null): { user: User; isAdmin: true } {
  if (!user) throw createError({ statusCode: 401, statusMessage: "unauthorized" })
  if (!isAdminUser(user)) {
    throw createError({ statusCode: 403, statusMessage: "forbidden: admin required" })
  }
  return { user, isAdmin: true }
}

export async function resolveSessionUser(event: H3Event): Promise<User | null> {
  const supabase = createServerSupabaseClient(event)
  const { data, error } = await supabase.auth.getSession()
  if (error) throw createError({ statusCode: 500, statusMessage: "failed to read supabase session" })
  return data.session?.user ?? null
}

interface JwtClaims {
  iss?: unknown
  aud?: unknown
}

function readJwtClaims(token: string): JwtClaims | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as JwtClaims
  }
  catch {
    return null
  }
}

export function hasExpectedOAuthClaims(token: string, configuredSupabaseUrl: string): boolean {
  let expectedIssuer: string
  try {
    expectedIssuer = `${new URL(configuredSupabaseUrl).origin}/auth/v1`
  }
  catch {
    return false
  }
  const claims = readJwtClaims(token)
  return claims?.iss === expectedIssuer && claims.aud === "authenticated"
}

/**
 * Supabase Auth verifies signature, issuer, expiry and revocation via getUser.
 * Claims are decoded only after that check and are compared with configured
 * Supabase authority; decoded claims never establish identity by themselves.
 */
export async function resolveTokenUser(event: H3Event, token: string): Promise<User | null> {
  const supabase = createTokenSupabaseClient(token)
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null

  const config = useRuntimeConfig(event)
  const configuredUrl = config.public.supabase?.url
  if (!configuredUrl) return null

  if (!hasExpectedOAuthClaims(token, configuredUrl)) return null
  return data.user
}
