<template>
  <div class="flex min-h-screen flex-col bg-gray-50 text-gray-900">
    <header class="border-b bg-white">
      <div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <a href="/" class="text-lg font-bold text-gray-900">推广链接导航</a>
      </div>
    </header>
    <div class="flex-1 overflow-auto">
      <slot />
    </div>
    <footer class="border-t py-6 text-center text-sm text-gray-400">
      本站链接均来自公开邀请，请自行甄别
    </footer>
  </div>
</template>
