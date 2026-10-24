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

## MCP 接入（复用 `@nuxt-tmpl/nuxt` 模板能力）

站点作为 MCP 服务暴露时，OAuth 发现元数据与授权同意页**全部由模板提供，本项目不自建**。

### 模板复用边界

| 能力 | 来源 |
|---|---|
| `/.well-known/oauth-protected-resource(/**)` 发现元数据 handler | 模板（`@nuxt-tmpl/nuxt@0.2.10`，本仓库锁定版本；`nuxtTmpl.mcp.enabled: true` 时注册） |
| RFC 9728 元数据组装（`resource` / `authorization_servers` / `scopes_supported` / `bearer_methods_supported`） | 模板 |
| issuer 推导（默认 `${SUPABASE_URL origin}/auth/v1`） | 模板 |
| `/oauth/consent` 同意页（默认 UI `DefaultOAuthConsent`） | 模板（provider 为 supabase 且项目无同名页面时自动注册） |
| MCP 端点本体（`/api/v1/mcp` 等）与工具面 | **项目自建**（后续任务实现，本项目只放行 `/api/v1` 路径前缀） |

本项目**不**自建：`/.well-known/oauth-protected-resource` 路由、`/oauth/consent` 页面、OAuth 发现元数据组装逻辑、服务端 issuer 推导。如需定制同意页样式，通过 `useAuthForms({ OAuthConsentForm })` 包装模板的 `DefaultOAuthConsent`，不要在 `app/pages/` 下新建 `/oauth/consent` 页面（会顶掉模板实现）。

### 硬前置条件

- **`NUXT_PUBLIC_AUTH_PROVIDER=supabase`**：模板只在 supabase provider 下注册发现 handler 与同意页，其他 provider 会静默失去 MCP 能力（不报错，404）。该变量是**构建期常量**，改动后必须重新构建。
- `nuxtTmpl.mcp.enabled: true`：模板默认 `false`，必须显式写（`nuxt.config.ts`）。
- `/.well-known`、`/oauth`、`/api/v1` 已显式加入 `nuxtTmpl.auth.publicRoutes`（模板鉴权默认拒绝；显式声明，不依赖模板内置路由表的版本细节）。

### 发现端点用法（注意带后缀）

客户端应请求**带资源路径后缀**的发现端点，模板按请求路径后缀推导 `resource` 字段：

```bash
# ✅ 正确：resource = <origin>/api/v1/mcp
curl http://localhost:3000/.well-known/oauth-protected-resource/api/v1/mcp

# ⚠️ 不带后缀也能访问，但 resource 会是 <origin>/，指向错误
curl http://localhost:3000/.well-known/oauth-protected-resource
```

若部署到 Supabase 子路径或使用非 Supabase 授权服务器，在 `nuxt.config.ts` 显式覆盖 `nuxtTmpl.mcp.authorizationServer`，否则严格客户端会按 RFC 8414 §3.3 判定 Issuer mismatch。

## 数据库配置

本分支默认使用 PostgreSQL（部署适配 Vercel）。在 Vercel 项目中配置：

```env
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://user:password@host:5432/dbname
BASE_URL=https://your-app.vercel.app
BETTER_AUTH_SECRET=<your-secret>
```

## 部署

### Vercel（本分支）

- Nitro 会根据 `VERCEL` 环境变量自动切换 vercel preset，构建产出 `.vercel/output`。
- 本地构建后使用 `--prebuilt` 部署：
  ```bash
  NITRO_PRESET=vercel pnpm build
  pnpm vercel:deploy --prebuilt
  ```
- 或直接推送 `vercel` 分支，Vercel 自动构建部署。
- 需要在 Vercel 项目 Env 中配置上方数据库/认证相关环境变量。

### Supabase

参考 [Supabase 部署文档](https://supabase.com/docs/guides/getting-started/quickstarts/nuxt)

### 待办：Supabase 数据库迁移

生产已切换到 Supabase Auth，但业务表尚未创建。数据库迁移机制已选定 **Supabase CLI Migration** 方案（含 Prisma 对比分析），见 [docs/superpowers/specs/2026-08-02-supabase-db-migration-design.md](docs/superpowers/specs/2026-08-02-supabase-db-migration-design.md)。

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
