<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Download, Upload, Bell } from '@element-plus/icons-vue';
import { seedIfEmpty } from './utils/seed';
import { SCHEMA_VERSION } from './utils/db';
import { downloadText, exportBackupJson, parseBackup, type BackupPayload } from './utils/export';
import { getDevice, renameDevice, type DeviceInfo } from './utils/device';
import { buildReconcilePlan, applyMergePlan, loadLocalState, type ReconcilePlan, type MergeResult } from './utils/merge';
import { useBoardStore } from './stores/boardStore';
import { useChamberStore } from './stores/chamberStore';
import { useLacquerStore } from './stores/lacquerStore';
import { useStringingStore } from './stores/stringingStore';
import { useChangeStore } from './stores/changeStore';
import { useHistoryStore } from './stores/historyStore';
import MergeDialog from './components/common/MergeDialog.vue';

const route = useRoute();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();
const changeStore = useChangeStore();
const historyStore = useHistoryStore();
const ready = ref(false);
const device = ref<DeviceInfo | null>(null);

const mergeVisible = ref(false);
const plan = ref<ReconcilePlan | null>(null);
const pendingPayload = ref<BackupPayload | null>(null);

async function hydrateAll() {
  await Promise.all([
    boardStore.hydrate(),
    chamberStore.hydrate(),
    lacquerStore.hydrate(),
    stringingStore.hydrate(),
    changeStore.hydrate(),
    historyStore.hydrate(),
  ]);
}

onMounted(async () => {
  try {
    await seedIfEmpty();
    device.value = await getDevice();
    await hydrateAll();
  } catch (error) {
    ElMessage.error(`本地数据装载失败：${(error as Error).message}`);
  } finally {
    ready.value = true;
  }
});

const pendingHistoryCount = computed(() => historyStore.pendingCount);

async function handleExport() {
  const json = await exportBackupJson();
  downloadText(`gbguqin-backup-${new Date().toISOString().slice(0, 10)}.json`, json);
  ElMessage.success(`已导出全量备份（含 ${changeStore.entries.length} 条工序变更摘要）`);
}

async function handleRenameDevice() {
  const { value } = await ElMessageBox.prompt('给这台平板起个对账时显示的名字', '本机设备名', {
    confirmButtonText: '保存',
    cancelButtonText: '取消',
    inputValue: device.value?.deviceName ?? '',
  }).catch(() => ({ value: undefined }));
  if (value === undefined || !device.value) return;
  device.value = await renameDevice(value);
  ElMessage.success('设备名已保存');
}

function pickFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('未选择文件'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    };
    input.click();
  });
}

async function handleImport() {
  let text: string;
  try {
    text = await pickFile();
  } catch (error) {
    ElMessage.info((error as Error).message);
    return;
  }

  let payload: BackupPayload;
  try {
    payload = parseBackup(text);
  } catch (error) {
    ElMessage.error((error as Error).message);
    return;
  }

  if (!device.value) device.value = await getDevice();

  if (payload.schemaVersion > SCHEMA_VERSION) {
    try {
      await ElMessageBox.confirm(
        `该备份由更新版本导出（schema ${payload.schemaVersion}，本机为 ${SCHEMA_VERSION}），低版本无法识别新字段，建议先升级本应用。仍要继续对账合并吗？`,
        '备份版本更高',
        { type: 'warning', confirmButtonText: '仍然合并', cancelButtonText: '取消' },
      );
    } catch {
      return;
    }
  }

  const { localTables, localChanges, watermarks } = await loadLocalState(device.value);
  const nextPlan = buildReconcilePlan({
    localTables,
    localChanges,
    localDevice: device.value,
    payload,
    watermarks,
  });

  if (nextPlan.groups.length === 0) {
    ElMessage.success('该备份没有需要对账的新变更（可能此前已合并过）');
    return;
  }
  pendingPayload.value = payload;
  plan.value = nextPlan;
  mergeVisible.value = true;
}

