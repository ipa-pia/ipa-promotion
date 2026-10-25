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
| `/api/v1/mcp` MCP 端点与工具面 | **项目自建** | Streamable HTTP 无状态端点与六个推广链接工具（见 `docs/mcp-design.md`） |

### 发现端点用法（客户端注意）

`resource` 字段由**请求路径后缀**推导：客户端应请求带后缀的发现路径，让 `resource` 与实际 MCP 端点对齐：

```bash
# ✅ 正确：resource = <origin>/api/v1/mcp
curl -i https://<host>/.well-known/oauth-protected-resource/api/v1/mcp

# ❌ 错误：不带后缀 → resource = <origin>/，指向错误
curl -i https://<host>/.well-known/oauth-protected-resource
```

### publicRoutes 放行说明

当前 `nuxtTmpl.auth.publicRoutes` 只配置 `/api/v1/mcp`。该端点会自行验证 Bearer token；不要放行整个 `/api/v1`，否则同级 API 也会跳过模板的全局鉴权。模板按**路径段前缀**匹配（`/a` 覆盖 `/a/x/y`，`/` 只匹配根）。

发现路径无需显式加入 `publicRoutes`：已发布的 `@nuxt-tmpl/nuxt@0.2.10` 服务端中间件调用 `@nuxt-tmpl/core@0.2.10` 的 `isSafeRoute`，内置豁免 `/.well-known` 和 `/oauth/consent`；同意页还声明为公开页面。`@ipa-schema/auth@1.0.0` 的客户端 `DEFAULT_PUBLIC_ROUTES` 不包含这两项，但它不是上述服务端中间件的匹配依据。路径豁免依赖 core 的服务端实现，而不是 auth 包的客户端默认列表。

### MCP 端点与认证

- 端点：`POST /api/v1/mcp`，使用 Streamable HTTP，无状态并返回 JSON；每次请求都要提供 `Authorization: Bearer <Supabase OAuth access token>`。
- 读工具允许任意**已认证**用户；写工具只允许 `app_metadata.role === "admin"`。拒绝访问时读工具仍在工具列表中，调用写工具会返回 403。管理员角色取自 Supabase `app_metadata`，不能用用户可修改的 `user_metadata` 或 OAuth scope 代替。
- 首次连接由 MCP 客户端按 OAuth Protected Resource Metadata 发现流程，从带端点后缀的发现地址开始授权：`https://<host>/.well-known/oauth-protected-resource/api/v1/mcp`。在 `/oauth/consent` 完成模板提供的授权页流程后，客户端应自动在 MCP 请求中附带 access token；不要把 token 写入源码、日志或提交到仓库。
- OAuth token 必须属于当前 Supabase 项目；管理员测试 token 的 `app_metadata.role` 必须为 `admin`，普通用户测试 token 则不能为 `admin`。OAuth 是否能签发包含该 claim 的 token 是上线前置验证。

### 工具清单

| 工具 | 用途 | 权限 |
|---|---|---|
| `list_promotions` | 分页列出推广链接；`includeInactive` 仅管理员可用 | 已认证；查看下架项需管理员 |
| `get_promotion` | 按 ID 读取推广链接；普通用户读取下架记录返回 404 | 已认证 |
| `create_promotion` | 创建推广链接 | 管理员 |
| `update_promotion` | 更新推广链接字段 | 管理员 |
| `delete_promotion` | 软下架推广链接（置 `is_active=false`） | 管理员 |
| `set_promotion_active` | 启用或停用推广链接 | 管理员 |

工具参数与 HTTP API 共用 `shared/contracts/promotion.ts` 的 Zod 契约，数据访问直接使用调用者的 Supabase token 并由 RLS 约束，不通过 HTTP 自调用。OAuth/RFC 9728 发现、同意页 UI 和 issuer 推导属于模板；MCP server、工具与推广业务数据访问属于本项目。

### 本地构建与验收

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# 在 .env 中配置 Supabase URL/anon key，以及下方验收所需的真实 OAuth 凭据和只读数据库连接。
NUXT_PUBLIC_AUTH_PROVIDER=supabase pnpm build
pnpm test:mcp
```

`pnpm test:mcp` 只连接本地编译产物，不会自动获取 OAuth token、创建 Supabase 项目或替代数据库。它会真实调用 Auth、PostgREST 和 MCP 端点，并创建后清理一条带随机标记的验收记录。完整运行需要在 `.env` 提供：

| 变量 | 用途 |
|---|---|
| `NUXT_PUBLIC_SUPABASE_URL` | 目标 Supabase 项目 URL |
| `NUXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `MCP_TEST_ADMIN_ACCESS_TOKEN` | 真实 OAuth 管理员 access token（`app_metadata.role=admin`） |
| `MCP_TEST_USER_ACCESS_TOKEN` | 真实 OAuth 普通用户 access token（非管理员） |
| `MCP_TEST_ADMIN_SESSION_COOKIE` | 管理员已登录浏览器会话的完整 Cookie header，用于与 `GET /api/promotion` 对照 |
| `MCP_TEST_DATABASE_URL` | 指向同一目标库的只读 PostgreSQL 连接，用于核验 RLS 开关与策略；需可读 `pg_class` / `pg_policies` |

缺少变量、依赖或 `.output/server/index.mjs` 时脚本会打印中文缺项并以非零状态退出；缺少条件不算通过。运行前需确保目标库已准备好测试写入权限，脚本执行期间不要并行清理带 `MCP验收-` 前缀的临时记录。脚本不会打印 token、Cookie 或数据库连接串。检查范围及未验证门禁见 `docs/mcp-acceptance.md`。

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
| `pnpm test:mcp` | 使用官方 MCP SDK 对生产构建产物进行真实 OAuth / 数据库验收 |
| `pnpm prisma:generate` | 生成 Prisma Client |
| `pnpm prisma:migrate` | 运行数据库迁移 |
| `pnpm prisma:studio` | 打开 Prisma Studio |

## 相关项目

- [@nuxt-tmpl/core](https://www.npmjs.com/package/@nuxt-tmpl/core) - 核心类型定义
- [@nuxt-tmpl/nuxt](https://www.npmjs.com/package/@nuxt-tmpl/nuxt) - Nuxt 模块
- [nuxt-tmpl-mono](https://github.com/your-repo/nuxt-tmpl-mono) - Monorepo 源码（私有）

## License

MIT
