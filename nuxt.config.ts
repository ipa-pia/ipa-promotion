// https://nuxt.com/docs/api/configuration/nuxt-config
import IconsResolver from 'unplugin-icons/resolver'
import ViteComponents from 'unplugin-vue-components/vite'
import { authGuestRoutes, authPublicRoutes } from './shared/utils/auth-routes'

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  ssr: false,

  hooks: {
    // @nuxt-tmpl/nuxt currently marks @ipa-vue/core external for all builds.
    // That leaves an unresolvable bare import in browser chunks, so bundle it
    // into the client while preserving the server's external configuration.
    "vite:extendConfig"(config, { isClient }) {
      if (!isClient) return;

      const rollupOptions = config.build?.rollupOptions;
      const external = rollupOptions?.external;
      if (rollupOptions && Array.isArray(external)) {
        rollupOptions.external = external.filter(
          (entry) => entry !== "@ipa-vue/core",
        );
      }
    },
  },

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
      guestRoutes: authGuestRoutes,
      // MCP 使用 Bearer Token 自行鉴权，因此只豁免该端点，避免同级 API 跳过全局鉴权。
      // 模板按「路径段前缀」匹配（/a 覆盖 /a/x/y，/ 只匹配根）。
      // 英文 locale 需要显式映射模板的 consent 默认豁免；使用精确正则避免放行子路径。
      publicRoutes: authPublicRoutes,
    },
    mcp: {
      // 模板默认 mcp.enabled: false，必须显式打开，否则发现元数据不会注册（静默 404）。
      // 模板的 MCP 支持强绑定 supabase provider：NUXT_PUBLIC_AUTH_PROVIDER 必须为 supabase，
      // 且该变量是构建期常量，改动后需要重新构建。
      enabled: true,
      // 模板 0.2.10 默认按 `${NUXT_PUBLIC_SUPABASE_URL} origin + /auth/v1` 推导 issuer。
      // 若部署到 Supabase 子路径或非 Supabase 授权服务器，需显式覆盖，
      // 否则严格客户端会在 RFC 8414 §3.3 判定 Issuer mismatch。
      // authorizationServer: "https://<project>.supabase.co/auth/v1",
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
  },

  eslint: {
    config: {},
  },
});
