<script setup lang="ts">
withDefaults(
  defineProps<{
    description: string;
    actionText?: string;
  }>(),
  { actionText: '' },
);

const emit = defineEmits<{ (e: 'action'): void }>();
</script>

<template>
  <div class="empty-panel">
    <el-empty :description="description">
      <el-button v-if="actionText" type="primary" @click="emit('action')">{{ actionText }}</el-button>
      <slot />
    </el-empty>
  </div>
</template>

<style scoped>
.empty-panel {
  background: #fff;
  border: 1px dashed #d9cbb8;
  border-radius: 8px;
  padding: 20px;
}
</style>
