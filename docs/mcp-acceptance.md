# MCP 独立验收记录

## 范围与结论

本记录对应 LEOK-19 的验收脚本、README 文档和对 `feat/mcp` 的独立检查。

**当前复核基线：`feat/mcp` 的 HEAD**（本行用自指写法，不钉死某个 SHA——钉死的那棵树写不进它自己）。这份记录落地时 HEAD ≥ `180260713a6a1b710be690e9e49742ee8246398b`（把基线前移到 PR #17 合入后的 doc-only 提交，父提交 `8a69e94bc9f73ddd7c9881ad838b3d8d6c27b958` = PR #17 的 merge commit，其父提交 `cd924a40` + `de55fdb9`）；读本行的人请自己取一次 `git rev-parse feat/mcp` 或 PR #7 的 head sha，本行只保证**下界**，不替代快照。历史基线**只作沿革用，别再当成当前状态证据**：`cd924a40…` 是 PR #16 合入后的 HEAD，`135fceac…` 是 PR #15，`e0382070…` 是 PR #12 / #13 / #14 按序合入后的 HEAD，`cfed99c9…` 是 PR #11 升级 `@nuxt-tmpl/nuxt` 到 0.2.11 后的 HEAD。

**逐 blob 取证的对象是「取证时的工作树」，不是某棵树**：下面 7 个 blob 在 `8a69e94b` 与 `18026071` 两棵树里是同一份（这两次提交之间它们没动过），也与取证时的工作树逐字节一致：`README.md` `c862587b`、`package.json` `47306186`、`scripts/rls-policy-spec.mjs` `d71b8367`、`scripts/rls-policy-spec.test.mjs` `488fd29a`、`scripts/typecheck-with-provider.mjs` `5d52e60c`、`scripts/verify-mcp.mjs` `55c7e356`、`supabase/migrations/20261026000000_promotion_rls.sql` `86fd3f03`。**`docs/mcp-acceptance.md`（本文件）与 `docs/mcp-design.md` 被显式排除**——这两份文档的 blob 恰恰随基线与措辞一起变，把它们写进"与某棵树一致"的清单里就是自指破口：`8a69e94b` 树里的本文件不是你现在读到的这一份。被排除的是文档，不是判据：真源 `d71b8367` 与工件 `86fd3f03` 自 #12 落地起逐字节未变，即 #15 / #16 / #17 三个 PR 的门禁加固都没有动过渲染语义。

下面「离线证据」的仓库内检查是在与 `18026071` 只差本文件这几行措辞的工作树上重跑的（测试只读代码与工件那 7 个 blob，它们在两棵树里同一份）：`pnpm test` 5 个文件 / 100 项（`scripts/rls-policy-spec.test.mjs` 67 项）、`pnpm lint` 0 error。Vercel Preview 的观测对象是 `cfed99c9` 的部署，与更早的部署一起不再作为当前状态证据（观测方法保留在文末）。PR #7（`feat/mcp` → `main`）的 head 随 `feat/mcp` 同步，这份记录落地时为 31 文件 `+9487/−4421`、`MERGEABLE` / `CLEAN`；它的合并与发布由 leoking 决定。

**当前结论：模板路由、MCP HTTP 边界与全部凭据无关项已独立复验通过；真实 OAuth/RLS 端到端验收尚未通过。** 本地环境没有 `.env` 或 MCP 测试变量；Vercel Preview 已配置 Supabase provider、URL 和 anon key，但还没有真实 OAuth 管理员/普通用户 token、管理员浏览器会话 Cookie 或数据库只读连接。不能据此声称 `pnpm test:mcp` 或生产上线门禁通过。PR #7 的合并与发布由 leoking 决定，不由开发侧推进。

## 当前基线的离线证据（2026-10-26）

在干净 checkout（工作树无改动）上完成全部可离线取证的项。真实 `pnpm test:mcp` 仍未通过，也不记为通过——缺的是运行时凭据。

