<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useHistoryStore } from '../stores/historyStore';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import { STAGE_LABELS, ACTION_LABELS, type DeferredRecord } from '../types/changes';
import { formatDate } from '../utils/layer';

const historyStore = useHistoryStore();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();

const tab = ref<'pending' | 'adopted'>('pending');
const detail = ref<DeferredRecord | null>(null);

const list = computed(() => (tab.value === 'pending' ? historyStore.pending : historyStore.adopted));

async function reloadStage(stage: DeferredRecord['stage']) {
  if (stage === 'board') await boardStore.hydrate();
  if (stage === 'chamber') await chamberStore.hydrate();
  if (stage === 'lacquer') await lacquerStore.hydrate();
  if (stage === 'stringing') await stringingStore.hydrate();
}

async function adopt(record: DeferredRecord) {
  try {
    await ElMessageBox.confirm(
      `将「${record.guqinNo} · ${STAGE_LABELS[record.stage]}」的未选内容作为正式记录取回采用？`,
      '取回采用',
      { type: 'warning', confirmButtonText: '取回采用', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  const { stage } = await historyStore.adopt(record.id);
  await reloadStage(stage);
  ElMessage.success('已取回采用并写回工序档案');
}

async function markDone(record: DeferredRecord) {
  const { value } = await ElMessageBox.prompt('已按未选摘要补做完成？可登记补做说明（仅留档）。', '标记后补做完成', {
    confirmButtonText: '完成补做',
    cancelButtonText: '取消',
    inputType: 'textarea',
    inputValue: record.note ?? '',
  }).catch(() => ({ value: undefined }));
  if (value === undefined) return;
  await historyStore.markDone(record.id, value);
  ElMessage.success('已标记补做完成');
}

async function remove(record: DeferredRecord) {
  try {
    await ElMessageBox.confirm('确定删除该条历史？删除后无法再取回。', '删除历史', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  await historyStore.remove(record.id);
  ElMessage.success('已删除');
}

function showDetail(record: DeferredRecord) {
  detail.value = record;
}
</script>

<template>
  <div class="history-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>合并历史 · 未选内容后补做</span>
          <el-tag v-if="historyStore.pendingCount" type="danger">待补做 {{ historyStore.pendingCount }}</el-tag>
        </div>
      </template>

      <el-tabs v-model="tab">
        <el-tab-pane :label="`待后补做（${historyStore.pending.length}）`" name="pending" />
        <el-tab-pane :label="`已处理（${historyStore.adopted.length}）`" name="adopted" />
      </el-tabs>

      <EmptyPanel v-if="list.length === 0" :description="tab === 'pending' ? '没有待后补做的未选内容' : '暂无已处理历史'" />

      <el-table v-else :data="list" stripe>
        <el-table-column label="琴号" prop="guqinNo" width="110" />
        <el-table-column label="阶段" width="80">
          <template #default="{ row }">{{ STAGE_LABELS[(row as DeferredRecord).stage] }}</template>
        </el-table-column>
        <el-table-column label="动作" width="70">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ ACTION_LABELS[(row as DeferredRecord).action] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="未选变更摘要" prop="summary" show-overflow-tooltip min-width="260" />
        <el-table-column label="来源设备" prop="deviceId" width="150" show-overflow-tooltip />
        <el-table-column label="转入时间" width="110">
          <template #default="{ row }">{{ formatDate((row as DeferredRecord).deferredAt) }}</template>
        </el-table-column>
        <el-table-column label="处理" width="230" fixed="right">
          <template #default="{ row }">
            <template v-if="tab === 'pending'">
              <el-button size="small" type="primary" @click="adopt(row as DeferredRecord)">取回采用</el-button>
              <el-button size="small" @click="markDone(row as DeferredRecord)">补做完成</el-button>
            </template>
            <el-tag v-else type="success" size="small">已处理</el-tag>
            <el-button link size="small" @click="showDetail(row as DeferredRecord)">明细</el-button>
            <el-button v-if="tab === 'adopted'" link size="small" type="danger" @click="remove(row as DeferredRecord)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="detail" title="未选内容明细" width="640px">
      <template v-if="detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="琴号 / 阶段">
            {{ detail.guqinNo }} · {{ STAGE_LABELS[detail.stage] }}（{{ ACTION_LABELS[detail.action] }}）
          </el-descriptions-item>
          <el-descriptions-item label="摘要">{{ detail.summary }}</el-descriptions-item>
          <el-descriptions-item label="来源设备 / 操作员">{{ detail.deviceId }}</el-descriptions-item>
          <el-descriptions-item label="变更时间 / 转入时间">
            {{ formatDate(detail.changedAt) }} / {{ formatDate(detail.deferredAt) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.adoptedAt" label="采用时间">
            {{ formatDate(detail.adoptedAt) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.note" label="补做说明">{{ detail.note }}</el-descriptions-item>
        </el-descriptions>
        <el-divider content-position="left">变更快照</el-divider>
        <pre class="snapshot">{{ JSON.stringify(detail.snapshots, null, 2) }}</pre>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  color: #4a3728;
}
.snapshot {
  max-height: 300px;
  overflow: auto;
  background: #f7f3ed;
  border-radius: 6px;
  padding: 10px;
  font-size: 12px;
}
</style>
