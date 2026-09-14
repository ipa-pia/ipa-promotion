# Nuxt-Tmpl NPM Package Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 nuxt-tmpl 项目改造为引用 `@nuxt-tmpl/core` 和 `@nuxt-tmpl/nuxt` npm 包，删除重复代码，保持项目简洁。

**Architecture:** 通过 Nuxt Module 机制，将认证、类型定义、工具函数等功能委托给 npm 包处理，项目只保留配置、页面和业务组件。

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Prisma, @nuxt-tmpl/core, @nuxt-tmpl/nuxt

---

## File Structure

### Files to Delete

```
app/providers/           # 整个目录
app/composables/useAuth.ts
app/plugins/auth.ts
app/middleware/auth.ts
server/middleware/auth.ts
shared/                  # 整个目录
```

### Files to Modify

```
package.json             # 添加 npm 包依赖，移除冗余依赖
nuxt.config.ts           # 添加 @nuxt-tmpl/nuxt 模块配置
prisma/schema.prisma     # 添加 DATABASE_PROVIDER 环境变量
.env.example             # 更新环境变量说明
README.md                # 更新文档
```

### Files to Keep (No Changes)

```
app/pages/               # 所有页面
app/components/          # 业务组件（删除 auth/ 子目录）
app/layouts/             # 布局
app/assets/              # 样式
server/api/              # API 路由
server/plugins/          # 服务器插件
prisma/migrations/       # 数据库迁移
public/                  # 静态资源
scripts/                 # 脚本
tests/                   # 测试
i18n/                    # 国际化
uno.config.ts            # UnoCSS 配置
tsconfig.json            # TypeScript 配置
vitest.config.ts         # 测试配置
```

---

## Task 1: Update package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current package.json**

```bash
cat package.json
```

- [ ] **Step 2: Update dependencies section**

Replace the dependencies section with:

```json
{
  "dependencies": {
    "@nuxt-tmpl/core": "^0.0.4",
    "@nuxt-tmpl/nuxt": "^0.1.2",
    "@clerk/nuxt": "^2.2.4",
    "@supabase/ssr": "^0.10.3",
    "@supabase/supabase-js": "^2.106.2",
    "better-auth": "^1.6.11",
    "better-sqlite3": "^12.10.0",
    "@prisma/adapter-better-sqlite3": "^7.8.0",
    "@prisma/client": "^7.8.0",
    "element-plus": "^2.14.0",
    "dayjs": "^1.11.21",
    "lodash-es": "^4.18.1",
    "nuxt": "^4.4.6",
    "vue": "^3.5.35",
    "vue-router": "^5.1.0"
  }
}
```

- [ ] **Step 3: Update scripts section**

Replace the scripts section with:

```json
{
  "scripts": {
    "build": "nuxt build",
    "dev": "nuxt dev",
    "generate": "nuxt generate",
    "preview": "nuxt preview",
    "postinstall": "nuxt prepare",
    "test": "vitest run",
    "lint": "eslint",
    "lint:fix": "eslint --fix",
    "prepare": "husky",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio",
    "prisma:seed": "prisma db seed"
  }
}
```

- [ ] **Step 4: Remove redundant devDependencies**

Remove these from devDependencies:
- `@ipa-schema/api`
- `@rollup/plugin-typescript`
- `dotenv`

- [ ] **Step 5: Commit changes**

```bash
git add package.json
git commit -m "chore: update package.json with npm package dependencies"
```

---

## Task 2: Update nuxt.config.ts

**Files:**
- Modify: `nuxt.config.ts`

- [ ] **Step 1: Read current nuxt.config.ts**

```bash
cat nuxt.config.ts
```

- [ ] **Step 2: Replace entire file content**

