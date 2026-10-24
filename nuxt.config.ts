// https://nuxt.com/docs/api/configuration/nuxt-config
import IconsResolver from 'unplugin-icons/resolver'
import ViteComponents from 'unplugin-vue-components/vite'

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  ssr: false,

  ...(process.env.NUXT_PUBLIC_AUTH_PROVIDER === "clerk"
      ? {
          clerk: {
            afterSignOutUrl: "/",
            signInForceRedirectUrl: "/dashboard",
            signInFallbackRedirectUrl: "/dashboard",
          },
        }
      : {}),

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
      authProvider: process.env.NUXT_PUBLIC_AUTH_PROVIDER || "",
      baseUrl: process.env.BASE_URL || "",
      betterAuth: {
        baseUrl: process.env.BETTER_AUTH_URL || process.env.BASE_URL || "",
      },
      supabase: {
        url: process.env.NUXT_PUBLIC_SUPABASE_URL || "",
        anonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || "",
      },
    },
  },

  css: ["@/assets/style/index.css"],

  nitro: {
    externals: {
      inline: ["@nuxt-tmpl/nuxt"],
    },
  },

  vite: {
    resolve: {
      conditions: ["development", "module", "browser", "import", "production"],
    },
    plugins: [
      ViteComponents({
        resolvers: [IconsResolver({})],
      }),
    ],
    optimizeDeps: {
      include: [
        "dayjs",
        "dayjs/plugin/*.js",
        "@imengyu/vue3-context-menu",
        "@supabase/ssr",
      ],
    },
  },

  modules: [
    "@nuxt/eslint",
    "@nuxt/icon",
    "@nuxt/image",
    "@nuxt/test-utils",
    "@pinia/nuxt",
    "@nuxtjs/i18n",
    "@element-plus/nuxt",
    "@vueuse/nuxt",
    [
      "unplugin-icons/nuxt",
      {
        autoInstall: true,
      },
    ],
    "@unocss/nuxt",
    ...(process.env.NUXT_PUBLIC_AUTH_PROVIDER === "clerk"
      ? (() => {
          try {
            require.resolve("@clerk/nuxt");
            return ["@clerk/nuxt"];
          } catch {
            return [];
          }
        })()
      : []),
    "@nuxt-tmpl/nuxt",
  ],

  i18n: {
    defaultLocale: "zh-CN",
    locales: [
      {
        code: "zh-CN",
        name: "中文",
        file: "zh-CN.json",
      },
      {
        code: "en",
        name: "English",
        file: "en.json",
      },
    ],
  },

  nuxtTmpl: {
    auth: {
      enabled: true,
      afterSignInRoute: "/dashboard",
      guestRoutes: ["/dashboard"],
      // 模板鉴权是「默认拒绝」：已发布的 @ipa-schema/auth@1.0.0 默认公开路由只有
      // /__nuxt_error，这里显式放行 MCP 相关路径（按路径段前缀匹配，/a 覆盖 /a/x/y），
      // 不依赖 @nuxt-tmpl/core 打包产物内置路由表的版本细节：
      // - /api/v1     —— MCP 端点（端点本体在后续任务实现）
      // - /.well-known —— OAuth Protected Resource Metadata 发现端点
      // - /oauth      —— 模板 OAuth 同意页 /oauth/consent
      publicRoutes: ["/api/v1", "/.well-known", "/oauth"],
    },
    translator: {
      enabled: true,
    },
    apiResponse: {
      enabled: true,
    },
    logging: {
      enabled: false,
    },
    // MCP 能力由 @nuxt-tmpl/nuxt 模板提供（发现元数据 handler + OAuth 同意页），
    // 模板默认 enabled: false，必须显式打开；端点本体不在本项目自建。
    mcp: {
      enabled: true,
      // 模板 0.2.10 默认按 `${SUPABASE_URL origin}/auth/v1` 推导 issuer。
      // 若部署到 Supabase 子路径或非 Supabase 授权服务器，需显式覆盖，
      // 否则严格客户端会在 RFC 8414 §3.3 判定 Issuer mismatch。
      // authorizationServer: "https://<project>.supabase.co/auth/v1",
    },
  },

  eslint: {
    config: {},
  },
});
