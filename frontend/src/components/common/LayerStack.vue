<script setup lang="ts">
import { computed } from 'vue';
import type { LacquerLayer } from '../../types/lacquer-layer';
import { curingDays, layersToTarget, TARGET_TOTAL_MM } from '../../utils/layer';

const props = withDefaults(
  defineProps<{
    layers: LacquerLayer[];
    targetMm?: number;
  }>(),
  { targetMm: TARGET_TOTAL_MM },
);

const total = computed(() => props.layers.reduce((sum, layer) => sum + (Number(layer.layerThickness) || 0), 0));

const segments = computed(() => {
  const sum = total.value || 1;
  return props.layers.map((layer) => ({
    layer,
    percent: Number((((Number(layer.layerThickness) || 0) / sum) * 100).toFixed(1)),
  }));
});

const progress = computed(() => Math.min(100, Math.round((total.value / (props.targetMm || TARGET_TOTAL_MM)) * 100)));

const remainLayers = computed(() => layersToTarget(props.layers, props.targetMm || TARGET_TOTAL_MM));
</script>

<template>
  <div class="layer-stack">
    <div class="stack-head">
      <span>累计厚度 <b>{{ total.toFixed(2) }}</b> mm / 目标 {{ targetMm }} mm</span>
      <span class="stack-note">按当前每遍厚度，还需约 {{ remainLayers }} 遍</span>
    </div>
    <el-progress :percentage="progress" :stroke-width="14" :status="progress >= 100 ? 'success' : undefined" />
    <div class="stack-bar">
      <div
        v-for="segment in segments"
        :key="segment.layer.id"
        class="stack-segment"
        :style="{ width: `${segment.percent}%` }"
        :title="`第 ${segment.layer.seq} 遍 · ${segment.layer.layerThickness}mm · ${segment.layer.mixRatio}`"
      >
        <span class="stack-seq">{{ segment.layer.seq }}</span>
      </div>
    </div>
    <el-table :data="layers" size="small" border>
      <el-table-column prop="seq" label="遍次" width="70" />
      <el-table-column prop="mixRatio" label="灰胎配比" width="110" />
      <el-table-column prop="layerThickness" label="本遍厚度(mm)" width="120" />
      <el-table-column prop="totalThickness" label="累计厚度(mm)" width="120" />
      <el-table-column prop="curingTemp" label="荫房温度(℃)" width="110" />
      <el-table-column prop="curingHumidity" label="湿度(%)" width="90" />
      <el-table-column prop="polishGrit" label="打磨目数" width="100" />
      <el-table-column label="养护天数" width="100">
        <template #default="scope">{{ curingDays(scope.row) }} 天</template>
      </el-table-column>
      <el-table-column prop="operator" label="髹漆人" width="90" />
    </el-table>
  </div>
</template>

<style scoped>
.layer-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.stack-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #4a3728;
}
.stack-note {
  color: #8a7a68;
}
.stack-bar {
  display: flex;
  height: 22px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid #ece0cf;
}
.stack-segment {
  background: #b98d55;
  color: #fff;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid #fffdf9;
}
.stack-segment:nth-child(even) {
  background: #8a6a44;
}
.stack-seq {
  opacity: 0.9;
}
</style>