| 验收项 | 结论 | 证据 |
|---|---|---|
| 依赖可全新安装 | 通过 | `rm -rf node_modules` + `pnpm install --frozen-lockfile` 成功（pnpm 10.34.8，1536 个包）；另用 `git archive` 干净副本**删 `pnpm-lock.yaml`** 后 `pnpm install` 全新解析成功，`@nuxt-tmpl/nuxt` 落到 `0.2.11` 且 `patch_hash` 生效 |
| RFC 9728 发现元数据，`authorization_servers` 指向 `.../auth/v1` | 部分通过 | 本地生产产物与 Preview 均 200：`resource` = `<origin>/api/v1/mcp`、`scopes_supported` 为 OIDC 四项、`bearer_methods_supported` 含 `header`。`authorization_servers[0]` = 目标 Supabase `/auth/v1` **只有 Preview 那一份证据成立**（用文末「Vercel Preview 的观测方法」取到）；本地 `.output` 返回的是构建期占位 `https://placeholder.supabase.co/auth/v1`——本地构建未注入真实 Supabase URL，因此本地只证明端点存在与形状正确，不证明指向目标项目 |
| `/oauth/consent` 来自模板，项目未自建 | 通过 | 无 `app/pages/oauth/`；`server`、`app` 全仓无自建 `.well-known`/consent 实现；zh 与 `/en/oauth/consent` 别名均 200 `text/html` 且含 `</html>`；Vercel 构建路由含 `oauth/consent` 与 `.well-known/oauth-protected-resource/[...]` |
| MCP 端点可用、鉴权边界正确 | 部分通过 | 匿名/凭据无关部分已实测通过（下一张表）；**六工具的 403 边界与 RLS 隔离未验证**（需真实 token） |
| `pnpm test:mcp` 端到端 | 未通过 | 缺凭据，脚本按设计退出 1；本文「尚未验证的上线门禁」各条仍成立 |
| README「MCP 接入」完整 | 通过 | 含硬前置条件、模板复用边界表、发现端点正确/错误用法对比、`publicRoutes` 放行依据、六工具权限表、验收变量表与「缺配置不算通过」声明 |
| 未自建模板已提供的组件 | 通过 | 唯一 `.well-known` 命中是 `server/api/v1/mcp.post.ts` 里拼 401 challenge 的 URL 字符串，非实现 |
| 英文路由 302 循环已消失 | 通过 | `Accept-Language: en` 下 `/` 一跳 302 → `/en` 200，`/en/sign-in` 200 |
| `@ipa-vue/core` 裸导入 workaround 有效 | 通过 | 构建产物 22 个 client JS 中该裸导入命中 0 次 |

### 凭据无关的鉴权边界（本地 `.output` 与 Preview 双环境一致）

| 请求 | 结果 |
|---|---|
| `POST /api/v1/mcp` 无 Authorization | 401 + `WWW-Authenticate: Bearer realm="ipa-promotion", resource_metadata=".../oauth-protected-resource/api/v1/mcp"` |
| `POST /api/v1/mcp` 坏 Bearer | 401 + 同上 challenge |
| `GET` / `DELETE /api/v1/mcp` | 405 + `Allow: POST` |
| `GET /api/v1/other` | 401（豁免未扩散到同级 API） |
| `GET /oauth/unknown` | 302 → `/`（未误放行相似路径） |
| `GET /.well-known/oauth-protected-resource` 无后缀 | 200，`resource` 退化为 `<origin>/` —— 与 README 的「必须带后缀」警告一致 |

## RLS 工件（#12 已合入 `feat/mcp`；门禁补强按 #15 / #16 / #17 分批合入，该线到此收口）

`promotion` 表的三条策略与只读核验查询现在有了仓库内真源：`scripts/rls-policy-spec.mjs`。

