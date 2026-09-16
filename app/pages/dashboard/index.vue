<script setup lang="ts">
import type { ApiResponse } from "@ipa-schema/api"
import type {
  MeResult,
  Promotion,
  PromotionCoverResult,
  PromotionForm,
} from "#shared/types/promotion"
import {
  PROMOTION_CATEGORY_LABELS,
  PROMOTION_CATEGORY_ORDER,
} from "#shared/types/promotion"

const provider = useAuth()

const loading = ref(false)
const promotions = ref<Promotion[]>([])
const me = ref<{ userId: string; email: string; isAdmin: boolean } | null>(null)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const uploading = ref(false)
const form = reactive<PromotionForm>(createEmptyForm())

function createEmptyForm(): PromotionForm {
  return {
    name: "",
    url: "",
    category: "other",
    description: "",
    rebate: "",
    inviteCode: "",
    coverUrl: null,
    sort: 0,
    isActive: true,
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  return err instanceof Error ? err.message : "操作失败"
}

async function loadMe() {
  try {
    const res = await $fetch<ApiResponse<MeResult>>("/api/me")
    me.value = unwrapApiResponse(res)
    if (me.value?.isAdmin) {
      await loadPromotions()
    }
  } catch {
    me.value = null
  }
}

async function loadPromotions() {
  loading.value = true
  try {
    const res = await $fetch<ApiResponse<Promotion[]>>("/api/promotion")
    promotions.value = unwrapApiResponse(res) ?? []
  } catch (err) {
    ElMessage.error(errorMessage(err))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  Object.assign(form, createEmptyForm())
  dialogVisible.value = true
}

function openEdit(row: Promotion) {
  editingId.value = row.id
  Object.assign(form, {
    name: row.name,
    url: row.url,
    category: row.category,
    description: row.description,
    rebate: row.rebate ?? "",
    inviteCode: row.inviteCode ?? "",
    coverUrl: row.coverUrl,
    sort: row.sort,
    isActive: row.isActive,
  })
  dialogVisible.value = true
}

async function submit() {
  if (!form.name.trim() || !form.url.trim()) {
    ElMessage.warning("名称与链接为必填项")
    return
  }
  saving.value = true
  try {
    const payload: PromotionForm = {
      ...form,
      sort: form.sort ?? 0,
    }
    if (editingId.value) {
      await $fetch<ApiResponse<Promotion>>(`/api/promotion/${editingId.value}`, {
        method: "PATCH",
        body: payload,
      })
      ElMessage.success("已更新")
    } else {
      await $fetch<ApiResponse<Promotion>>("/api/promotion", { method: "POST", body: payload })
      ElMessage.success("已创建")
    }
    dialogVisible.value = false
    await loadPromotions()
  } catch (err) {
    ElMessage.error(errorMessage(err))
  } finally {
    saving.value = false
  }
}

async function toggleActive(row: Promotion) {
  try {
    await $fetch<ApiResponse<Promotion>>(`/api/promotion/${row.id}`, {
      method: "PATCH",
      body: { isActive: !row.isActive },
    })
    ElMessage.success(row.isActive ? "已下架" : "已上架")
    await loadPromotions()
  } catch (err) {
    ElMessage.error(errorMessage(err))
  }
}

async function remove(row: Promotion) {
  try {
    await ElMessageBox.confirm(`确定下架「${row.name}」？`, "提示", {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    })
  } catch {
    return
  }
  try {
    await $fetch<ApiResponse<{ id: string }>>(`/api/promotion/${row.id}`, { method: "DELETE" })
    ElMessage.success("已下架")
    await loadPromotions()
  } catch (err) {
    ElMessage.error(errorMessage(err))
  }
}

async function uploadCover(options: { file: File }) {
  uploading.value = true
  try {
    const body = new FormData()
    body.append("file", options.file)
    const res = await $fetch<ApiResponse<PromotionCoverResult>>("/api/promotion/cover", {
      method: "POST",
      body,
    })
    const result = unwrapApiResponse(res)
    form.coverUrl = result.publicUrl
    ElMessage.success("封面已上传")
  } catch (err) {
    ElMessage.error(errorMessage(err))
  } finally {
    uploading.value = false
  }
}

watch(
  () => provider.isSignedIn.value,
  (signedIn) => {
    me.value = null
    if (signedIn) loadMe()
  },
  { immediate: true },
)
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8">
    <AuthGuard>
      <template #fallback>
        <div class="flex flex-col items-center gap-4 py-16">
          <p class="text-gray-500">请先登录后管理推广链接</p>
          <AuthSignIn />
        </div>
      </template>

      <div v-loading="!me" class="min-h-40">
        <el-empty v-if="me && !me.isAdmin" description="需要管理员权限" />

        <template v-if="me?.isAdmin">
          <div class="mb-4 flex items-center justify-between">
            <h1 class="text-xl font-semibold">推广链接管理</h1>
            <el-button type="primary" @click="openCreate">新增推广</el-button>
          </div>

          <el-table v-loading="loading" :data="promotions" stripe>
            <el-table-column label="封面" width="100">
              <template #default="{ row }">
                <el-image
                  v-if="row.coverUrl"
                  :src="row.coverUrl"
                  fit="cover"
                  style="width: 64px; height: 64px; border-radius: 4px"
                />
              </template>
            </el-table-column>
            <el-table-column prop="name" label="名称" min-width="140" />
            <el-table-column label="分类" width="100">
              <template #default="{ row }">
                <el-tag>{{ PROMOTION_CATEGORY_LABELS[(row as Promotion).category] ?? (row as Promotion).category }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip />
            <el-table-column prop="rebate" label="返利" width="120" show-overflow-tooltip />
            <el-table-column prop="inviteCode" label="邀请码" width="110" />
            <el-table-column prop="sort" label="排序" width="70" />
            <el-table-column label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="row.isActive ? 'success' : 'info'">
                  {{ row.isActive ? "上架" : "下架" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openEdit(row as Promotion)">
                  编辑
                </el-button>
                <el-button link type="warning" size="small" @click="toggleActive(row as Promotion)">
                  {{ row.isActive ? "下架" : "上架" }}
                </el-button>
                <el-button link type="danger" size="small" @click="remove(row as Promotion)">
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </div>
    </AuthGuard>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑推广' : '新增推广'"
      width="520px"
    >
      <el-form label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="服务名称" />
        </el-form-item>
        <el-form-item label="链接" required>
          <el-input v-model="form.url" placeholder="https://..." />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.category" class="w-full">
            <el-option
              v-for="category in PROMOTION_CATEGORY_ORDER"
              :key="category"
              :label="PROMOTION_CATEGORY_LABELS[category]"
              :value="category"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="返利">
          <el-input v-model="form.rebate" placeholder="返利描述，如：注册即送额度" />
        </el-form-item>
        <el-form-item label="邀请码">
          <el-input v-model="form.inviteCode" placeholder="邀请码（公开）" />
        </el-form-item>
        <el-form-item label="封面">
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-3">
              <el-image
                v-if="form.coverUrl"
                :src="form.coverUrl"
                fit="cover"
                style="width: 64px; height: 64px; border-radius: 4px"
              />
              <el-upload
                :show-file-list="false"
                accept="image/*"
                :http-request="uploadCover"
              >
                <el-button :loading="uploading">上传封面</el-button>
              </el-upload>
            </div>
            <el-input
              v-model="form.coverUrl"
              placeholder="或输入图片 URL / base64 数据 URI"
              clearable
            />
          </div>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="0" />
        </el-form-item>
        <el-form-item label="上架">
          <el-switch v-model="form.isActive" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>