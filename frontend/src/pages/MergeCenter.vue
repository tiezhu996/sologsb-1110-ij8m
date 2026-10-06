<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Upload, RefreshLeft, CircleCheck } from '@element-plus/icons-vue';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';
import { useMergeStore } from '../stores/mergeStore';
import { STAGE_KEYS, STAGE_LABELS, type StageKey } from '../types/sync';
import type { StageConflict } from '../utils/merge';
import type { MergeHistoryItem } from '../types/sync';
import { diffRows, viewRow } from '../utils/sync';
import { formatDate } from '../utils/layer';
import { restoreBackup } from '../utils/export';

const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();
const mergeStore = useMergeStore();

const activeTab = ref<'merge' | 'history' | 'changes'>('merge');
const activeStage = ref<StageKey | ''>('boards');
const fileInput = ref<HTMLInputElement | null>(null);
const restoreInput = ref<HTMLInputElement | null>(null);
const historyDetail = ref<MergeHistoryItem | null>(null);

const plan = computed(() => mergeStore.plan);
const conflictsByStage = computed<Record<StageKey, StageConflict[]>>(() => {
  const groups: Record<StageKey, StageConflict[]> = { boards: [], chambers: [], lacquers: [], stringings: [] };
  for (const c of mergeStore.plan?.conflicts ?? []) groups[c.stage].push(c);
  return groups;
});

function sideView(stage: StageKey, row: Record<string, unknown>) {
  return viewRow(stage, row);
}
function sideDiff(stage: StageKey, local: Record<string, unknown>, incoming: Record<string, unknown>) {
  return diffRows(stage, local, incoming);
}
function choiceOf(stage: StageKey, key: string) {
  return mergeStore.choices[stage]?.[key];
}

async function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

async function onPickFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const text = await readFile(file);
    await mergeStore.loadPlan(text);
    const { conflicts } = mergeStore.plan!;
    if (conflicts.length) {
      ElMessage.warning(`对账完成：${conflicts.length} 处两边都改过，需要操作员逐条选择继续使用哪次`);
    } else {
      ElMessage.success('对账完成：没有并列冲突，可直接执行合并');
    }
  } catch (error) {
    ElMessage.error(`备份解析失败：${(error as Error).message}`);
  }
}

