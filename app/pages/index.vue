<script setup lang="ts">
import { CATEGORY_LABELS, CATEGORY_ORDER, links } from "~~/data/links";

const grouped = computed(() =>
  CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: links
      .filter((link) => link.category === category)
      .sort((a, b) => (b.sort ?? 0) - (a.sort ?? 0)),
  })).filter((group) => group.items.length > 0),
);

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    ElMessage.success("已复制链接");
  } catch {
    ElMessage.error("复制失败，请手动复制");
  }
}
</script>

<template>
  <main class="mx-auto max-w-5xl px-4 py-8">
    <p class="mb-8 text-center text-gray-500">精选大模型、网络工具等邀请链接</p>

    <section v-for="group in grouped" :key="group.category" class="mb-8">
      <h2 class="mb-4 flex items-center gap-2 text-xl font-semibold">
        {{ group.label }}
        <span class="text-sm font-normal text-gray-400">{{ group.items.length }}</span>
      </h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <el-card v-for="link in group.items" :key="link.id" shadow="hover">
          <div class="flex h-full flex-col gap-2">
            <div class="text-base font-medium">{{ link.name }}</div>
            <div class="min-h-10 text-sm text-gray-500">{{ link.description }}</div>
            <div v-if="link.rebate" class="text-xs text-emerald-600">{{ link.rebate }}</div>
            <div class="mt-auto flex gap-2 pt-2">
              <el-button
                type="primary"
                size="small"
                tag="a"
                :href="link.url"
                target="_blank"
                rel="noopener"
              >
                打开
              </el-button>
              <el-button size="small" @click="copyUrl(link.url)">复制链接</el-button>
            </div>
          </div>
        </el-card>
      </div>
    </section>
  </main>
</template>
