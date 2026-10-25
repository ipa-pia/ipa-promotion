// 用固定的构建期 provider 重新生成 Nuxt 类型再跑 vue-tsc。
// NUXT_PUBLIC_AUTH_PROVIDER 是构建期常量：缺它时 `nuxt prepare` 不会生成 useSupabaseClient 等自动导入，
// 裸跑 pnpm typecheck 会因此报错，容易被复验者误判成代码回归。
import { spawn } from "node:child_process"

const provider = process.argv[2]
if (!provider) {
  console.error("用法：node scripts/typecheck-with-provider.mjs <auth provider>，例如 supabase。")
  process.exit(1)
}

const steps = [
  ["nuxt", ["prepare"]],
  ["vue-tsc", ["--build", "--force", "tsconfig.json"]],
]

for (const [command, args] of steps) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, NUXT_PUBLIC_AUTH_PROVIDER: provider },
  })
  let spawnError = null
  const code = await new Promise((resolve) => {
    child.once("exit", exitCode => resolve(exitCode ?? 1))
    child.once("error", (error) => {
      spawnError = error
      resolve(1)
    })
  })
  if (spawnError) {
    console.error(`${command} 无法启动：${spawnError.message}`)
    process.exit(1)
  }
  if (code !== 0) {
    console.error(`${command} ${args.join(" ")} 失败（provider=${provider}，exit ${code}）。`)
    process.exit(code)
  }
}