async function onPickRestore(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    await ElMessageBox.confirm(
      '整库恢复会清空本机全部板材、槽腹、髹漆、上弦记录后再写入，且不可撤销。两台平板回坊对账请改用上方「按琴号对账合并」。确认继续？',
      '整库恢复高危确认',
      { type: 'warning', confirmButtonText: '我已知晓风险，整库恢复', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    const text = await readFile(file);
    const counts = await restoreBackup(text);
    mergeStore.clearPlan();
    await Promise.all([boardStore.hydrate(), chamberStore.hydrate(), lacquerStore.hydrate(), stringingStore.hydrate(), mergeStore.hydrateHistory(), mergeStore.hydrateChanges()]);
    ElMessage.success(`整库恢复完成：板材 ${counts.boards}、槽腹 ${counts.chambers}、髹漆 ${counts.lacquers}、上弦 ${counts.stringings}`);
  } catch (error) {
    ElMessage.error(`整库恢复失败：${(error as Error).message}`);
  }
}

async function runMerge() {
  if (mergeStore.unresolvedCount > 0) {
    ElMessage.warning(`还有 ${mergeStore.unresolvedCount} 处冲突未选择`);
    return;
  }
  try {
    const outcome = await mergeStore.apply();
    await Promise.all([
      boardStore.hydrate(),
      chamberStore.hydrate(),
      lacquerStore.hydrate(),
      stringingStore.hydrate(),
      mergeStore.hydrateHistory(),
      mergeStore.hydrateChanges(),
    ]);
    const parts = STAGE_KEYS.map((stage) => {
      const s = outcome.stats[stage];
      return `${STAGE_LABELS[stage]}：新增 ${s.inserted}、接受 ${s.updated + s.conflictWon}、转入历史 ${s.toHistory}${s.demoBlocked ? `、样例拦截 ${s.demoBlocked}` : ''}`;
    });
    mergeStore.clearPlan();
    await ElMessageBox.alert(parts.join('<br/>'), '按琴号对账合并完成', { dangerouslyUseHTMLString: true, type: 'success' });
  } catch (error) {
    ElMessage.error(`合并失败：${(error as Error).message}`);
  }
}

async function markRedone(item: MergeHistoryItem) {
  await mergeStore.markRedone(item.id);
  ElMessage.success('已标记补做完成');
}

function fmt(value?: string): string {
  return value ? formatDate(value) : '—';
}

onMounted(async () => {
  await Promise.all([mergeStore.hydrateHistory(), mergeStore.hydrateChanges()]);
});
</script>

<template>
  <div>
    <h2 class="page-title">两台平板回坊对账合并</h2>
    <p class="page-desc">
      按琴号对账四个工序阶段：不同阶段的修改各自保留；同一阶段只有一边改过则直接接受；两边都改过则并列展示摘要，由操作员选择继续使用哪次，未选内容转入历史后补做。
    </p>

    <el-tabs v-model="activeTab" class="merge-tabs">
      <!-- 对账合并 -->
      <el-tab-pane label="对账合并" name="merge">
        <el-card shadow="never" class="block">
          <template #header>第一步：选择另一台平板导出的备份文件</template>
          <el-button type="primary" :icon="Upload" @click="fileInput?.click()">选择对端备份 JSON</el-button>
          <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onPickFile" />
          <template v-if="plan">
            <el-divider />
            <el-descriptions :column="3" border size="small">
              <el-descriptions-item label="对端设备号">{{ plan.incomingDeviceId }}</el-descriptions-item>
              <el-descriptions-item label="导出时间">{{ fmt(plan.payload.exportedAt) }}</el-descriptions-item>
              <el-descriptions-item label="备份结构版本">v{{ plan.payload.schemaVersion }}<span v-if="plan.payload.schemaVersion < 3" class="compat-hint">（旧备份，无摘要记录，已按兼容方式对账）</span></el-descriptions-item>
            </el-descriptions>
          </template>
        </el-card>

        <template v-if="plan">
          <el-card shadow="never" class="block">
            <template #header>第二步：按琴号对账结果</template>
            <el-table :data="STAGE_KEYS.map((stage) => ({ stage, ...plan!.stats[stage] }))" size="small" border>
              <el-table-column label="工序阶段" width="120">
                <template #default="scope">{{ STAGE_LABELS[scope.row.stage as StageKey] }}</template>
              </el-table-column>
              <el-table-column prop="inserted" label="对端新增（直接收入）" width="170" />
              <el-table-column prop="updated" label="仅对端改过（自动接受）" width="190" />
              <el-table-column prop="kept" label="仅本机改/相同（保留本机）" width="200" />
              <el-table-column label="两边都改过（并列冲突）" width="190">
                <template #default="scope">
                  <el-tag :type="scope.row.conflicts ? 'danger' : 'info'">{{ scope.row.conflicts }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="演示样例拦截" width="130">
                <template #default="scope">
                  <el-tag v-if="scope.row.demoBlocked" type="warning">{{ scope.row.demoBlocked }}</el-tag>
                  <span v-else>0</span>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

          <el-card shadow="never" class="block">
            <template #header>
              <div class="conflict-head">
                <span>第三步：并列冲突逐条选择（{{ plan.conflicts.length - mergeStore.unresolvedCount }} / {{ plan.conflicts.length }} 已选）</span>
                <span v-if="plan.conflicts.length">
                  <el-button size="small" @click="mergeStore.chooseAll('local')">全部继续用本机</el-button>
                  <el-button size="small" @click="mergeStore.chooseAll('incoming')">全部采用对端</el-button>
                </span>
              </div>
            </template>

            <el-empty v-if="!plan.conflicts.length" description="没有两边都改过的冲突" :image-size="70" />

            <el-collapse v-else v-model="activeStage" accordion class="conflict-collapse">
              <el-collapse-item v-for="stage in STAGE_KEYS" :key="stage" :name="stage">
                <template #title>
                  <span class="stage-title">{{ STAGE_LABELS[stage] }}</span>
                  <el-tag size="small" :type="conflictsByStage[stage].length ? 'danger' : 'info'">{{ conflictsByStage[stage].length }} 处</el-tag>
                </template>

                <div v-for="conflict in conflictsByStage[stage]" :key="conflict.matchKey" class="conflict-item">
                  <div class="conflict-sub">琴号 {{ conflict.guqinNo }} · 对账键 {{ conflict.matchKey }}</div>
                  <el-radio-group
                    :model-value="choiceOf(stage, conflict.matchKey)"
                    @update:model-value="(v: 'local' | 'incoming') => mergeStore.choose(stage, conflict.matchKey, v)"
                    class="side-group"
                  >
                    <el-radio value="local" border class="side-radio">
                      <div class="side-card">
                        <div class="side-name">本机版本 <el-tag size="small" type="success">继续用本次</el-tag></div>
                        <div class="side-summary">{{ conflict.local.summary || '无摘要' }}</div>
                        <div class="side-meta">修订 {{ conflict.local.rev ?? 1 }} · {{ fmt(conflict.local.updatedAt) }} · 设备 {{ conflict.local.deviceId || '—' }}</div>
                      </div>
                    </el-radio>
                    <el-radio value="incoming" border class="side-radio">
                      <div class="side-card">
                        <div class="side-name">对端版本 <el-tag size="small" type="warning">继续用本次</el-tag></div>
                        <div class="side-summary">{{ conflict.incoming.summary || '无摘要' }}</div>
                        <div class="side-meta">修订 {{ conflict.incoming.rev ?? 1 }} · {{ fmt(conflict.incoming.updatedAt) }} · 设备 {{ conflict.incoming.deviceId || plan.incomingDeviceId }}</div>
                      </div>
                    </el-radio>
                  </el-radio-group>
                  <el-table :data="sideDiff(stage, conflict.local as Record<string, unknown>, conflict.incoming as Record<string, unknown>)" size="small" class="diff-table">
                    <el-table-column label="字段" prop="label" width="150" />
                    <el-table-column label="本机" width="220">
                      <template #default="scope">
                        <span :class="{ 'cell-changed': scope.row.changed }">{{ sideView(stage, conflict.local as Record<string, unknown>).find((i) => i.label === scope.row.label)?.value }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="对端">
                      <template #default="scope">
                        <span :class="{ 'cell-changed': scope.row.changed }">{{ sideView(stage, conflict.incoming as Record<string, unknown>).find((i) => i.label === scope.row.label)?.value }}</span>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </el-collapse-item>
            </el-collapse>
          </el-card>

          <div class="merge-actions">
            <el-button @click="mergeStore.clearPlan()">放弃本次对账</el-button>
            <el-button type="primary" size="large" :loading="mergeStore.applying" :disabled="mergeStore.unresolvedCount > 0" @click="runMerge">
              执行按琴号合并
            </el-button>
            <span v-if="mergeStore.unresolvedCount > 0" class="unresolved-hint">还有 {{ mergeStore.unresolvedCount }} 处冲突未选择</span>
          </div>
        </template>

        <el-card shadow="never" class="block danger-card">
          <template #header>整库恢复（高危，仅换机/故障时使用）</template>
          <p class="danger-text">整库恢复会清空本机四工序表后整体覆盖，另一台设备刚改的板材、槽腹、髹漆、上弦会丢失。日常回坊请使用上方对账合并。</p>
          <el-button type="danger" plain :icon="RefreshLeft" @click="restoreInput?.click()">选择备份整库恢复</el-button>
          <input ref="restoreInput" type="file" accept="application/json,.json" hidden @change="onPickRestore" />
        </el-card>
      </el-tab-pane>

      <!-- 未选内容后补做 -->
      <el-tab-pane :label="`未选内容后补做（${mergeStore.pendingHistory.length}）`" name="history">
        <el-card shadow="never" class="block">
          <template #header>冲突时未选中、转入历史的记录（补做后标记完成）</template>
          <el-table :data="mergeStore.history" size="small" border>
            <el-table-column label="阶段" width="90">
              <template #default="scope">{{ STAGE_LABELS[scope.row.stage as StageKey] }}</template>
            </el-table-column>
            <el-table-column prop="guqinNo" label="琴号" width="110" />
            <el-table-column prop="matchKey" label="对账键" width="140" />
            <el-table-column label="当时继续使用" width="120">
              <template #default="scope">
                <el-tag size="small" :type="scope.row.winnerSide === 'local' ? 'success' : 'warning'">{{ scope.row.winnerSide === 'local' ? '本机' : '对端' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="转入时间" width="120">
              <template #default="scope">{{ fmt(scope.row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="scope">
                <el-tag v-if="scope.row.redone" size="small" type="info" :icon="CircleCheck">已补做</el-tag>
                <el-tag v-else size="small" type="danger">待补做</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="200">
              <template #default="scope">
                <el-button link type="primary" @click="historyDetail = scope.row">查看两版</el-button>
                <el-button v-if="!scope.row.redone" link type="success" @click="markRedone(scope.row)">标记补做完成</el-button>
                <el-button link type="danger" @click="mergeStore.removeHistory(scope.row.id)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 变更摘要流水 -->
      <el-tab-pane label="变更摘要流水" name="changes">
        <el-card shadow="never" class="block">
          <template #header>四个工序阶段随记录保存的变更摘要（历次修改均保留）</template>
          <el-table :data="mergeStore.changes" size="small" border>
            <el-table-column label="阶段" width="90">
              <template #default="scope">{{ STAGE_LABELS[scope.row.stage as StageKey] }}</template>
            </el-table-column>
            <el-table-column prop="guqinNo" label="琴号" width="110" />
            <el-table-column prop="lastSummary" label="最近变更摘要" min-width="280" show-overflow-tooltip />
            <el-table-column prop="lastRev" label="修订" width="70" />
            <el-table-column label="时间" width="120">
              <template #default="scope">{{ fmt(scope.row.lastAt) }}</template>
            </el-table-column>
            <el-table-column prop="deviceId" label="设备" width="130" />
            <el-table-column label="历史" width="80">
              <template #default="scope">{{ scope.row.history.length }} 条</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 后补历史两版对照 -->
    <el-dialog v-model="historyDetail" title="未选内容两版对照" width="820px">
      <template v-if="historyDetail">
        <el-alert type="warning" :closable="false" show-icon class="block">
          <template #title>
            {{ STAGE_LABELS[historyDetail.stage] }} · 琴号 {{ historyDetail.guqinNo }} · 当时继续使用「{{ historyDetail.winnerSide === 'local' ? '本机' : '对端' }}」，另一边请据此补做。
          </template>
        </el-alert>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-card shadow="never" header="本机版本">
              <div class="side-summary">{{ historyDetail.localSummary || '无摘要' }}</div>
              <el-descriptions :column="1" size="small" border>
                <el-descriptions-item v-for="item in sideView(historyDetail.stage, (historyDetail.local ?? {}) as Record<string, unknown>)" :key="item.label" :label="item.label">{{ item.value }}</el-descriptions-item>
              </el-descriptions>
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card shadow="never" header="对端版本">
              <div class="side-summary">{{ historyDetail.incomingSummary || '无摘要' }}</div>
              <el-descriptions :column="1" size="small" border>
                <el-descriptions-item v-for="item in sideView(historyDetail.stage, (historyDetail.incoming ?? {}) as Record<string, unknown>)" :key="item.label" :label="item.label">{{ item.value }}</el-descriptions-item>
              </el-descriptions>
            </el-card>
          </el-col>
        </el-row>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #4a3728;
}
.page-desc {
  margin: 0 0 12px;
  color: #8a7a68;
  font-size: 13px;
}
.block {
  margin-bottom: 16px;
  border-radius: 8px;
}
.compat-hint {
  margin-left: 8px;
  color: #b8860b;
  font-size: 12px;
}
.conflict-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.conflict-collapse {
  margin-top: 8px;
}
.stage-title {
  font-weight: 600;
  margin-right: 8px;
}
.conflict-item {
  padding: 10px 0;
  border-bottom: 1px dashed #e0d4c2;
}
.conflict-sub {
  font-size: 13px;
  color: #6b5a48;
  margin-bottom: 8px;
}
.side-group {
  display: flex;
  gap: 12px;
  width: 100%;
}
.side-radio {
  flex: 1;
  height: auto !important;
  align-items: flex-start !important;
  padding: 8px 10px;
  white-space: normal;
}
.side-card {
  margin-left: 8px;
}
.side-name {
  font-weight: 600;
  color: #4a3728;
  margin-bottom: 4px;
}
.side-summary {
  font-size: 13px;
  color: #5a4a3a;
  margin: 4px 0;
  line-height: 1.6;
}
.side-meta {
  font-size: 12px;
  color: #a08f7d;
}
.diff-table {
  margin-top: 8px;
}
.cell-changed {
  color: #c4561e;
  font-weight: 600;
}
.merge-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
}
.unresolved-hint {
  color: #c4561e;
  font-size: 13px;
}
.danger-card :deep(.el-card__header) {
  color: #b03a2e;
}
.danger-text {
  font-size: 13px;
  color: #8a7a68;
  margin: 0 0 10px;
}
</style>
