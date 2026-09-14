# Supabase 数据库迁移方案设计

日期：2026-08-02
状态：待办（TBD）→ 已选定方案二（见下方"结论与建议"）

## 背景

生产环境（vercel 分支）已切换到 Supabase Cloud：
- **认证**：Supabase Auth（REST），通过 `NUXT_PUBLIC_AUTH_PROVIDER=supabase` 启用
- **部署**：Nuxt 应用仍在 Vercel
- **数据库**：Supabase Postgres（业务表尚未创建）

应用运行时读写数据走 Supabase REST（PostgREST + RLS），不经过 Prisma。当前 Prisma schema 为空（无 model），`prisma/migrations` 目录不存在。

**核心需求**：在 Supabase 场景下建立一套数据库迁移（Migration）机制，用于管理业务表结构的自动创建与变更，并让迁移文件跟随 git 版本控制。是否使用 Prisma 并非前提 —— 下面是比较分析后的两条候选路径。

## 方案一：Prisma Migration（ORM 驱动）

用 Prisma 管理 DDL（建表/改表），运行时读写仍走 Supabase REST。

```
Prisma（本地/CI）──migrate──▶ Supabase Postgres（建表/改表）
supabase-js（运行时）──REST──▶ 读写数据（走 RLS 安全模型）
```

### 优点

- schema.prisma 用声明式模型定义表结构，类型安全
- 迁移 SQL 由 Prisma 从模型自动生成，无需手写
- 复用现有 Prisma 配置（本项目已用 Prisma 7 + `prisma.config.ts`）
- 自带 seed / studio 工作流

### 缺点

- **shadow database 坑**：云托管库（Supabase）不允许 CLI 自动创建/删除数据库，`migrate dev` 需手动建 shadow 库并配 `SHADOW_DATABASE_URL`，否则报 `permission denied to create database`
- 迁移生成后需手动补 RLS policies（Prisma 建表默认 RLS 关闭）
- 引入 ORM 依赖，但仅用于 CLI 迁移，运行时不用 —— "只为建表而存在"

### 配置要点

- `DATABASE_URL` 用**直连地址（direct, 5432）**，仅服务 CLI 迁移，无需 pooler（6543）
- 手动建 shadow 库并配置 `SHADOW_DATABASE_URL`：

```ts
// prisma.config.ts
datasource: {
  url: env("DATABASE_URL"),
  shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),
}
```

### 工作流

```bash
# 开发：修改 schema.prisma 后
pnpm prisma:migrate --create-only   # 生成迁移（不应用）
# 手动在生成的 SQL 中补 RLS policies
pnpm prisma:migrate                 # 应用迁移到远端 Supabase
pnpm prisma:generate                # 重新生成 client

# 生产/CI：只应用已提交的迁移（不需要 shadow db）
pnpm exec prisma migrate deploy
```

## 方案二：Supabase CLI Migration（纯 SQL 驱动）

完全不用 Prisma，用 Supabase 官方迁移机制，SQL 文件跟随 git。

```
supabase/migrations/*.sql（本地/CI）──supabase db push──▶ Supabase Postgres
supabase-js（运行时）──REST──▶ 读写数据（走 RLS 安全模型）
```

### 优点

- 无 ORM 依赖，纯 Supabase 生态
- SQL 文件完全可控，可直接写 RLS / 触发器 / 函数等
- 与 Supabase 原生特性（Edge Functions、Storage）一致的工作流
- **是 Supabase 官方文档推荐的标准部署流程**（`supabase link` + `supabase db push`）

### 缺点

- 需手写全部 DDL，无类型安全模型层
- 失去 Prisma seed / studio 等工具
- schema 变更靠人写 SQL，易出错

### 配置要点

- 无需 `DATABASE_URL`（运行时走 REST，迁移走 CLI）
- 初始化一次项目配置文件：

```bash
supabase init                        # 生成 supabase/config.toml
```

### 工作流

```bash
# 开发：新建迁移
supabase migration new add_users     # 生成 supabase/migrations/<ts>_add_users.sql
# 编辑 SQL 文件，编写 DDL + RLS policies
supabase db push                     # 推送本地迁移到远程

# 生产/CI
supabase db push --db-url "$PROD_DB_URL"
```

## 社区实践对比分析

来源：Supabase 官方文档、StackCompare 2026、Prisma 官方 issue #19614、社区博客与 StackOverflow。

### 1. Supabase 官方标准流程 = CLI Migration

Supabase 官方《Database Migrations》部署指南的完整流程是：
```bash
supabase login
supabase link
supabase db push
git commit supabase/migrations
```
这是 Supabase 平台**官方主推**的迁移机制，迁移文件天然与 Edge Functions、Storage、RLS 等原生功能同构。官方并未把 Prisma 作为迁移工具的默认推荐 —— Prisma 只是其"与 ORM 集成"的选项之一。

### 2. 社区共识：Prisma 的价值在"数据访问层"，不在"迁移"

