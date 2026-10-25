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

## MCP（Model Context Protocol）

站点通过模板 `@nuxt-tmpl/nuxt@0.2.10` 暴露 MCP 相关能力（`nuxtTmpl.mcp.enabled: true`）。

### 硬前置条件

- `NUXT_PUBLIC_AUTH_PROVIDER=supabase`：模板**只在 supabase provider 下**注册 MCP 发现端点与 OAuth 同意页。换成其他 provider 或留空，即使开关打开也不会有任何 MCP 端点（静默失效，不报错）。
- `NUXT_PUBLIC_AUTH_PROVIDER` 是**构建期常量**（模板 setup 阶段读取）：改动后必须重新构建，不是运行时开关。
- 将来若要支持 better-auth/clerk 的 MCP，模板不支持 → 需自建（**技术债**，届时另行立项）。

### 模板复用边界

| 部分 | 归属 | 说明 |
|---|---|---|
| `/.well-known/oauth-protected-resource`（RFC 9728 发现元数据） | **模板** | `nuxtTmpl.mcp.enabled: true` 且 provider=supabase 时自动注册，禁止自建 |
| `/oauth/consent` 同意页 | **模板** | `runtime/pages/oauth/consent.vue` + `DefaultOAuthConsent.vue` 自动注册，禁止在 `app/pages/` 下自建同名页（会顶掉模板实现）；定制样式走 `useAuthForms({ OAuthConsentForm })` 包装，不要从零重写 |
| OAuth issuer 推导 | **模板** | 默认 `authorization_servers[0] = <NUXT_PUBLIC_SUPABASE_URL origin>/auth/v1`；非 Supabase 授权服务器用 `nuxtTmpl.mcp.authorizationServer` 显式覆盖 |
| `/api/v1/mcp` MCP 端点与工具面 | **项目自建** | 后续任务实现（见 `docs/mcp-design.md`） |

### 发现端点用法（客户端注意）

`resource` 字段由**请求路径后缀**推导：客户端应请求带后缀的发现路径，让 `resource` 与实际 MCP 端点对齐：

```bash
# ✅ 正确：resource = <origin>/api/v1/mcp
curl -i https://<host>/.well-known/oauth-protected-resource/api/v1/mcp

# ❌ 错误：不带后缀 → resource = <origin>/，指向错误
curl -i https://<host>/.well-known/oauth-protected-resource
```

### publicRoutes 放行说明

`nuxtTmpl.auth.publicRoutes` 显式包含 `/api/v1`、`/.well-known`、`/oauth`：已发布的 `@ipa-schema/auth@1.0.0` 的 `DEFAULT_PUBLIC_ROUTES` 只有 `/__nuxt_error`（sibling 仓库把 `/.well-known` 加进默认名单的提交未发布），不显式放行则发现请求会被鉴权中间件按未登录 302 到 `/`（`/api/*` 则 401）。模板按**路径段前缀**匹配（`/a` 覆盖 `/a/x/y`，`/` 只匹配根）。

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