async function handleConfirmMerge(nextPlan: ReconcilePlan): Promise<MergeResult> {
  if (!pendingPayload.value) return { acceptedUnits: 0, conflictUnits: 0, deferredCount: 0, demoSkipped: [], replayedDeletes: 0 };
  let result: MergeResult;
  try {
    result = await applyMergePlan(nextPlan, pendingPayload.value);
  } catch (error) {
    ElMessage.error((error as Error).message);
    throw error;
  }
  await hydrateAll();
  mergeVisible.value = false;
  plan.value = null;
  pendingPayload.value = null;

  const parts = [
    `完成对账 ${result.acceptedUnits} 个阶段`,
    result.conflictUnits ? `其中冲突选择 ${result.conflictUnits}` : '',
    result.deferredCount ? `${result.deferredCount} 条未选内容已转入历史后补做` : '',
    result.replayedDeletes ? `同步删除 ${result.replayedDeletes} 条` : '',
  ].filter(Boolean);
  ElMessage.success(parts.join('，'));
  if (result.demoSkipped.length) {
    ElMessage.warning(`有 ${result.demoSkipped.length} 条演示样例未覆盖正式记录，已跳过`);
  }
  return result;
}
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="208px" class="app-aside">
      <div class="brand">
        <div class="brand-title">古琴斫制工序记录台</div>
        <div class="brand-sub">gbguqin · 纯前端本地存储</div>
        <el-button link class="device-name" @click="handleRenameDevice">
          本机：{{ device?.deviceName ?? '…' }}
        </el-button>
      </div>
      <el-menu :default-active="route.path" router class="app-menu" background-color="#4a3728" text-color="#f0e6d8" active-text-color="#ffd591">
        <el-menu-item index="/">琴坯进度</el-menu-item>
        <el-menu-item index="/boards">板材登记</el-menu-item>
        <el-menu-item index="/chambers">槽腹尺寸</el-menu-item>
        <el-menu-item index="/lacquer">灰胎髹漆</el-menu-item>
        <el-menu-item index="/stringing">上弦评价</el-menu-item>
        <el-menu-item index="/history">
          合并历史
          <el-badge v-if="pendingHistoryCount" :value="pendingHistoryCount" class="history-badge" />
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="app-header">
        <span class="header-title">{{ (route.meta?.title as string) ?? '古琴斫制工序记录台' }}</span>
        <div class="header-actions">
          <el-button :icon="Bell" @click="handleImport">合并档案</el-button>
          <el-button type="primary" :icon="Download" @click="handleExport">导出备份</el-button>
        </div>
      </el-header>
      <el-main v-loading="!ready" element-loading-text="正在装载本地工序档案…" class="app-main">
        <router-view />
      </el-main>
      <el-footer class="app-footer">数据保存在浏览器 IndexedDB（gbguqin-db），不依赖后端服务；导出摘要随工序阶段保存，回坊后按琴号对账合并</el-footer>
    </el-container>
  </el-container>

  <MergeDialog
    v-if="plan"
    v-model="mergeVisible"
    :plan="plan"
    :local-device="device!"
    @confirm="handleConfirmMerge"
  />
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}
.app-aside {
  background: #4a3728;
  color: #f0e6d8;
}
.brand {
  padding: 16px 16px 8px;
}
.brand-title {
  font-size: 15px;
  font-weight: 600;
}
.brand-sub {
  font-size: 12px;
  color: #cbb79f;
}
.device-name {
  color: #ffd591 !important;
  font-size: 12px;
  padding: 4px 0 0;
  height: auto;
}
.app-menu {
  border-right: none;
}
.history-badge {
  margin-left: 8px;
}
.app-header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #ece0cf;
}
.header-title {
  font-weight: 600;
  color: #4a3728;
}
.header-actions {
  display: flex;
  gap: 8px;
}
.app-main {
  background: #f7f3ed;
  min-height: 60vh;
}
.app-footer {
  text-align: center;
  color: #a3968a;
  font-size: 12px;
  line-height: 48px;
}
</style>
