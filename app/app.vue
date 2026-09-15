<template>
  <NuxtLayout name='ipa-default'>
    <template #user-avatar="{ user }">
      <el-dropdown trigger="click" @command="handleUserMenuCommand">
        <el-avatar :size="32" :src="user?.avatarUrl ?? undefined">
          {{ userInitial(user) }}
        </el-avatar>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">个人中心</el-dropdown-item>
            <el-dropdown-item command="sign-out" divided>退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
import type { AuthUser } from "@ipa-schema/auth"

const provider = useAuth()

function userInitial(user?: Pick<AuthUser, "name" | "email"> | null): string {
  const name = user?.name?.trim()
  if (name) return name.charAt(0).toUpperCase()
  const email = user?.email?.trim()
  return email ? email.charAt(0).toUpperCase() : "?"
}

function handleUserMenuCommand(command: string | number | object) {
  if (command === "profile") {
    void provider.openUserProfile?.()
  } else if (command === "sign-out") {
    void provider.signOut()
  }
}
</script>
