<script setup lang="ts">
import { computed } from 'vue';
import { ElMessage } from 'element-plus';
import { STAGE_LABELS, ACTION_LABELS, type ReconcileItem } from '../../types/changes';
import type { DeviceInfo } from '../../types/changes';
import type { ReconcilePlan, MergeResult } from '../../utils/merge';
import { formatDate } from '../../utils/layer';

const props = defineProps<{
  modelValue: boolean;
  plan: ReconcilePlan | null;
  localDevice: DeviceInfo;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'confirm', plan: ReconcilePlan): Promise<MergeResult> | MergeResult;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const conflictItems = computed<ReconcileItem[]>(
  () => props.plan?.groups.flatMap((g) => g.items.filter((i) => i.kind === 'both')) ?? [],
);
const unresolvedCount = computed(() => conflictItems.value.filter((i) => i.resolution === null).length);
const incomingOnlyCount = computed(
  () => props.plan?.groups.reduce((n, g) => n + g.items.filter((i) => i.kind === 'incomingOnly').length, 0) ?? 0,
);
const localOnlyCount = computed(
  () => props.plan?.groups.reduce((n, g) => n + g.items.filter((i) => i.kind === 'localOnly').length, 0) ?? 0,
);
const totalGroups = computed(() => props.plan?.groups.length ?? 0);

function choose(item: ReconcileItem, side: 'local' | 'incoming') {
  item.resolution = side;
}

/** 一键把全部两边冲突选成某一边（逐条仍可单独改） */
function chooseAll(side: 'local' | 'incoming') {
  conflictItems.value.forEach((item) => {
    item.resolution = side;
  });
}

const incomingName = computed(() => props.plan?.incomingDevice?.deviceName ?? '对端平板');

async function handleConfirm() {
  if (!props.plan) return;
  if (unresolvedCount.value > 0) {
    ElMessage.warning(`还有 ${unresolvedCount.value} 处两边都改过的阶段未选择`);
    return;
  }
  await emit('confirm', props.plan);
}

function kindTag(item: ReconcileItem) {
  if (item.kind === 'both') return { type: 'danger' as const, text: '两边都改过' };
  if (item.kind === 'incomingOnly') return { type: 'success' as const, text: '仅对端改过·直接接受' };
  return { type: 'info' as const, text: '仅本机改过·保留' };
}
</script>

