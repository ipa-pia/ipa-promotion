# Supabase Auth Provider Design

## Goal

Add `AUTH_PROVIDER=supabase` support to the Nuxt starter template, following the existing pluggable `AuthProvider` pattern.

## Background

The project already declares `'supabase'` in the `AuthProviderId` type union, but it has no implementation. The existing providers (`clerk`, `better-auth`) demonstrate the pattern.

## Scope

### Files to create

1. **`app/providers/supabase.ts`** — The Supabase `AuthProvider` implementation using `@supabase/ssr`'s `createBrowserClient`
2. **`shared/utils/supabase.ts`** — Server-side Supabase client helper using `createServerClient` for verifying sessions from cookies

### Files to modify

1. **`app/providers/index.ts`** — Add `provider === "supabase"` branch in `createAuthProvider`
2. **`nuxt.config.ts`** — Add `runtimeConfig.public.supabase` with `url` and `anonKey`
3. **`.env.example`** — Add supabase env vars (`NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY`)
4. **`package.json`** — Add `@supabase/supabase-js` and `@supabase/ssr` dependencies
5. **`server/middleware/auth.ts`** — Add supabase branch for server-side middleware session validation

### What stays unchanged

- All auth UI components (they consume the `AuthProvider` interface)
- `useAuth` composable
- `app/plugins/auth.ts`
- `shared/types/auth.ts` (supabase already in `AuthProviderId`)
- Auth pages and layouts

## Implementation

### `app/providers/supabase.ts`

- Create a Supabase browser client via `@supabase/ssr`'s `createBrowserClient(supabaseUrl, supabaseAnonKey)`
- On init, call `getSession()` to restore existing session
- Subscribe to `onAuthStateChange` for reactive `user`/`isSignedIn` updates
- Map Supabase user to `AuthUser`:
  - `id` → `sbUser.id`
  - `email` → `sbUser.email`
  - `name` → `sbUser.user_metadata?.name || sbUser.user_metadata?.full_name`
  - `avatarUrl` → `sbUser.user_metadata?.avatar_url`
  - `createdAt` → `new Date(sbUser.created_at)`
- `signIn`: `supabase.auth.signInWithPassword({ email, password })`
- `signUp`: `supabase.auth.signUp({ email, password, options: { data: { name } } })` — handle email confirmation (return success with message if no session)
- `signOut`: `supabase.auth.signOut()`
- `signInWithOAuth`: `supabase.auth.signInWithOAuth({ provider })`
- `openSignIn/openSignUp/openUserProfile`: navigate to respective pages

### `shared/utils/supabase.ts`

- Export `createServerSupabaseClient(event)` using `@supabase/ssr`'s `createServerClient`, reading cookies from the H3 event

### `server/middleware/auth.ts`

- Add `providerId === "supabase"` branch:
  - Use `createServerSupabaseClient(event)` to get the session
  - If no session and path is protected, return 401 for API routes, redirect to "/" otherwise

### `nuxt.config.ts` runtimeConfig addition

```ts
runtimeConfig: {
  public: {
    supabase: {
      url: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
      anonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || '',
    },
  },
}
```

### `.env.example` additions

```
# supabase (only needed when NUXT_PUBLIC_AUTH_PROVIDER=supabase)
NUXT_PUBLIC_SUPABASE_URL=
NUXT_PUBLIC_SUPABASE_ANON_KEY=
```

### Dependencies

```json
{
  "@supabase/supabase-js": "^2.x",
  "@supabase/ssr": "^0.x"
}
```

## Edge Cases

1. **Email confirmation pending**: `signUp` returns `{ data: { user }, error: null }` but `session` is null. The provider returns `{ success: true }` — the user will see they need to check their email.
2. **Session cookie expiry**: `@supabase/ssr` handles cookie management automatically via `createBrowserClient`.
3. **Multiple auth tabs**: `onAuthStateChange` fires across tabs via `storage` event; reactive state updates automatically.
4. **OAuth popup blocked**: Browser may block popup, `signInWithOAuth` with redirect mode is a fallback (default is redirect).
