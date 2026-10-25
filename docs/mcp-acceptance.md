# MCP 独立验收记录

## 范围与结论

本记录对应 LEOK-19 的验收脚本、README 文档和对 PR #4 的独立检查。实现基线为 PR #4 head `1911110a44fd7df5bff740f5e8f058ecc158325c`（`agent/codex/a73de21b26f1`），新验收分支从该 head 创建，PR 目标为 `feat/mcp`。

**当前结论：最终 Preview 的模板路由与 MCP HTTP 边界已独立通过；真实 OAuth/RLS 端到端验收尚未通过。** 本地环境没有 `.env` 或 MCP 测试变量；Vercel Preview 已配置 Supabase provider、URL 和 anon key，但还没有真实 OAuth 管理员/普通用户 token、管理员浏览器会话 Cookie 或数据库只读连接。不能据此声称 `pnpm test:mcp` 或生产上线门禁通过。

## 最终 Preview 独立复核（2026-10-25）

基线为 `feat/mcp` SHA `38589a74686f626d1c4cd66061f6aafd065ef3d2`。经已登录 Vercel CLI（scope `xdewxs`）检查，部署 `dpl_8f2CVtA1QKMttY2UBhASKhmiT4T2` 为 `Ready`，Preview 地址为 `https://ipa-promotion-acye40lw0-xdewxs.vercel.app`，并关联 `ipa-promotion-git-feat-mcp-xdewxs.vercel.app`。Vercel 构建路由清单包含 `.well-known/oauth-protected-resource/[...]` 与 `oauth/consent`；最终 `feat/mcp` 源码中没有项目自建的 `app/pages/oauth/consent.vue`。

未登录的普通 `curl` 请求被 Vercel 平台保护重定向到 `vercel.com/sso-api`（HTTP 302，`server: Vercel`、`x-vercel-id`）。这是部署保护响应，不能当作应用路由结果。使用 `vercel curl --deployment dpl_8f2CVtA1QKMttY2UBhASKhmiT4T2 --scope xdewxs` 自动通过平台保护后，独立观测到以下应用响应：

| 请求 | 应用结果 | 判定 |
|---|---|---|
| `GET /.well-known/oauth-protected-resource/api/v1/mcp` | 200 `application/json`；`resource` 指向当前 Preview 的 `/api/v1/mcp`；`authorization_servers[0]` 指向目标 Supabase `/auth/v1`；RFC 9728 其余字段存在 | 通过 |
| `GET /oauth/consent` | 200 `text/html`，无重定向；Vercel 构建路由列出该模板页面，源码无项目同名页 | 通过 |
| `POST /api/v1/mcp`（无 Authorization） | 401 JSON，含 `WWW-Authenticate: Bearer` 和带端点后缀的 `resource_metadata` URL | 通过 |
| `GET /api/v1/mcp` | 405，`Allow: POST` | 通过 |
| `DELETE /api/v1/mcp` | 405，`Allow: POST` | 通过 |

Vercel Preview 环境变量列表可见 `NUXT_PUBLIC_AUTH_PROVIDER`、`NUXT_PUBLIC_SUPABASE_URL`、`NUXT_PUBLIC_SUPABASE_ANON_KEY` 和 `BETTER_AUTH_SECRET`；这里只核对变量是否存在，没有读取或记录其值。未看到 MCP 测试 OAuth token、管理员 Cookie 或数据库连接配置。

## 独立实现检查

| 检查项 | 结果 | 依据 |
|---|---|---|
| 六个工具与定稿工具面一致 | 通过 | `server/utils/mcp.ts` 注册六个工具，脚本对照 `tools/list` 的每个字段、required、类型、枚举、边界、默认值、nullable 与 strict 设置 |
| 管理员身份来源 | 通过 | `server/utils/auth-identity.ts` 仅用 `app_metadata.role === "admin"` |
| 共享输入契约 | 通过 | `server/utils/mcp.ts` 与 HTTP parser 都引用 `shared/contracts/promotion.ts` |
| 数据访问没有 HTTP 自调用 | 通过 | MCP 数据层直接通过调用者 JWT 使用 `createTokenSupabaseClient` |
| 模板复用边界 | 通过 | 项目没有自建 `.well-known` 发现处理器或 `app/pages/oauth/consent.vue`；README 明确区分模板与项目能力 |
| 路由放行依据 | 通过 | `nuxt.config.ts` 只配置 `/api/v1/mcp`；core 0.2.10 服务端 `isSafeRoute` 内置发现路径和 consent 豁免，`@ipa-schema/auth` 客户端默认路由表不是服务端判定依据 |
| 脚本使用官方客户端及编译产物 | 已实现 | `scripts/verify-mcp.mjs` 使用 MCP SDK `Client` / `StreamableHTTPClientTransport` 启动 `.output/server/index.mjs` |
| 缺配置时明确失败 | 已实现 | 缺少 `.env` 时给出中文提示；脚本列出缺失变量、依赖或 build 产物，并以非零状态退出，不使用 mock 降级 |