<template>
  <el-dialog v-model="visible" title="按琴号对账合并" width="900px" top="6vh" destroy-on-close>
    <template v-if="plan">
      <el-alert
        v-if="plan.legacy"
        type="warning"
        :closable="false"
        show-icon
        title="该备份由旧版本导出，没有变更摘要"
        description="已按业务记录差异降级对账：同号记录两边不一致时仍并列展示由你选择；旧备份无法还原删除动作。"
        style="margin-bottom: 12px"
      />
      <div class="plan-meta">
        <el-tag>对端：{{ incomingName }}</el-tag>
        <el-tag type="info" v-if="plan.exportedAt">导出于 {{ formatDate(plan.exportedAt) }}</el-tag>
        <el-tag type="info">本机：{{ localDevice.deviceName }}</el-tag>
        <el-tag type="success">仅对端 {{ incomingOnlyCount }} 项直接接受</el-tag>
        <el-tag type="info">仅本机 {{ localOnlyCount }} 项保留</el-tag>
        <el-tag type="danger">两边都改 {{ conflictItems.length }} 项待选择</el-tag>
      </div>

      <el-alert
        v-if="conflictItems.length"
        type="info"
        :closable="false"
        show-icon
        style="margin: 10px 0"
      >
        <template #title>
          两边都改过的阶段，请选择继续使用哪一次；未选中的内容会转入历史，可在「合并历史」里后补做。
          <el-button link type="primary" size="small" @click="chooseAll('incoming')">全部用对端</el-button>
          <el-button link type="primary" size="small" @click="chooseAll('local')">全部用本机</el-button>
        </template>
      </el-alert>

      <el-empty v-if="totalGroups === 0" description="没有需要对账的变更（可能已合并过同一备份）" />

      <div v-else class="groups">
        <div v-for="group in plan.groups" :key="group.guqinNo" class="guqin-group">
          <div class="guqin-head">琴号 {{ group.guqinNo }}</div>
          <div v-for="item in group.items" :key="item.stage" class="stage-row">
            <div class="stage-label">
              <el-tag size="small" :type="kindTag(item).type">{{ kindTag(item).text }}</el-tag>
              <span class="stage-name">{{ STAGE_LABELS[item.stage] }}</span>
            </div>

            <div class="side-box" :class="{ active: item.kind === 'both' && item.resolution === 'local', auto: item.kind !== 'both' }">
              <div class="side-title">
                <el-radio
                  :model-value="item.resolution ?? ''"
                  :disabled="!item.local"
                  @change="choose(item, 'local')"
                  value="local"
                >
                  本机 · {{ localDevice.deviceName }}
                </el-radio>
                <span v-if="item.kind === 'localOnly'" class="auto-hint">自动保留</span>
              </div>
              <ul v-if="item.local" class="entry-list">
                <li v-for="entry in item.local.entries" :key="entry.id">
                  <el-tag size="small" effect="plain">{{ ACTION_LABELS[entry.action] }}</el-tag>
                  <span class="entry-text">{{ entry.summary }}</span>
                  <span class="entry-meta">{{ entry.operator }} · {{ formatDate(entry.changedAt) }}</span>
                </li>
              </ul>
              <div v-else class="side-empty">本机未改动</div>
            </div>

            <div class="side-box" :class="{ active: item.kind === 'both' && item.resolution === 'incoming', auto: item.kind !== 'both' }">
              <div class="side-title">
                <el-radio
                  :model-value="item.resolution ?? ''"
                  :disabled="!item.incoming"
                  @change="choose(item, 'incoming')"
                  value="incoming"
                >
                  对端 · {{ incomingName }}
                </el-radio>
                <span v-if="item.kind === 'incomingOnly'" class="auto-hint">自动接受</span>
              </div>
              <ul v-if="item.incoming" class="entry-list">
                <li v-for="entry in item.incoming.entries" :key="entry.id">
                  <el-tag size="small" type="success" effect="plain">{{ ACTION_LABELS[entry.action] }}</el-tag>
                  <span class="entry-text">{{ entry.summary }}</span>
                  <span class="entry-meta">{{ entry.operator }} · {{ formatDate(entry.changedAt) }}</span>
                </li>
              </ul>
              <div v-else class="side-empty">对端未改动</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :disabled="!plan || totalGroups === 0 || unresolvedCount > 0"
        @click="handleConfirm"
      >
        确认合并<template v-if="unresolvedCount > 0">（{{ unresolvedCount }} 项待选）</template>
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.plan-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.groups {
  max-height: 56vh;
  overflow-y: auto;
  margin-top: 8px;
}
.guqin-group {
  border: 1px solid #e8ddcd;
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}
.guqin-head {
  background: #f5ede2;
  color: #4a3728;
  font-weight: 600;
  padding: 8px 12px;
}
.stage-row {
  display: grid;
  grid-template-columns: 110px 1fr 1fr;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px dashed #e8ddcd;
  align-items: start;
}
.stage-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
}
.stage-name {
  font-weight: 600;
  color: #4a3728;
}
.side-box {
  border: 1px solid #e8ddcd;
  border-radius: 6px;
  padding: 8px 10px;
  background: #fdfbf7;
  min-height: 60px;
}
.side-box.active {
  border-color: #b88b55;
  background: #fbf3e6;
  box-shadow: 0 0 0 1px #b88b55 inset;
}
.side-box.auto {
  background: #f7f3ed;
}
.side-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.auto-hint {
  font-size: 12px;
  color: #a3968a;
}
.entry-list {
  margin: 0;
  padding-left: 0;
  list-style: none;
}
.entry-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding: 3px 0;
  font-size: 13px;
}
.entry-text {
  color: #3a2f25;
}
.entry-meta {
  margin-left: auto;
  font-size: 12px;
  color: #a3968a;
}
.side-empty {
  color: #c0b3a4;
  font-size: 13px;
  padding: 6px 0;
}
</style>
