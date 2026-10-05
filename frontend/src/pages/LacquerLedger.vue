<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import StatBadge from '../components/common/StatBadge.vue';
import LayerStack from '../components/common/LayerStack.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import { useLacquerStore } from '../stores/lacquerStore';
import { useBoardStore } from '../stores/boardStore';
import { averageThickness, curingInRange, formatDate, layersToTarget, TARGET_TOTAL_MM } from '../utils/layer';
import { MIX_RATIOS, type LacquerLayer } from '../types/lacquer-layer';

const lacquerStore = useLacquerStore();
const boardStore = useBoardStore();

const guqinOptions = computed(() => Array.from(new Set([...boardStore.guqinNos, ...lacquerStore.guqinNos])).sort());
const selectedGuqin = ref(guqinOptions.value[0] ?? '');
watch(guqinOptions, (list) => {
  if (!selectedGuqin.value && list.length) {
    selectedGuqin.value = list[0];
  }
});

const layers = computed(() => (selectedGuqin.value ? lacquerStore.layersOf(selectedGuqin.value) : []));
const total = computed(() => (selectedGuqin.value ? lacquerStore.totalOf(selectedGuqin.value) : 0));
const abnormal = computed(() => layers.value.filter((layer) => !curingInRange(layer.curingTemp, layer.curingHumidity)).length);

const dialogVisible = ref(false);
const editingId = ref('');
const formRef = ref<FormInstance>();

interface LacquerForm {
  guqinNo: string;
  mixRatio: string;
  curingTemp: number;
  curingHumidity: number;
  polishGrit: number;
  layerThickness: number;
  appliedAt: string;
  operator: string;
  remark: string;
}

const form = ref<LacquerForm>({
  guqinNo: '',
  mixRatio: '1:1',
  curingTemp: 25,
  curingHumidity: 78,
  polishGrit: 320,
  layerThickness: 0.1,
  appliedAt: new Date().toISOString().slice(0, 10),
  operator: '林听雪',
  remark: '',
});

const rules: FormRules = {
  guqinNo: [{ required: true, message: '请输入琴号', trigger: 'blur' }],
  operator: [{ required: true, message: '请输入髹漆人', trigger: 'blur' }],
};

function openAppend() {
  editingId.value = '';
  form.value = {
    guqinNo: selectedGuqin.value || guqinOptions.value[0] || 'Q-2501',
    mixRatio: '1:1',
    curingTemp: 25,
    curingHumidity: 78,
    polishGrit: 320,
    layerThickness: 0.1,
    appliedAt: new Date().toISOString().slice(0, 10),
    operator: '林听雪',
    remark: '',
  };
  dialogVisible.value = true;
}

function openEdit(layer: LacquerLayer) {
  editingId.value = layer.id;
  form.value = {
    guqinNo: layer.guqinNo,
    mixRatio: layer.mixRatio,
    curingTemp: layer.curingTemp,
    curingHumidity: layer.curingHumidity,
    polishGrit: layer.polishGrit,
    layerThickness: layer.layerThickness,
    appliedAt: layer.appliedAt.slice(0, 10),
    operator: layer.operator,
    remark: layer.remark ?? '',
  };
  dialogVisible.value = true;
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  const payload = {
    guqinNo: form.value.guqinNo,
    mixRatio: form.value.mixRatio,
    curingTemp: Number(form.value.curingTemp) || 0,
    curingHumidity: Number(form.value.curingHumidity) || 0,
    polishGrit: Number(form.value.polishGrit) || 0,
    layerThickness: Number(form.value.layerThickness) || 0,
    appliedAt: new Date(`${form.value.appliedAt}T09:00:00`).toISOString(),
    operator: form.value.operator,
    remark: form.value.remark,
  };
  if (editingId.value) {
    await lacquerStore.updateLayer(editingId.value, payload);
    ElMessage.success('已更新该遍记录并重算累计厚度');
  } else {
    const created = await lacquerStore.appendLayer(payload);
    selectedGuqin.value = created.guqinNo;
    ElMessage.success(`已追加第 ${created.seq} 遍，累计厚度 ${created.totalThickness.toFixed(2)}mm`);
  }
  dialogVisible.value = false;
}

