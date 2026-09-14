# Supabase Auth Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `NUXT_PUBLIC_AUTH_PROVIDER=supabase` support with full `AuthProvider` interface compliance.

**Architecture:** New `app/providers/supabase.ts` implements `AuthProvider` using `@supabase/ssr`'s `createBrowserClient`. Server-side validation via `shared/utils/supabase.ts` using `createServerClient`. Factory in `app/providers/index.ts` wires it up. Zero changes to UI components.

**Tech Stack:** Nuxt 4, @supabase/supabase-js ^2, @supabase/ssr ^0

---

### Task 1: Add supabase dependencies and install

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add @supabase/supabase-js and @supabase/ssr to dependencies**

Edit `package.json` and add after the `"better-sqlite3"` line:

```json
    "@supabase/ssr": "^0.6.0",
    "@supabase/supabase-js": "^2.49.0",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: Packages installed, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: add supabase dependencies"
```

---

### Task 2: Add supabase runtime config and env vars

**Files:**
- Modify: `nuxt.config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add supabase runtime config to nuxt.config.ts**

Edit `nuxt.config.ts`, add `supabase` block inside `runtimeConfig.public` after `betterAuth`:

```ts
      supabase: {
        url: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
        anonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || '',
      },
```

The resulting `runtimeConfig.public` block:

```ts
    public: {
      authProvider: process.env.NUXT_PUBLIC_AUTH_PROVIDER || "",
      baseUrl: process.env.BASE_URL || "",
      betterAuth: {
        baseUrl: process.env.BETTER_AUTH_URL || process.env.BASE_URL || "",
      },
      supabase: {
        url: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
        anonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || '',
      },
    },
```

- [ ] **Step 2: Add supabase env vars to .env.example**

Append to `.env.example`:

```
# supabase (only needed when NUXT_PUBLIC_AUTH_PROVIDER=supabase)
NUXT_PUBLIC_SUPABASE_URL=
NUXT_PUBLIC_SUPABASE_ANON_KEY=
```

Update the auth provider comment on line 5:
From: `# Auth provider: clerk | better-auth | (empty = disabled)`
To: `# Auth provider: clerk | better-auth | supabase | (empty = disabled)`

- [ ] **Step 3: Commit**

```bash
git add nuxt.config.ts .env.example
git commit -m "feat: add supabase runtime config and env vars"
```

---

### Task 3: Create shared utility for server-side Supabase client

**Files:**
- Create: `shared/utils/supabase.ts`

- [ ] **Step 1: Create the server-side Supabase client helper**

Create `shared/utils/supabase.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { parseCookies, setCookie } from 'h3'
import type { H3Event } from 'h3'

export function createServerSupabaseClient(event: H3Event) {
  const config = useRuntimeConfig()
  const supabaseUrl = config.public.supabase?.url
  const supabaseAnonKey = config.public.supabase?.anonKey

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return Object.entries(parseCookies(event)).map(([name, value]) => ({ name, value }))
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          setCookie(event, name, value, options)
        })
      },
    },
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/utils/supabase.ts
git commit -m "feat: add server-side supabase client utility"
```

---

### Task 4: Create Supabase auth provider

**Files:**
- Create: `app/providers/supabase.ts`

- [ ] **Step 1: Create the provider implementation**