| 载体 | 内容 |
|---|---|
| `scripts/rls-policy-spec.mjs` | 策略名、`cmd`、`using` / `with check` 判据、`roles`（工件不带 `to` → 期望恰为 `public`）与 `permissive`（工件不带 `as` → 期望 permissive）、禁用谓词（`user_metadata` / `raw_user_meta_data`）、幂等 migration SQL 渲染、只读核验查询（`pg_class` + `pg_policies`）、`evaluateRlsState()` 与 `evaluateRoles()` 比对 |
| `supabase/migrations/20261026000000_promotion_rls.sql` | 上述真源渲染出的 migration 工件，幂等（`drop policy if exists` + `create policy`），整体包在 `begin;`/`commit;` 里；由 `pnpm test` 做逐字节漂移校验（#15 / #16 / #17 三个 PR 的门禁加固都没改渲染语义，blob 仍是 `86fd3f03`） |
| `scripts/verify-mcp.mjs` | `verifyRlsPolicies()` 不再自带策略名与正则，改为调用 `evaluateRlsState()`，一次列全所有与工件不符的项；`pg_class` 查不到表时按「查询无结果」报，不与「RLS 未开启」混为一谈 |
| `scripts/rls-policy-spec.test.mjs` | 67 项，三层门禁：**① 冻结的语句形状上限**（字面量写在测试里、不从渲染器取，逐条整句匹配，工件与 §3.5 两块同受约束；子句段要求至少写出一条）、**② §3.5 块 ↔ 真源渲染结果的语句集合相等**（多一条少一条都红）、**③ 逐条判据与 `to`/`as` 子句**（子句在语句内部解析，解析出来就与期望做集合相等，确实省略才补 Postgres 默认；head 里有 `to` 却没解析出角色集时判「未识别形状，需人工复核」而不补默认值）。夹具：A7/A8b 类故障、9 个库侧写宽/收窄变异（`判据 OR (true)`、`is_active = true OR is_active = false`、`<> 'notadmin'`、`IN ('admin', 'service')`、`with check … OR (true)`、`to authenticated`、`to public, authenticated`、`as restrictive`、`raw_user_meta_data` 判据；`using (true)` 恒真、缺 `with check`、只读策略带 `with check`、`cmd` 收窄另立用例）、4 个工件/块侧授权子句变异（V5 `as restrictive`、V6 `to public, promotion_superuser`、V7 同行 `to authenticated`、V8 只改 §3.5 的块）、8 条未登记 DDL（force RLS、grant、revoke、drop table、truncate、owner to、create role、set role）、5 项 `roles` 方向判定、2 项「有 `to` 未识别」（R1：缺 `FOR` 的角色集、策略名内含字面量 `using (` 的窗口截断）、4 项渲染器被改动后的上限用例（T11 `delete from`、T15 `disable row level security`、T16 换拼法的 `revoke usage`、T9 `drop table if exists`——这四条在只看集合相等时两边同改仍全绿）、1 项正宗子句顺序（T17：把工件与 §3.5 一起改写成 `as permissive for select to public`，块识别、形状上限、结构断言必须仍为绿，R4）、3 项 `FOR` 缺省与角色名容错（两条读策略缺 `FOR` 时**上限放行、结构断言必须报 `for 子句是 all，真源要求 select`**；写策略缺 `FOR` 与 `FOR ALL` 同义、结构断言为绿；三条子句全省略时上限与结构断言各自都拦得住；`to "promotion-writer"` / `to "promotion.writer"` 不撞上限） |

**上限与真源之间是刻意保留的第二份判据文本。** `allowedStatementPatterns()` 里那三条 `using` / `with check` 字面量不是冗余副本，去重会把门禁降级：复验实测把公开读判据放宽成 `is_active = true OR 1 = 1` 并同步 spec + 渲染器 + §3.5 三处，集合相等按构造看不见差异，**只有这份字面量会红**。代价是改一次合法判据要同步两处，失败消息会原样打印被改的整条语句，定位不难。**同理，上限的子句段要求至少写出一条**：Postgres 省略 `FOR` 的缺省是 `FOR ALL`（官方文档 `ALL is the default.`），只读策略漏写 `for select` 等于当场开出写面。这条安全**不靠量化符**——结构断言按 Postgres 的真实缺省把没有 `FOR` 的写法判成 `all` 再与真源比对，所以将来有人按旧注释把子句段放宽成可选时，红由判定本体报出（夹具 `R4 缺省` 三条就是这条的回归）。

