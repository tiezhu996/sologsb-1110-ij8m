<script setup lang="ts">
import { computed } from 'vue';
import type { ThicknessMark } from '../../types/sound-chamber';

const props = withDefaults(
  defineProps<{
    marks: ThicknessMark[];
    chamberDepth: number;
    guqinNo?: string;
    maxThickness?: number;
  }>(),
  { guqinNo: '', maxThickness: 24 },
);

const SCALE = 6.5;
const PANEL_X = 50;
const PANEL_W = 520;
const PANEL_TOP = 26;

const positions = computed(() => {
  const count = props.marks.length || 1;
  const step = PANEL_W / (count + 1);
  return props.marks.map((mark, index) => ({
    ...mark,
    x: PANEL_X + step * (index + 1),
    height: Math.max(6, mark.value * (props.maxThickness > 0 ? 30 / props.maxThickness : 1)),
  }));
});

const panelHeight = computed(() => Math.max(18, ...positions.value.map((p) => p.height)));
const chamberHeight = computed(() => Math.max(20, Math.min(90, props.chamberDepth * 2.4)));
const baseTop = computed(() => PANEL_TOP + panelHeight.value + chamberHeight.value);

const spread = computed(() => {
  if (props.marks.length < 2) return 0;
  const list = props.marks.map((m) => m.value);
  return Number((Math.max(...list) - Math.min(...list)).toFixed(1));
});
</script>

<template>
  <div class="dimension-chart">
    <div class="chart-head">
      <span v-if="guqinNo" class="chart-title">琴号 {{ guqinNo }} · 槽腹剖面标注</span>
      <span class="chart-note">三处厚度极差 {{ spread }} mm（越小越均匀）</span>
    </div>
    <svg viewBox="0 0 620 230" role="img" aria-label="槽腹剖面尺寸标注图">
      <!-- 面板 -->
      <rect :x="PANEL_X" :y="PANEL_TOP" :width="PANEL_W" :height="panelHeight" fill="#d9b382" stroke="#a97f4a" />
      <text :x="PANEL_X - 6" :y="PANEL_TOP + panelHeight / 2 + 4" text-anchor="end" font-size="12" fill="#6b5540">面板</text>

      <!-- 三处厚度标注 -->
      <g v-for="mark in positions" :key="mark.key">
        <rect :x="mark.x - 16" :y="PANEL_TOP" width="32" :height="mark.height" fill="#f0d9b5" stroke="#a97f4a" stroke-dasharray="3 2" />
        <line :x1="mark.x" :y1="PANEL_TOP - 4" :x2="mark.x" :y2="PANEL_TOP - 22" stroke="#8a6a44" />
        <text :x="mark.x" :y="PANEL_TOP - 26" text-anchor="middle" font-size="12" fill="#4a3728">
          {{ mark.label }} {{ mark.value }}mm
        </text>
      </g>

      <!-- 槽腹 -->
      <rect :x="PANEL_X + 30" :y="PANEL_TOP + panelHeight" :width="PANEL_W - 60" :height="chamberHeight" fill="#f7f2ea" stroke="#c8b295" stroke-dasharray="4 3" />
      <text :x="PANEL_X + PANEL_W / 2" :y="PANEL_TOP + panelHeight + chamberHeight / 2 + 4" text-anchor="middle" font-size="12" fill="#8a7a68">
        槽腹深度 {{ chamberDepth }}mm
      </text>

      <!-- 底板 -->
      <rect :x="PANEL_X" :y="baseTop" :width="PANEL_W" height="16" fill="#c9a273" stroke="#a97f4a" />
      <text :x="PANEL_X - 6" :y="baseTop + 12" text-anchor="end" font-size="12" fill="#6b5540">底板</text>

      <!-- 深度尺寸线 -->
      <line :x1="PANEL_X + PANEL_W + 14" :y1="PANEL_TOP + panelHeight" :x2="PANEL_X + PANEL_W + 14" :y2="baseTop" stroke="#a97f4a" />
      <line :x1="PANEL_X + PANEL_W + 8" :y1="PANEL_TOP + panelHeight" :x2="PANEL_X + PANEL_W + 20" :y2="PANEL_TOP + panelHeight" stroke="#a97f4a" />
      <line :x1="PANEL_X + PANEL_W + 8" :y1="baseTop" :x2="PANEL_X + PANEL_W + 20" :y2="baseTop" stroke="#a97f4a" />
    </svg>
  </div>
</template>

<style scoped>
.dimension-chart {
  background: #fffdf9;
  border: 1px solid #ece0cf;
  border-radius: 8px;
  padding: 10px 12px;
}
.chart-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  margin-bottom: 4px;
}
.chart-title {
  font-weight: 600;
  color: #4a3728;
}
.chart-note {
  color: #8a7a68;
}
svg {
  width: 100%;
  height: auto;
}
</style>