```ts
// https://nuxt.com/docs/api/configuration/nuxt-config
import IconsResolver from 'unplugin-icons/resolver'
import ViteComponents from 'unplugin-vue-components/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  ssr: false,

  clerk: {
    afterSignOutUrl: '/',
    signInForceRedirectUrl: '/dashboard',
    signInFallbackRedirectUrl: '/dashboard',
  },

  app: {},

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL,
    clerk: {
      secretKey: process.env.NUXT_CLERK_SECRET_KEY,
    },
    betterAuth: {
      secret: process.env.BETTER_AUTH_SECRET,
    },
    public: {
      authProvider: process.env.NUXT_PUBLIC_AUTH_PROVIDER || '',
      baseUrl: process.env.BASE_URL || '',
      betterAuth: {
        baseUrl: process.env.BETTER_AUTH_URL || process.env.BASE_URL || '',
      },
      supabase: {
        url: process.env.NUXT_PUBLIC_SUPABASE_URL || '',
        anonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || '',
      },
    },
  },

  css: ['@/assets/style/index.css'],

  vite: {
    plugins: [
      ViteComponents({
        resolvers: [IconsResolver({})],
      }),
    ],
    optimizeDeps: {
      include: [
        'dayjs',
        'dayjs/plugin/*.js',
        'lodash-unified',
        '@vue/devtools-core',
        '@vue/devtools-kit',
        '@imengyu/vue3-context-menu',
        '@supabase/ssr',
      ],
    },
  },

  modules: [
    '@nuxt/eslint',
    '@nuxt/icon',
    '@nuxt/image',
    '@nuxt/test-utils',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
    '@element-plus/nuxt',
    '@vueuse/nuxt',
    [
      'unplugin-icons/nuxt',
      {
        autoInstall: true,
      },
    ],
    '@unocss/nuxt',
    ...(process.env.NUXT_PUBLIC_AUTH_PROVIDER === 'clerk'
      ? (() => {
          try {
            require.resolve('@clerk/nuxt')
            return ['@clerk/nuxt']
          }
          catch {
            return []
          }
        })()
      : []),
    '@nuxt-tmpl/nuxt',
  ],

  i18n: {
    defaultLocale: 'zh-CN',
    locales: [
      {
        code: 'zh-CN',
        name: '中文',
        file: 'zh-CN.json',
      },
      {
        code: 'en',
        name: 'English',
        file: 'en.json',
      },
    ],
  },

  nuxtTmpl: {
    auth: {
      enabled: true,
      afterSignInRoute: '/dashboard',
    },
    apiResponse: {
      enabled: true,
    },
    logging: {
      enabled: false,
    },
  },

  eslint: {
    config: {},
  },
})
```

- [ ] **Step 3: Commit changes**

```bash
git add nuxt.config.ts
git commit -m "feat: integrate @nuxt-tmpl/nuxt module"
```

---

## Task 3: Update Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Read current schema**

```bash
cat prisma/schema.prisma
```

- [ ] **Step 2: Update datasource block**

```prisma
generator client {
  provider = "prisma-client"
  output   = "generated/prisma"
}

datasource db {
  provider = env("DATABASE_PROVIDER")
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 3: Commit changes**

```bash
git add prisma/schema.prisma
git commit -m "feat: add DATABASE_PROVIDER environment variable"
```

---

## Task 4: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace entire file content**

```env
# === Database Configuration ===
DATABASE_PROVIDER=sqlite
DATABASE_URL=file:./data/dev.db

# === Base Configuration ===
BASE_URL=http://localhost:3000

# === Auth Provider ===
# Options: clerk | better-auth | supabase | (empty = disabled)
# NUXT_PUBLIC_AUTH_PROVIDER=

# === Clerk Configuration ===
# Used when NUXT_PUBLIC_AUTH_PROVIDER=clerk
# NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
# NUXT_CLERK_SECRET_KEY=

# === Better-Auth Configuration ===
# Used when NUXT_PUBLIC_AUTH_PROVIDER=better-auth
# BETTER_AUTH_SECRET=
# BETTER_AUTH_URL=http://localhost:3000

# === Supabase Configuration ===
# Used when NUXT_PUBLIC_AUTH_PROVIDER=supabase
# NUXT_PUBLIC_SUPABASE_URL=
# NUXT_PUBLIC_SUPABASE_ANON_KEY=

# === PostgreSQL Configuration (Optional) ===
# When using PostgreSQL, modify DATABASE_PROVIDER and DATABASE_URL
# DATABASE_PROVIDER=postgresql
# DATABASE_URL=postgresql://supabase_admin:password@localhost:5432/postgres?sslmode=disable
```

- [ ] **Step 2: Commit changes**

```bash
git add .env.example
git commit -m "docs: update .env.example with new configuration"
```

---

## Task 5: Delete Redundant Files

**Files:**
- Delete: `app/providers/` (entire directory)
- Delete: `app/composables/useAuth.ts`
- Delete: `app/plugins/auth.ts`
- Delete: `app/middleware/auth.ts`
- Delete: `server/middleware/auth.ts`
- Delete: `shared/` (entire directory)

- [ ] **Step 1: Delete app/providers directory**

```bash
rm -rf app/providers
```

- [ ] **Step 2: Delete app/composables/useAuth.ts**

```bash
rm app/composables/useAuth.ts
```

- [ ] **Step 3: Delete app/plugins/auth.ts**

```bash
rm app/plugins/auth.ts
```

- [ ] **Step 4: Delete app/middleware/auth.ts**

```bash
rm app/middleware/auth.ts
```

- [ ] **Step 5: Delete server/middleware/auth.ts**

```bash
rm server/middleware/auth.ts
```

- [ ] **Step 6: Delete shared directory**

```bash
rm -rf shared
```

- [ ] **Step 7: Commit changes**

```bash
git add -A
git commit -m "refactor: remove redundant code moved to @nuxt-tmpl/nuxt"
```

---

## Task 6: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace entire file content**

```md
# Nuxt Template