比对强度：`using`/`with check` 规范化（去空白、去 `::text`、去 `promotion.` 限定符、只剥分组括号并保留 `jwt()` 调用括号）后与工件**整串相等**，不是词元子串命中。形状不同但语义等价的手工写法会判失败，并在报错里列出原始 `qual`/`with_check`/`roles`/`permissive` 全文、标记「未识别形状，需人工复核」——门禁可能的错向是「把正确库报成不合规、由人复核」，不是「把写宽库放成绿灯」。`roles` 分三种不符：缺少工件要求的角色是真实**收窄**（这些角色命中不到该策略）；多出的角色在工件已授 `public`（角色全集）时是**等价冗余**，判失败并标记「未识别形状·等价冗余·需人工复核」；工件没授 `public` 时多出的角色才是授权面扩大。未登记策略的 detail 附该行 `cmd`/`permissive`/`roles`/`qual` 原文，叠加方向由 `permissive` 算出而不是无条件说「放宽」。真实库的 deparse 快照仍待凭据到手后用那次只读核验回填夹具。

**写工件 ≠ 执行工件。** 本仓库不含任何连接或变更目标 Supabase 库的脚本；执行到共享库需要 leoking 逐次批准。**执行前置**（不是收尾项）：先用只读连接核对目标库现有策略是否与这三条重复或冲突（`MCP_TEST_DATABASE_URL` + `pnpm test:mcp` 的第一段，或手工执行 `rlsVerificationQueries()` 里的两条 `select`）。工件只按名字覆盖这三条、从不删除其它策略，所以手工库里另有未登记策略时，重放成功之后 RLS 仍是这些策略与三条叠加的状态（`permissive` 的 OR 叠加＝放宽，`restrictive` 的 AND 叠加＝收窄），只有漂移断言会报出来；手工执行过且与工件同形的库不必重放。

**按角色分授是发版前的设计变更。** 今天把 `roles` 钉成 `{public}` 是与工件省略 `to`/`as` 写法唯一自洽的取值，不是因为分授不可行。**`to public` 是角色全集，覆盖此后 `create role` 新建的任何角色**——那些角色不需要任何授权动作就自动落在三条公开读策略里；反过来 `service_role` 带 `BYPASSRLS`、不受策略约束，所以"新角色没被 grant 过、自然兜得住"在 PostgREST 路径上看似成立、语义上并不等价。要排除未来角色只有分授一条路：必须同时改 `renderPolicySql()` 让它显式渲染 `to`/`as`、同步 §3.5 的 SQL 块与期望集这三处。两个方向的暴露点不对称，按实测写：**只改真源的期望（工件不动）本地就红**——子句解析成功后与期望直接比对，确实省略时补齐的 Postgres 默认值也直接比对，不需要连库；在子句解析门禁（#16）合入之前，只有连上真实库才暴露的漏洞是**只改工件侧的 `to`/`as` 而期望不动**，尤其把 `to authenticated` 与 `for select` 写成同一行时，行首锚定的探测会当成"省略"从而整条空转。这类漏现在由「在语句内解析子句 + 生效角色集做集合相等 + 认不出就判未识别」的门禁拦下（V6/V7/V8 与两条 R1 用例已进回归夹具），§3.5 的块也走同一份检查。**分授必须在合入这条子句解析门禁之后才落地**，且这个取舍应在执行工件之前定（事后改要重放）；结构断言与形状上限都已按子句顺序无关实现，正宗的 `as permissive for select to public` 写法不会打红结构断言（R4，T17 把关）。

## 独立实现检查

| 检查项 | 结果 | 依据 |
|---|---|---|
| 六个工具与定稿工具面一致 | 通过 | `server/utils/mcp.ts` 注册六个工具，脚本对照 `tools/list` 的每个字段、required、类型、枚举、边界、默认值、nullable 与 strict 设置 |
| 管理员身份来源 | 通过 | `server/utils/auth-identity.ts` 仅用 `app_metadata.role === "admin"` |
| 共享输入契约 | 通过 | `server/utils/mcp.ts` 与 HTTP parser 都引用 `shared/contracts/promotion.ts` |
| 数据访问没有 HTTP 自调用 | 通过 | MCP 数据层直接通过调用者 JWT 使用 `createTokenSupabaseClient` |
| 模板复用边界 | 通过 | 项目没有自建 `.well-known` 发现处理器或 `app/pages/oauth/consent.vue`；README 明确区分模板与项目能力 |
| 路由放行依据 | 通过 | `nuxt.config.ts` 只配置 `/api/v1/mcp`；core 0.2.11 服务端 `isSafeRoute` 内置发现路径和默认 consent 豁免，`@ipa-schema/auth` 客户端默认路由表不是服务端判定依据；英文 consent 使用项目精确别名 |
| RLS 策略有版本化载体且断言同源 | 通过 | 见上一节 |
| 脚本使用官方客户端及编译产物 | 已实现 | `scripts/verify-mcp.mjs` 使用 MCP SDK `Client` / `StreamableHTTPClientTransport` 启动 `.output/server/index.mjs` |
| 缺配置时明确失败 | 已实现 | 缺少 `.env` 时给出中文提示；脚本列出缺失变量、依赖或 build 产物，并以非零状态退出，不使用 mock 降级 |