async function remove(layer: LacquerLayer) {
  const confirmed = await ElMessageBox.confirm(`确认删除 ${layer.guqinNo} 第 ${layer.seq} 遍记录？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await lacquerStore.removeLayer(layer.id);
  ElMessage.success('已删除并重算累计厚度');
}
</script>

<template>
  <div>
    <h2 class="page-title">灰胎髹漆遍次台账</h2>
    <p class="page-desc">按遍次累加灰胎厚度，记录荫房温湿度与打磨目数；工艺窗口为 20~30℃ / 70~85%。</p>

    <div class="toolbar">
      <el-button type="primary" @click="openAppend">追加髹漆遍次</el-button>
      <el-select v-model="selectedGuqin" placeholder="选择琴号" style="width: 180px">
        <el-option v-for="no in guqinOptions" :key="no" :label="no" :value="no" />
      </el-select>
      <el-tag type="warning" effect="plain">髹漆目标累计 {{ TARGET_TOTAL_MM }}mm</el-tag>
    </div>

    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :md="6">
        <StatBadge label="该琴髹漆遍次" :value="layers.length" unit="遍" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="累计厚度" :value="total.toFixed(2)" unit="mm" :status="total >= TARGET_TOTAL_MM ? 'success' : 'warning'" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="每遍平均厚度" :value="averageThickness(layers)" unit="mm" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="荫房超窗口遍次" :value="abnormal" unit="遍" :status="abnormal ? 'danger' : 'success'" />
      </el-col>
    </el-row>

    <EmptyPanel v-if="layers.length === 0" description="该琴暂无髹漆遍次记录" action-text="追加髹漆遍次" @action="openAppend" />

    <template v-else>
      <el-card shadow="never" class="block">
        <template #header>
          <div class="card-head">
            <span>层积与累计厚度（LayerStack）</span>
            <span class="card-note">按当前每遍厚度，距目标还需约 {{ layersToTarget(layers, TARGET_TOTAL_MM) }} 遍</span>
          </div>
        </template>
        <LayerStack :layers="layers" />
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>遍次明细</template>
        <el-table :data="layers" size="small" border>
          <el-table-column prop="seq" label="遍次" width="70" />
          <el-table-column prop="mixRatio" label="灰胎配比" width="100" />
          <el-table-column prop="curingTemp" label="荫房温度(℃)" width="110" />
          <el-table-column prop="curingHumidity" label="湿度(%)" width="90" />
          <el-table-column label="温湿度" width="100">
            <template #default="scope">
              <el-tag :type="curingInRange(scope.row.curingTemp, scope.row.curingHumidity) ? 'success' : 'danger'" size="small">
                {{ curingInRange(scope.row.curingTemp, scope.row.curingHumidity) ? '窗口内' : '超窗口' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="polishGrit" label="打磨目数" width="100" />
          <el-table-column prop="layerThickness" label="本遍(mm)" width="90" />
          <el-table-column prop="totalThickness" label="累计(mm)" width="90" />
          <el-table-column label="施工日期" width="110">
            <template #default="scope">{{ formatDate(scope.row.appliedAt) }}</template>
          </el-table-column>
          <el-table-column prop="operator" label="髹漆人" width="90" />
          <el-table-column prop="remark" label="备注" min-width="120" />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
              <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑髹漆遍次' : '追加髹漆遍次'" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="130px">
        <el-form-item label="琴号" prop="guqinNo">
          <el-input v-model="form.guqinNo" placeholder="如：Q-2501" maxlength="20" style="width: 200px" />
        </el-form-item>
        <el-form-item label="灰胎配比">
          <el-select v-model="form.mixRatio" style="width: 200px">
            <el-option v-for="ratio in MIX_RATIOS" :key="ratio" :label="ratio" :value="ratio" />
          </el-select>
        </el-form-item>
        <el-form-item label="荫房温度(℃)">
          <el-input-number v-model="form.curingTemp" :min="5" :max="45" placeholder="荫房温度" />
        </el-form-item>
        <el-form-item label="荫房湿度(%)">
          <el-input-number v-model="form.curingHumidity" :min="30" :max="100" placeholder="荫房湿度" />
        </el-form-item>
        <el-form-item label="打磨目数">
          <el-input-number v-model="form.polishGrit" :min="80" :max="2000" :step="20" placeholder="打磨目数" />
        </el-form-item>
        <el-form-item label="本遍厚度(mm)">
          <el-input-number v-model="form.layerThickness" :min="0.01" :max="1" :step="0.01" :precision="2" placeholder="本遍厚度" />
        </el-form-item>
        <el-form-item label="施工日期">
          <el-date-picker v-model="form.appliedAt" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="髹漆人" prop="operator">
          <el-input v-model="form.operator" placeholder="如：林听雪" maxlength="16" style="width: 200px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="60" placeholder="干燥情况等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
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
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.stat-row {
  margin-bottom: 12px;
}
.stat-row .el-col {
  margin-bottom: 12px;
}
.block {
  margin-bottom: 16px;
  border-radius: 8px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-note {
  font-size: 12px;
  color: #8a7a68;
}
</style>
