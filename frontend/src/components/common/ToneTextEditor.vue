<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ToneDraft, ToneVersion } from '../../types/stringing';

const props = withDefaults(
  defineProps<{
    modelValue: ToneDraft;
    versions?: ToneVersion[];
  }>(),
  { versions: () => [] },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: ToneDraft): void }>();

const selectedVersionId = ref('');
const selectedVersion = computed(() => props.versions.find((v) => v.id === selectedVersionId.value));

function patch(key: keyof ToneDraft, value: string) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

const compareRows = computed(() => {
  const version = selectedVersion.value;
  return [
    { label: '散音', current: props.modelValue.sanNote, history: version?.sanNote ?? '' },
    { label: '按音', current: props.modelValue.anNote, history: version?.anNote ?? '' },
    { label: '泛音', current: props.modelValue.fanNote, history: version?.fanNote ?? '' },
    { label: '九德', current: props.modelValue.nineVirtues, history: version?.nineVirtues ?? '' },
  ];
});
</script>

<template>
  <div class="tone-editor">
    <el-form label-position="top">
      <el-form-item label="散音评语（纯文本）">
        <el-input :model-value="modelValue.sanNote" type="textarea" :rows="2" maxlength="120" show-word-limit placeholder="散音评语" @input="(v: string) => patch('sanNote', v)" />
      </el-form-item>
      <el-form-item label="按音评语（纯文本）">
        <el-input :model-value="modelValue.anNote" type="textarea" :rows="2" maxlength="120" show-word-limit placeholder="按音评语" @input="(v: string) => patch('anNote', v)" />
      </el-form-item>
      <el-form-item label="泛音评语（纯文本）">
        <el-input :model-value="modelValue.fanNote" type="textarea" :rows="2" maxlength="120" show-word-limit placeholder="泛音评语" @input="(v: string) => patch('fanNote', v)" />
      </el-form-item>
      <el-form-item label="九德文字简述">
        <el-input :model-value="modelValue.nineVirtues" type="textarea" :rows="2" maxlength="120" show-word-limit placeholder="九德文字简述" @input="(v: string) => patch('nineVirtues', v)" />
      </el-form-item>
    </el-form>

    <div class="version-block">
      <div class="version-head">
        <span>评语版本对照（{{ versions.length }} 个历史版本）</span>
        <el-select v-model="selectedVersionId" placeholder="选择历史版本" clearable style="width: 240px" :disabled="versions.length === 0">
          <el-option
            v-for="version in versions"
            :key="version.id"
            :label="`${version.savedAt.slice(0, 16).replace('T', ' ')}`"
            :value="version.id"
          />
        </el-select>
      </div>
      <el-table v-if="selectedVersion" :data="compareRows" size="small" border>
        <el-table-column prop="label" label="项目" width="80" />
        <el-table-column prop="history" label="历史版本" />
        <el-table-column prop="current" label="当前编辑" />
      </el-table>
      <el-empty v-else :image-size="50" description="选择历史版本后可逐项对照文字评语" />
    </div>
  </div>
</template>

<style scoped>
.tone-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.version-block {
  border-top: 1px dashed #ece0cf;
  padding-top: 10px;
}
.version-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: #4a3728;
  margin-bottom: 8px;
}
</style>