## 本分支验证记录

| 命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm typecheck:supabase` | 通过（#13 已合入）；等价于原先手工执行的 `NUXT_PUBLIC_AUTH_PROVIDER=supabase pnpm exec nuxt prepare && NUXT_PUBLIC_AUTH_PROVIDER=supabase pnpm typecheck` |
| `NUXT_PUBLIC_AUTH_PROVIDER=supabase NUXT_PUBLIC_SUPABASE_URL=https://dummy-project.supabase.co NUXT_PUBLIC_SUPABASE_ANON_KEY=dummy pnpm build` | 通过；仅用于本地 build/路由产物验证，不是目标项目联调；Nuxt Image `nuxt/server` unresolved warning 仍出现 |
| `pnpm lint` | 通过，0 error；有 2 条既有 warning（`app/error.vue`、`server/api/auth/[...all].ts`） |
| `pnpm test` | 通过，5 个测试文件、100 项测试（33 项既有 + `scripts/rls-policy-spec.test.mjs` 的 67 项 RLS 工件/断言校验） |
| `node --check scripts/verify-mcp.mjs` | 通过 |
| `node scripts/verify-mcp-guard-flow.mjs` | 通过；注入 4 项故障后按设计累计失败并以 exit 1 退出 |
| `pnpm test:mcp` | 按设计以 exit 1 退出，清楚列出缺失的 6 项真实环境配置；未启动服务、未写测试数据，因此不是端到端通过 |

第一次裸跑 `pnpm typecheck` 时没有设置构建期 `NUXT_PUBLIC_AUTH_PROVIDER`，Nuxt 未生成 `useSupabaseClient` 自动导入并报错；这是构建期常量缺失，不是代码回归。现已固化为 `pnpm typecheck:supabase`（见 README「本地构建与验收」）。本地仍没有目标 OAuth token、管理员 Cookie 或 RLS 数据库连接，无法完成后续真实端到端验收。

## 脚本覆盖范围

配置齐备后，`pnpm test:mcp` 会验证 RLS 开关与策略集是否与仓库工件一致（#12 起由 `scripts/rls-policy-spec.mjs` 单源判定：`cmd`/`roles`/`permissive` 逐项比对，`using`/`with check` 规范化后整串相等，差异项列出原始 `qual`/`with_check`/`roles`/`permissive` 全文），以及 RFC 9728 metadata、模板同意页、无 token/坏 token 的 401 与 `WWW-Authenticate`、GET/DELETE 405、六工具列表与逐字段 schema、管理员读写、普通用户读与四种写拒绝、下架记录可见性、HTTP `GET /api/promotion` 的领域对象对照、入参上限，以及普通用户直连 PostgREST 的 insert/update 拒绝。RLS insert 必须返回 PostgreSQL 错误码 `42501`，并由管理员连接确认唯一标记没有写入；探针和主 fixture 在退出时删除并复查。脚本不会输出 token、Cookie 或数据库连接串。

## PR #8 审查回归

验收 guard 的回归覆盖管理员核验查询错误、非 RLS UPDATE 错误、RLS 允许的零行 UPDATE（并通过管理员记录核验确认未变）、意外记录清理零行但记录仍残留，以及工具字段新增 `pattern` 等未声明约束。以上 guard 共用验收脚本的检查计数器；`scripts/verify-mcp-guard-flow.mjs` 用模拟故障验证累计失败会让进程以 exit 1 退出。该模拟仅验证失败处理路径，不替代真实 Supabase OAuth/RLS 端到端验收。

## 尚未验证的上线门禁