## 本分支验证记录

| 命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 通过 |
| `NUXT_PUBLIC_AUTH_PROVIDER=supabase pnpm exec nuxt prepare && NUXT_PUBLIC_AUTH_PROVIDER=supabase pnpm typecheck` | 通过 |
| `NUXT_PUBLIC_AUTH_PROVIDER=supabase NUXT_PUBLIC_SUPABASE_URL=https://dummy-project.supabase.co NUXT_PUBLIC_SUPABASE_ANON_KEY=dummy pnpm build` | 通过；仅用于本地 build/路由产物验证，不是目标项目联调；Nuxt Image `nuxt/server` unresolved warning 仍出现 |
| `pnpm lint` | 通过，0 error；有 2 条既有 warning（`app/error.vue`、`server/api/auth/[...all].ts`） |
| `pnpm test` | 通过，3 个测试文件、8 项测试 |
| `node --check scripts/verify-mcp.mjs` | 通过 |
| `pnpm test:mcp` | 按设计以 exit 1 退出，清楚列出缺失的 6 项真实环境配置；未启动服务、未写测试数据，因此不是端到端通过 |

第一次裸跑 `pnpm typecheck` 时没有设置构建期 `NUXT_PUBLIC_AUTH_PROVIDER`，Nuxt 未生成 `useSupabaseClient` 自动导入并报错；设置 `supabase` 后重新生成类型并复跑通过。本地仍没有目标 OAuth token、管理员 Cookie 或 RLS 数据库连接，无法完成后续真实端到端验收。

## 脚本覆盖范围

配置齐备后，`pnpm test:mcp` 会验证 RFC 9728 metadata、模板同意页、无 token/坏 token 的 401 与 `WWW-Authenticate`、GET/DELETE 405、六工具列表与逐字段 schema、管理员读写、普通用户读与四种写拒绝、下架记录可见性、HTTP `GET /api/promotion` 的领域对象对照、入参上限、RLS 开关与策略名称，以及普通用户直连 PostgREST 的 insert/update 拒绝。RLS insert 必须返回 PostgreSQL 错误码 `42501`，并由管理员连接确认唯一标记没有写入；探针和主 fixture 在退出时删除并复查。脚本不会输出 token、Cookie 或数据库连接串。

## 尚未验证的上线门禁

- [ ] 使用目标 Supabase 项目执行 `pnpm build`，确认构建 provider 为 `supabase`。
- [ ] 获取真实 OAuth 管理员和普通用户 access token；Auth `getUser` 验证 token 后，确认管理员仅由 `app_metadata.role=admin` 判定。
- [ ] 管理员浏览器会话 Cookie 可访问 `GET /api/promotion`，用于与 MCP 读对象进行结构和值对照。
- [ ] 目标 `promotion` 表已启用 RLS，并存在 `promotion_select_active`、`promotion_select_admin`、`promotion_write_admin` 策略；用只读数据库连接核实策略条件。
- [ ] 在真实目标库完成管理员新增、修改、软下架、普通用户隔离及 RLS 直连拒绝测试，并确认临时记录清理成功。
- [x] 最终 Preview 的发现元数据、模板 consent 页面、无 token 401 challenge、GET/DELETE 405 已通过 Vercel 授权绕过独立验证；平台 SSO 302 已与应用响应区分。
- [ ] 真实 `pnpm test:mcp` 在目标 Supabase 上完整通过，并确认新增测试数据清理成功。

缺少任一脚本必需配置时，脚本会在启动服务或写入测试数据之前退出。mock token、模拟数据库、只完成 build/lint/typecheck，均不能代替以上真实联调证据。
