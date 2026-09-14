# Nuxt-Tmpl NPM Package Integration Design

## Overview

将当前独立模板项目（nuxt-tmpl）改造为引用已发布的 npm 包（`@nuxt-tmpl/core` 和 `@nuxt-tmpl/nuxt`），删除重复代码，保持项目简洁。

## Goals

1. **完全依赖 npm 包**：所有认证、类型定义、工具函数都从 npm 包引入
2. **全功能保留**：保留 i18n、Element Plus、UnoCSS 等所有功能
3. **可配置数据库**：通过环境变量支持 SQLite 和 PostgreSQL
4. **开箱即用**：用户只需配置环境变量即可使用

## Design

### 1. Project Structure Changes

**Deleted Files**:

```
app/
├── providers/           # 整个目录删除
│   ├── index.ts
│   ├── types.ts
│   ├── clerk.ts
│   ├── better-auth.ts
│   └── supabase.ts
├── composables/
│   └── useAuth.ts       # 删除（由 @nuxt-tmpl/nuxt 提供）
├── plugins/
│   └── auth.ts          # 删除（由 @nuxt-tmpl/nuxt 提供）
└── middleware/
    └── auth.ts          # 删除（由 @nuxt-tmpl/nuxt 提供）

server/
└── middleware/
    └── auth.ts          # 删除（由 @nuxt-tmpl/nuxt 提供）

shared/                  # 整个目录删除
├── types/
│   └── auth.ts
└── utils/
    ├── supabase.ts
    ├── better-auth.ts
    ├── route.ts
    └── capitalize.ts
```

**Retained Files**:

```
nuxt-tmpl/
├── app/
│   ├── pages/           # 保留所有页面
│   ├── components/      # 保留，删除 auth/ 子目录
│   ├── layouts/         # 保留
│   ├── assets/          # 保留
│   └── app.config.ts    # 保留
├── server/
│   ├── api/             # 保留
│   └── plugins/         # 保留
├── prisma/              # 保留，修改 schema
├── public/              # 保留
├── scripts/             # 保留
├── tests/               # 保留
├── i18n/                # 保留
├── nuxt.config.ts       # 修改
├── package.json         # 修改
├── uno.config.ts        # 保留
├── tsconfig.json        # 保留
└── vitest.config.ts     # 保留
```

### 2. package.json Changes

```json
{
  "name": "nuxt-tmpl",
  "type": "module",
  "private": true,
  "engines": {
    "node": ">=21.0.0"
  },
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
  },
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
  },
  "devDependencies": {
    "@element-plus/nuxt": "^1.1.5",
    "@iconify-json/line-md": "^1.2.16",
    "@nuxt/eslint": "^1.15.2",
    "@nuxt/icon": "^2.2.2",
    "@nuxt/image": "^2.0.0",
    "@nuxt/test-utils": "^4.0.3",
    "@nuxtjs/i18n": "^10.4.0",
    "@nuxtjs/stylelint-module": "^5.2.1",
    "@pinia/nuxt": "^0.11.3",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^25.6.0",
    "@typescript-eslint/eslint-plugin": "^8.60.0",
    "@typescript-eslint/parser": "^8.60.0",
    "@unocss/nuxt": "^66.7.0",
    "@vueuse/nuxt": "^14.3.0",
    "eslint": "^9.39.4",
    "husky": "^9.1.7",
    "lint-staged": "^15.5.2",
    "pinia": "^3.0.4",
    "prisma": "^7.8.0",
    "sass-embedded": "^1.99.0",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.60.0",
    "unocss": "^66.7.0",
    "unplugin-auto-import": "^21.0.0",
    "unplugin-icons": "^23.0.1",
    "unplugin-vue-components": "^32.1.0",
    "vitest": "^4.1.7"
  }
}
```

**Key Changes**:
- Added `@nuxt-tmpl/core` and `@nuxt-tmpl/nuxt` dependencies
- Removed `@ipa-schema/api` (included in `@nuxt-tmpl/core`)
- Removed `dotenv` (Nuxt built-in support)
- Simplified scripts

### 3. nuxt.config.ts Changes

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

**Key Changes**:
- Added `@nuxt-tmpl/nuxt` to modules
- Added `nuxtTmpl` configuration
- Removed redundant nitro/imports/components config

### 4. Prisma Schema Changes

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client"
  output   = "generated/prisma"
}

datasource db {
  provider = env("DATABASE_PROVIDER")
  url      = env("DATABASE_URL")
}
```

**Environment Variables**:

```env
# .env

# SQLite (default)
DATABASE_PROVIDER=sqlite
DATABASE_URL=file:./data/dev.db

# PostgreSQL (Supabase)
# DATABASE_PROVIDER=postgresql
# DATABASE_URL=postgresql://user:password@host:5432/dbname
```

### 5. .env.example Update

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

### 6. README.md Update

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

## Implementation Steps

1. **Update package.json**
   - Add `@nuxt-tmpl/core` and `@nuxt-tmpl/nuxt` dependencies
   - Remove redundant dependencies
   - Simplify scripts

2. **Update nuxt.config.ts**
   - Add `@nuxt-tmpl/nuxt` to modules
   - Add `nuxtTmpl` configuration
   - Remove redundant config

3. **Update Prisma Schema**
   - Add `DATABASE_PROVIDER` environment variable
   - Keep SQLite as default

4. **Delete Redundant Files**
   - Delete `app/providers/` directory
   - Delete `app/composables/useAuth.ts`
   - Delete `app/plugins/auth.ts`
   - Delete `app/middleware/auth.ts`
   - Delete `server/middleware/auth.ts`
   - Delete `shared/` directory

5. **Update Configuration Files**
   - Update `.env.example`
   - Update `README.md`

6. **Test**
   - Run `pnpm install`
   - Run `pnpm prisma:generate`
   - Run `pnpm dev`
   - Verify authentication works

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| npm 包版本不兼容 | 高 | 锁定版本号，测试后再更新 |
| 功能缺失 | 中 | 对比 monorepo 确保功能完整 |
| 配置错误 | 中 | 提供详细的 .env.example |
| 数据库迁移失败 | 低 | 默认 SQLite，用户可按需切换 |

## Success Criteria

1. 项目能正常启动 (`pnpm dev`)
2. 认证功能正常工作（通过环境变量切换）
3. 数据库操作正常
4. 代码量减少 50% 以上
5. 用户只需配置环境变量即可使用

---

**Author**: OpenCode  
**Date**: 2026-08-01  
**Status**: Draft