- **StackCompare 2026**：最常见的模式是"Supabase 提供基础设施（DB/Auth/Storage）+ Prisma 做数据访问层"。**只有当你把 Prisma 当作查询层时才引入 Prisma**；纯 REST 场景直接用 `supabase-js`。
- 大量团队以 raw `supabase-js` 起步，**当查询变复杂（joins、事务）后**才迁移到 Prisma 作数据层 —— 届时再引入 Prisma migrate 也完全来得及。
- 关键推论：本项目的读写走 REST，**Prisma 迁移在当前架构下没有数据访问层的支撑点**，引入它只为建表，属于"杀鸡用牛刀"。

### 3. Prisma + Supabase 迁移的已知痛点（社区高频踩坑）

- **shadow database 问题**（Prisma issue #19614 + 多篇博客）：云托管库不能自动创建 shadow db，必须手动建第二个库配 `SHADOW_DATABASE_URL`；Prisma 官方文档也确认"cloud-hosted shadow databases must be created manually"。
- **连接串问题**（Supabase issue #41621）：Prisma 7 移除 schema 中的 `url`/`directUrl`，`prisma.config.ts` 只接受单一 `url`，导致迁移用池化连接会卡死/报错，社区被迫手动切换 `DATABASE_URL`/`DIRECT_URL`。
- **RLS 需手工补齐**：Prisma 迁移生成的表默认 RLS 关闭，必须事后手工补 policies，多一步且容易遗漏。

### 4. 结论

社区主流实践与本项目架构都指向**方案二（Supabase CLI Migration）**：
- 无 shadow database / 连接串等 ORM 适配痛点
- RLS 直接内联在迁移 SQL 中，与 REST 读写安全模型一致
- 官方原生工作流，将来加 Edge Functions / Storage 时工具链统一

## 方案对比

| 维度 | Prisma Migration | Supabase CLI Migration |
|------|------------------|------------------------|
| DDL 来源 | 模型自动生成 | 手写 SQL |
| 类型安全 | 有（schema.prisma） | 无 |
| RLS 支持 | 需手动补 SQL | 原生直接写 |
| 运行时依赖 | 无（仅 CLI 用） | 无 |
| 迁移版本管理 | prisma/migrations + git | supabase/migrations + git |
| 额外配置 | shadow database + 连接串处理 | 无 |
| 官方推荐度 | 可选集成 | **标准部署流程** |
| 学习成本 | 中 | 低（需懂 SQL） |

## 关键注意事项

### RLS（最关键）

- 无论哪种迁移方式，建的表默认 RLS 关闭
- 读写走 REST 用 anon key → 若不开 RLS，匿名请求无法访问任何数据
- 必须在迁移中开启 RLS 并写 policies：

```sql
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows" ON public."User" FOR SELECT USING (auth.uid() = id);
```

- Prisma 方案：`migrate dev --create-only` 后手动补
- Supabase 方案：直接在迁移 SQL 中编写

## 环境变量

### 方案一（Prisma，已不推荐）

```env
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres  # 直连，迁移用
SHADOW_DATABASE_URL=postgresql://...                                                                    # shadow 库，migrate dev 用
```

### 方案二（Supabase CLI，推荐）

```env
SUPABASE_ACCESS_TOKEN=...             # CLI 登录（仅本地/CI）
SUPABASE_DB_URL=postgresql://...      # 生产 db push 用（可选）
```

## 结论与建议

**采用方案二（Supabase CLI Migration）**，理由：
1. Supabase 官方标准部署流程，原生工具链
2. 本项目读写走 REST，Prisma 迁移无数据访问层支撑，且引入 shadow database / 连接串等适配负担
3. RLS 内联在 SQL 迁移中，更贴合 Supabase 安全模型
4. 将来若要上 Prisma 作数据访问层，再引入 Prisma migrate 也不迟

## 落地步骤（待办）

- [x] 选定方案：**Supabase CLI Migration**
- [ ] `supabase login` + `supabase link` 关联生产项目
- [ ] `supabase init` 生成 `supabase/config.toml`（或已有则跳过）
- [ ] `supabase migration new <first_table>` 编写第一个 SQL 迁移（DDL + RLS policies）
- [ ] `supabase db push` 推送迁移到远程
- [ ] 验证 REST 读写 + RLS 权限（anon / authenticated 角色）
- [ ] 生产/CI 建立迁移执行流程（`supabase db push --db-url`）
- [ ] 评估是否移除 Prisma 依赖（`prisma/schema.prisma` 仍为空，无实际用途）

## 参考

- [Supabase Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase + Prisma 官方文档](https://supabase.com/docs/guides/database/prisma)
- [Prisma Shadow Database](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/shadow-database)
- [Prisma issue #19614 — shadow database 破坏数据库](https://github.com/prisma/prisma/issues/19614)
- [Supabase issue #41621 — Prisma 7 迁移连接串问题](https://github.com/supabase/supabase/issues/41621)
- [StackCompare: Prisma vs Supabase 2026](https://stackcompare.dev/prisma-vs-supabase)
- [Supabase CLI / Migrations](https://supabase.com/docs/guides/cli)