- [ ] 使用目标 Supabase 项目执行 `pnpm build`，确认构建 provider 为 `supabase`。
- [ ] 获取真实 OAuth 管理员和普通用户 access token；Auth `getUser` 验证 token 后，确认管理员仅由 `app_metadata.role=admin` 判定。**这是本能力的单点风险**：OAuth 签发的 JWT 若不带 `app_metadata.role`，六个写工具对管理员一律 403，RLS 写策略同样拒绝。
- [ ] 管理员浏览器会话 Cookie 可访问 `GET /api/promotion`，用于与 MCP 读对象进行结构和值对照。
- [ ] 用只读数据库连接核实目标 `promotion` 表的 `relrowsecurity` 与策略内容符合 `supabase/migrations/20261026000000_promotion_rls.sql`（`cmd`/`roles`/`permissive` 逐列比对，`using`/`with check` 规范化后整串相等；表达式形状不同会判失败并附原始值、标记「未识别形状，需人工复核」，需人确认后回填 §3.5 快照）。
- [ ] **执行工件的前置**：核对手工库现有策略是否与工件的三条重复或冲突（含同义但异名的策略）。工件从不删除未登记策略，重放「成功」后 RLS 仍可能是未登记策略与三条叠加的状态（`permissive` 的 OR 叠加＝放宽，`restrictive` 的 AND 叠加＝收窄）；若目标库尚未执行过该工件，需 leoking 批准后再上线。**别用「新角色没被 grant 过所以自然兜住」代替核验**：工件不写 `to` 即 `to public`，`PUBLIC` 覆盖此后新建的任何角色，而 `service_role` 带 `BYPASSRLS` 不受策略约束。
- [ ] 在真实目标库完成管理员新增、修改、软下架、普通用户隔离及 RLS 直连拒绝测试，并确认临时记录清理成功。
- [x] 最终 Preview 的发现元数据、模板 consent 页面、无 token 401 challenge、GET/DELETE 405 已通过 Vercel 授权绕过独立验证；平台 SSO 302 已与应用响应区分。
- [ ] 真实 `pnpm test:mcp` 在目标 Supabase 上完整通过，并确认新增测试数据清理成功。

缺少任一脚本必需配置时，脚本会在启动服务或写入测试数据之前退出。mock token、模拟数据库、只完成 build/lint/typecheck，均不能代替以上真实联调证据。

## Vercel Preview 的观测方法（复用时照此做）

受保护的 Preview 域名下，未登录的普通 `curl` 会被 Vercel 平台保护重定向到 `vercel.com/sso-api`（HTTP 302，`server: Vercel`、`x-vercel-id`）。那是**部署保护响应，不是应用路由结果**，不能用来判断 `.well-known`、`/oauth/consent` 或 MCP 端点是否工作。要看应用本体的响应，用已登录的 CLI 让平台代为通过保护：`vercel curl --deployment <dpl_…> --scope <team>`，同时核对 `vercel ls`/部署状态为 `Ready` 且该部署确实关联目标分支。环境变量只在列表里核对存在性，不读取值。历史部署句柄会随部署回收失效，所以本文不固定任何一个；每次复验都以当时 `Ready` 的部署重新取证。

两条不随部署回收、可继续引用的取证事实：

- **别名域**：Preview 除一次性 `<slug>-<team>.vercel.app` 地址外，还关联 `ipa-promotion-git-feat-mcp-xdewxs.vercel.app`。该别名按分支命名、指向该分支当前 `Ready` 的部署，因此部署句柄失效后仍能定位到同一观测对象——复用时先访问它确认还是同一分支的部署，再从 `vercel ls` 取当时的 `<dpl_…>` 做 CLI 观测。
- **环境变量列表的负向证据**：Preview 的环境变量列表可见 `NUXT_PUBLIC_AUTH_PROVIDER`、`NUXT_PUBLIC_SUPABASE_URL`、`NUXT_PUBLIC_SUPABASE_ANON_KEY`、`BETTER_AUTH_SECRET`（只核对存在，未读取值）；**未看到** MCP 测试用的 OAuth token、管理员会话 Cookie 或数据库只读连接配置。这既说明 `pnpm test:mcp` 在 Preview 上不可能通过，也说明这些凭据没有被误配到共享部署里。