基于 `@nuxt-tmpl/core` 和 `@nuxt-tmpl/nuxt` 的 Nuxt 4 模板项目。

## 特性

- **认证系统**：支持 Clerk / Better-Auth / Supabase，通过环境变量切换
- **数据库**：Prisma ORM，支持 SQLite / PostgreSQL
- **UI 框架**：Element Plus
- **原子化 CSS**：UnoCSS
- **状态管理**：Pinia
- **国际化**：i18n
- **代码规范**：ESLint + Husky + commitlint

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，根据需要修改配置。

### 3. 初始化数据库

```bash
# 生成 Prisma Client
pnpm prisma:generate

# 运行迁移
pnpm prisma:migrate
```

### 4. 启动开发服务器

```bash
pnpm dev
```

## 认证配置

通过环境变量 `NUXT_PUBLIC_AUTH_PROVIDER` 切换认证方式：

| 值 | 说明 | 文档 |
|---|---|---|
| `clerk` | Clerk 认证 | [Clerk Docs](https://clerk.com/docs) |
| `better-auth` | Better-Auth | [Better-Auth Docs](https://better-auth.com) |
| `supabase` | Supabase Auth | [Supabase Docs](https://supabase.com/docs) |
| 留空 | 禁用认证 | - |

## 数据库配置

默认使用 SQLite，如需切换到 PostgreSQL：

1. 修改 `.env`：
   ```env
   DATABASE_PROVIDER=postgresql
   DATABASE_URL=postgresql://user:password@host:5432/dbname
   ```

2. 重新运行迁移：
   ```bash
   pnpm prisma:migrate
   ```

## 部署

### Vercel

```bash
pnpm vercel:deploy
```

### Docker

```bash
docker build -t nuxt-tmpl .
docker run -p 3000:3000 nuxt-tmpl
```

### Supabase

参考 [Supabase 部署文档](https://supabase.com/docs/guides/getting-started/quickstarts/nuxt)

## 脚本

| 脚本 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` | 构建生产版本 |
| `pnpm preview` | 预览生产版本 |
| `pnpm lint` | 代码检查 |
| `pnpm lint:fix` | 自动修复 |
| `pnpm test` | 运行测试 |
| `pnpm prisma:generate` | 生成 Prisma Client |
| `pnpm prisma:migrate` | 运行数据库迁移 |
| `pnpm prisma:studio` | 打开 Prisma Studio |

## 相关项目

- [@nuxt-tmpl/core](https://www.npmjs.com/package/@nuxt-tmpl/core) - 核心类型定义
- [@nuxt-tmpl/nuxt](https://www.npmjs.com/package/@nuxt-tmpl/nuxt) - Nuxt 模块
- [nuxt-tmpl-mono](https://github.com/your-repo/nuxt-tmpl-mono) - Monorepo 源码（私有）

## License

MIT
```

- [ ] **Step 2: Commit changes**

```bash
git add README.md
git commit -m "docs: update README with new architecture"
```

---

## Task 7: Install Dependencies and Test

**Files:**
- None (verification only)

- [ ] **Step 1: Install dependencies**

```bash
pnpm install
```

Expected: Dependencies installed successfully, including @nuxt-tmpl/core and @nuxt-tmpl/nuxt

- [ ] **Step 2: Generate Prisma Client**

```bash
pnpm prisma:generate
```

Expected: Prisma Client generated successfully

- [ ] **Step 3: Run database migration**

```bash
pnpm prisma:migrate
```

Expected: Migration applied successfully

- [ ] **Step 4: Start development server**

```bash
pnpm dev
```

Expected: Server starts without errors, accessible at http://localhost:3000

- [ ] **Step 5: Verify authentication works**

1. Open http://localhost:3000
2. Check browser console for errors
3. If auth provider is configured, verify sign-in/sign-up works

- [ ] **Step 6: Run lint**

```bash
pnpm lint
```

Expected: No errors

- [ ] **Step 7: Run tests**

```bash
pnpm test
```

Expected: Tests pass

- [ ] **Step 8: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues from integration testing"
```

---

## Verification Checklist

- [ ] Project starts without errors
- [ ] Authentication functionality works (if configured)
- [ ] Database operations work
- [ ] No lint errors
- [ ] Tests pass
- [ ] Code reduction achieved (50%+ less code)
- [ ] User only needs to configure .env to use

---

## Rollback Plan

If issues arise:

1. **Revert git changes**: `git revert HEAD`
2. **Restore deleted files**: `git checkout HEAD~1 -- app/providers/ shared/`
3. **Remove npm dependencies**: `pnpm remove @nuxt-tmpl/core @nuxt-tmpl/nuxt`

---

**Author**: OpenCode  
**Date**: 2026-08-01  
**Status**: Ready for Implementation
