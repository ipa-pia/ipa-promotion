# MCP 独立验收记录

## 范围与结论

本记录对应 LEOK-19 的验收脚本、README 文档和对 PR #4 的独立检查。实现基线为 PR #4 head `1911110a44fd7df5bff740f5e8f058ecc158325c`（`agent/codex/a73de21b26f1`），新验收分支从该 head 创建，PR 目标为 `feat/mcp`。

**当前结论：脚本和文档已交付；完整端到端验收尚未通过。** 当前环境没有 `.env`、目标 Supabase 凭据、真实 OAuth 管理员/普通用户 token、管理员浏览器会话 Cookie 或数据库只读连接。不能据此声称 `pnpm test:mcp` 或生产上线门禁通过。

## 独立实现检查

| 检查项 | 结果 | 依据 |
|---|---|---|
| 六个工具与定稿工具面一致 | 通过 | `server/utils/mcp.ts` 注册六个工具，测试脚本逐项检查 `tools/list` |
| 管理员身份来源 | 通过 | `server/utils/auth-identity.ts` 仅用 `app_metadata.role === "admin"` |
| 共享输入契约 | 通过 | `server/utils/mcp.ts` 与 HTTP parser 都引用 `shared/contracts/promotion.ts` |
| 数据访问没有 HTTP 自调用 | 通过 | MCP 数据层直接通过调用者 JWT 使用 `createTokenSupabaseClient` |
| 模板复用边界 | 通过 | 项目没有自建 `.well-known` 发现处理器或 `app/pages/oauth/consent.vue`；README 明确区分模板与项目能力 |
| 脚本使用官方客户端及编译产物 | 已实现 | `scripts/verify-mcp.mjs` 使用 MCP SDK `Client` / `StreamableHTTPClientTransport` 启动 `.output/server/index.mjs` |
| 缺配置时明确失败 | 已实现 | 脚本列出缺失变量、依赖或 build 产物，并以非零状态退出，不使用 mock 降级 |

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

第一次裸跑 `pnpm typecheck` 时没有设置构建期 `NUXT_PUBLIC_AUTH_PROVIDER`，Nuxt 未生成 `useSupabaseClient` 自动导入并报错；设置 `supabase` 后重新生成类型并复跑通过。当前也没有目标 Supabase / OAuth / RLS 数据库条件，无法完成后续真实端到端验收。

## 脚本覆盖范围

配置齐备后，`pnpm test:mcp` 会验证 RFC 9728 metadata、模板同意页、无 token/坏 token 的 401 与 `WWW-Authenticate`、GET/DELETE 405、六工具列表、管理员读写、普通用户读与四种写拒绝、下架记录可见性、HTTP `GET /api/promotion` 的领域对象对照、入参上限、RLS 开关与策略名称，以及普通用户直连 PostgREST 的 insert/update 拒绝。脚本用唯一标记创建数据并在退出时清理；不会输出 token、Cookie 或数据库连接串。

## 尚未验证的上线门禁

- [ ] 使用目标 Supabase 项目执行 `pnpm build`，确认构建 provider 为 `supabase`。
- [ ] 获取真实 OAuth 管理员和普通用户 access token；Auth `getUser` 验证 token 后，确认管理员仅由 `app_metadata.role=admin` 判定。
- [ ] 管理员浏览器会话 Cookie 可访问 `GET /api/promotion`，用于与 MCP 读对象进行结构和值对照。
- [ ] 目标 `promotion` 表已启用 RLS，并存在 `promotion_select_active`、`promotion_select_admin`、`promotion_write_admin` 策略；用只读数据库连接核实策略条件。
- [ ] 在真实目标库完成管理员新增、修改、软下架、普通用户隔离及 RLS 直连拒绝测试，并确认临时记录清理成功。
- [ ] 部署预览检查通过；此前 PR #2 和 PR #4 的 Vercel 检查均报告 failed，需查明部署日志原因并复核。

缺少任一脚本必需配置时，脚本会在启动服务或写入测试数据之前退出。mock token、模拟数据库、只完成 build/lint/typecheck，均不能代替以上真实联调证据。