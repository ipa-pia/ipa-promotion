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

站点通过模板 `@nuxt-tmpl/nuxt@0.2.11`（配套 `@nuxt-tmpl/core@0.2.11`）暴露 MCP 相关能力（`nuxtTmpl.mcp.enabled: true`）。

### 硬前置条件

- `NUXT_PUBLIC_AUTH_PROVIDER=supabase`：OAuth consent 页面需要 Supabase；0.2.11 的保护资源发现元数据注册不再依赖 provider，但本项目的 MCP 授权服务器仍是 Supabase。
- `NUXT_PUBLIC_AUTH_PROVIDER` 是**构建期常量**（模板 setup 阶段读取）：改动后必须重新构建，不是运行时开关。
- `@nuxt-tmpl/nuxt` 与 `@nuxt-tmpl/core` 必须保持同为 `0.2.11`；`@ipa-vue/core` 固定由 workspace override 提升至 `0.3.13`。发布包还含 `workspace:*` 依赖，`@ipa-schema/api` 的 override 是独立安装前置。
- `nuxtTmpl.mcp.authEntries` 在单 issuer 配置下保持未设置（默认空值）；不要设置字符串 `"[]"`。本次仍按单 Supabase issuer 运作，不增加多入口或 token 验证配置。

### 模板复用边界

| 部分 | 归属 | 说明 |
|---|---|---|
| `/.well-known/oauth-protected-resource`（RFC 9728 发现元数据） | **模板** | `nuxtTmpl.mcp.enabled: true` 时自动注册，不再依赖 auth provider；禁止自建 |
| `/oauth/consent` 同意页 | **模板** | `runtime/pages/oauth/consent.vue` + `DefaultOAuthConsent.vue` 自动注册，仍依赖 Supabase provider；禁止在 `app/pages/` 下自建同名页（会顶掉模板实现）；定制样式走 `useAuthForms({ OAuthConsentForm })` 包装，不要从零重写 |
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

`nuxtTmpl.auth.publicRoutes` 放行 `/api/v1/mcp` 与精确英文同意页别名 `re:^/en/oauth/consent/?$`。MCP 端点会自行验证 Bearer token；不要放行整个 `/api/v1`，否则同级 API 也会跳过模板的全局鉴权。模板按**路径段前缀**匹配普通字符串（`/a` 覆盖 `/a/x/y`）；`re:` 字符串使用正则匹配。

模板服务端与客户端都按原始 pathname 匹配，未自动剥离 i18n locale 前缀。默认路径 `/.well-known` 与 `/oauth/consent` 使用模板内置豁免；英文 consent 必须显式精确放行。首页、登录、注册和 dashboard 的英文路径在 `guestRoutes` 中复用既有 guest 策略：`re:^/en/?$`、`/en/sign-in`、`/en/sign-up`、`/en/dashboard`。首页必须用锚定正则，不能用普通字符串 `/en`，否则会把 `/en/private` 等路径一并放行。对应配置集中在 `shared/utils/auth-routes.ts`，回归测试同时检查模板服务端 `isSafeRoute` 和客户端 `getAuthMode`。

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

`promotion` 表的 RLS 三条策略（`promotion_select_active` / `promotion_select_admin` / `promotion_write_admin`）以 `scripts/rls-policy-spec.mjs` 为唯一真源，生成幂等的 `supabase/migrations/20261026000000_promotion_rls.sql`，脚本的 RLS 断言也读同一真源。**仓库里有工件不等于目标库已执行**：执行到共享 Supabase 库属于共享环境变更，需要单独批准；先跑只读核验确认现状。

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
