// https://nuxt.com/docs/api/configuration/nuxt-config
import IconsResolver from 'unplugin-icons/resolver'
import ViteComponents from 'unplugin-vue-components/vite'

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  ssr: false,

  clerk: {
    afterSignOutUrl: "/",
    signInForceRedirectUrl: "/dashboard",
    signInFallbackRedirectUrl: "/dashboard",
  },

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