Create `app/providers/supabase.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'
import type { AuthProvider } from './types'
import type { AuthUser, AuthResult, AuthSignInData, AuthSignUpData } from '#shared/types/auth'

function toUser(sbUser: any): AuthUser | null {
  if (!sbUser) return null
  return {
    id: sbUser.id,
    email: sbUser.email ?? '',
    name: sbUser.user_metadata?.name ?? sbUser.user_metadata?.full_name ?? '',
    avatarUrl: sbUser.user_metadata?.avatar_url ?? sbUser.user_metadata?.picture ?? null,
    createdAt: new Date(sbUser.created_at),
  }
}

export function createSupabaseProvider(): AuthProvider {
  const config = useRuntimeConfig()
  const supabaseUrl = config.public.supabase?.url
  const supabaseAnonKey = config.public.supabase?.anonKey

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing NUXT_PUBLIC_SUPABASE_URL or NUXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

  const user = ref<AuthUser | null>(null)
  const isLoaded = ref(false)
  const isSignedIn = computed(() => !!user.value)

  supabase.auth.getSession().then(({ data: { session } }) => {
    user.value = toUser(session?.user ?? null)
    isLoaded.value = true
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    user.value = toUser(session?.user ?? null)
    isLoaded.value = true
  })

  return {
    id: 'supabase',
    user,
    isLoaded,
    isSignedIn,

    async signIn(data: AuthSignInData): Promise<AuthResult> {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      })
      if (error) return { success: false, error: error.message }
      return { success: true }
    },

    async signUp(data: AuthSignUpData): Promise<AuthResult> {
      const { error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: { data: { name: data.name } },
      })
      if (error) return { success: false, error: error.message }
      return { success: true }
    },

    async signOut(): Promise<void> {
      await supabase.auth.signOut()
    },

    async signInWithOAuth(provider: string): Promise<void> {
      await supabase.auth.signInWithOAuth({ provider: provider as any })
    },

    openSignIn: async () => { await navigateTo('/sign-in') },
    openSignUp: async () => { await navigateTo('/sign-up') },
    openUserProfile: async () => { await navigateTo('/profile') },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/providers/supabase.ts
git commit -m "feat: add supabase auth provider"
```

---

### Task 5: Wire up supabase provider in factory and server middleware

**Files:**
- Modify: `app/providers/index.ts`
- Modify: `server/middleware/auth.ts`

- [ ] **Step 1: Add supabase branch to provider factory**

Edit `app/providers/index.ts`. Add after the better-auth block:

```ts
  if (provider === "supabase") {
    const { createSupabaseProvider } = await import("./supabase");
    return createSupabaseProvider();
  }
```

- [ ] **Step 2: Add supabase branch to server middleware auth**

Edit `server/middleware/auth.ts`. Add supabase handling after the clerk block. Replace the current Clerk-only guard `if (providerId !== "clerk") return;` with a multi-provider check.

The full updated file:

```ts
import { isSafeRoute } from "#shared/utils/route";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const providerId = config.public?.authProvider;
  if (!providerId || providerId === "none") return;

  if (isSafeRoute(event.path)) return;

  if (providerId === "clerk") {
    try {
      const { clerkMiddleware } = await import("@clerk/nuxt/server");
      return clerkMiddleware((event) => {
        const auth = event.context.auth();
        if (auth?.isAuthenticated) return;

        if (event.path.startsWith("/api/")) {
          throw createError({
            statusCode: 401,
            message: "unauthorized",
            data: { success: false },
          });
        }
        return sendRedirect(event, "/");
      })(event);
    } catch {
      // Clerk module not available
    }
  }

  if (providerId === "supabase") {
    const { createServerSupabaseClient } = await import("#shared/utils/supabase");
    const supabase = createServerSupabaseClient(event);
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return;

    if (event.path.startsWith("/api/")) {
      throw createError({
        statusCode: 401,
        message: "unauthorized",
        data: { success: false },
      });
    }
    return sendRedirect(event, "/");
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add app/providers/index.ts server/middleware/auth.ts
git commit -m "feat: wire up supabase provider in factory and server middleware"
```

---

### Task 6: Verify build

- [ ] **Step 1: Test lint**

Run: `pnpm lint`
Expected: No lint errors.

- [ ] **Step 2: Test build**

Run: `NUXT_PUBLIC_AUTH_PROVIDER=supabase NUXT_PUBLIC_SUPABASE_URL=https://test.supabase.co NUXT_PUBLIC_SUPABASE_ANON_KEY=test-key pnpm build`
Expected: Build succeeds.
