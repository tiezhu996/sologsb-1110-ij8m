<script setup lang="ts">
import type { TimelineEvent } from '../../types/ui';

withDefaults(defineProps<{ events: TimelineEvent[] }>(), { events: () => [] });
</script>

<template>
  <el-timeline v-if="events.length">
    <el-timeline-item v-for="event in events" :key="`${event.label}-${event.at}-${event.text}`" :timestamp="event.at" :type="event.type ?? 'primary'">
      <div class="event-label">{{ event.label }}</div>
      <div class="event-text">{{ event.text }}</div>
    </el-timeline-item>
  </el-timeline>
  <el-empty v-else description="暂无工序动态" :image-size="60" />
</template>

<style scoped>
.event-label {
  font-weight: 600;
  color: #4a3728;
}
.event-text {
  font-size: 12px;
  color: #8a7a68;
}
</style>
