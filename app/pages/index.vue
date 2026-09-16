<script setup lang="ts">
import { useSupabaseClient } from "#imports"
import {
  mapPromotionRow,
  PROMOTION_CATEGORY_LABELS,
  PROMOTION_CATEGORY_ORDER,
} from "#shared/types/promotion"
import type { Promotion, PromotionRow } from "#shared/types/promotion"

const supabase = useSupabaseClient()
const promotions = ref<Promotion[]>([])
const loading = ref(false)
const errorMessage = ref("")

async function loadPromotions() {
  loading.value = true
  errorMessage.value = ""
  try {
    const { data, error } = await supabase
      .from("promotion")
      .select("*")
      .eq("is_active", true)
      .order("sort", { ascending: false })
      .order("created_at", { ascending: false })
    if (error) throw error
    promotions.value = ((data as PromotionRow[] | null) ?? []).map(mapPromotionRow)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : "加载失败"
  } finally {
    loading.value = false
  }
}

const grouped = computed(() =>
  PROMOTION_CATEGORY_ORDER.map((category) => ({
    category,
    label: PROMOTION_CATEGORY_LABELS[category],
    items: promotions.value.filter((promotion) => promotion.category === category),
  })).filter((group) => group.items.length > 0),
)

async function copyText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(successMessage)
  } catch {
    ElMessage.error("复制失败，请手动复制")
  }
}

onMounted(loadPromotions)

useHead({
  title: "精选推荐",
  link: [
    { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  ],
  meta: [
    { name: "description", content: "精选好用的 AI 大模型与网络工具推荐，发现值得一试的工具" },
    { property: "og:title", content: "精选推荐" },
    { property: "og:description", content: "精选好用的 AI 大模型与网络工具推荐" },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: "精选推荐" },
    { name: "twitter:description", content: "精选好用的 AI 大模型与网络工具推荐" },
  ],
})
</script>

<template>
  <main class="mx-auto max-w-5xl px-4 py-8">
    <p class="mb-8 text-center text-gray-500">
      精选好用的 AI 大模型、网络工具等推荐
    </p>

    <div v-loading="loading" class="min-h-40">
      <el-empty v-if="!loading && !errorMessage && promotions.length === 0" description="暂无推荐内容" />

      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        show-icon
        :closable="false"
        class="mb-4"
      />

      <section v-for="group in grouped" :key="group.category" class="mb-8">
        <h2 class="mb-4 flex items-center gap-2 text-xl font-semibold">
          {{ group.label }}
          <span class="text-sm font-normal text-gray-400">{{ group.items.length }}</span>
        </h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <el-card v-for="promotion in group.items" :key="promotion.id" shadow="hover">
            <div class="group relative flex h-full flex-col gap-2">
              <el-image
                v-if="promotion.coverUrl"
                :src="promotion.coverUrl"
                fit="cover"
                class="h-32 w-full rounded"
              />
              <div
                class="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              >
                <el-tooltip content="打开" placement="top">
                  <el-button
                    circle
                    size="small"
                    type="primary"
                    tag="a"
                    :href="promotion.url"
                    target="_blank"
                    rel="noopener"
                  >
                    <Icon name="line-md:external-link" />
                  </el-button>
                </el-tooltip>
                <el-tooltip content="复制链接" placement="top">
                  <el-button
                    circle
                    size="small"
                    @click="copyText(promotion.url, '已复制链接')"
                  >
                    <Icon name="line-md:link" />
                  </el-button>
                </el-tooltip>
              </div>
              <div class="text-base font-medium">{{ promotion.name }}</div>
              <div class="min-h-10 text-sm text-gray-500">{{ promotion.description }}</div>
              <div v-if="promotion.rebate" class="text-xs text-emerald-600">
                {{ promotion.rebate }}
              </div>
              <div
                v-if="promotion.inviteCode"
                class="flex items-center gap-1 text-xs text-gray-500"
              >
                <span>推荐码</span>
                <code class="rounded bg-gray-100 px-1 py-0.5">{{ promotion.inviteCode }}</code>
                <el-button
                  link
                  type="primary"
                  size="small"
                  @click="copyText(promotion.inviteCode ?? '', '已复制推荐码')"
                >
                  复制
                </el-button>
              </div>
            </div>
          </el-card>
        </div>
      </section>
    </div>
  </main>
</template>