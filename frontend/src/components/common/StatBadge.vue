<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    unit?: string;
    status?: 'default' | 'success' | 'warning' | 'danger';
    hint?: string;
  }>(),
  { unit: '', status: 'default', hint: '' },
);

const COLOR: Record<string, string> = {
  default: '#4a3728',
  success: '#2f7d32',
  warning: '#c77700',
  danger: '#c62828',
};

const color = computed(() => COLOR[props.status] ?? COLOR.default);
</script>

<template>
  <el-card shadow="never" class="stat-badge" :style="{ borderLeft: `3px solid ${color}` }">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value" :style="{ color }">
      {{ value }}
      <span v-if="unit" class="stat-unit">{{ unit }}</span>
    </div>
    <div v-if="hint" class="stat-hint">{{ hint }}</div>
  </el-card>
</template>

<style scoped>
.stat-badge {
  border-radius: 6px;
}
.stat-label {
  font-size: 12px;
  color: #8a7a68;
}
.stat-value {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.5;
}
.stat-unit {
  font-size: 12px;
  color: #8a7a68;
  margin-left: 4px;
}
.stat-hint {
  font-size: 12px;
  color: #a3968a;
}
</style>
