<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FilterField } from '../../types/ui';

const props = withDefaults(
  defineProps<{
    fields: FilterField[];
    keywordKey?: string;
    placeholder?: string;
    resultCount?: number;
    totalCount?: number;
  }>(),
  { keywordKey: 'kw', placeholder: '搜索琴号 / 板材号 / 备注', resultCount: -1, totalCount: -1 },
);

const route = useRoute();
const router = useRouter();

const readQuery = (key: string): string => {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
};

const keywordInput = ref(readQuery(props.keywordKey));
watch(
  () => route.query[props.keywordKey],
  (value) => {
    keywordInput.value = typeof value === 'string' ? value : '';
  },
);

function currentQuery(): Record<string, string> {
  const query: Record<string, string> = {};
  Object.entries(route.query).forEach(([k, v]) => {
    if (typeof v === 'string' && v) query[k] = v;
  });
  return query;
}

function update(key: string, value: string) {
  const query = currentQuery();
  if (value) {
    query[key] = value;
  } else {
    delete query[key];
  }
  void router.replace({ query });
}

function reset() {
  const query = currentQuery();
  [props.keywordKey, ...props.fields.map((f) => f.key)].forEach((key) => delete query[key]);
  void router.replace({ query });
}

const activeCount = computed(
  () => [props.keywordKey, ...props.fields.map((f) => f.key)].filter((key) => readQuery(key)).length,
);

const showCount = computed(() => props.resultCount >= 0 && props.totalCount >= 0);
</script>

<template>
  <div class="filter-bar">
    <el-input
      v-model="keywordInput"
      class="filter-input"
      clearable
      :placeholder="placeholder"
      @keyup.enter="update(keywordKey, keywordInput)"
      @clear="update(keywordKey, '')"
    >
      <template #append>
        <el-button @click="update(keywordKey, keywordInput)">搜索</el-button>
      </template>
    </el-input>
    <div v-for="field in fields" :key="field.key" class="filter-field">
      <span class="filter-label">{{ field.label }}</span>
      <el-select
        :model-value="readQuery(field.key)"
        :style="{ width: `${field.width ?? 130}px` }"
        clearable
        placeholder="全部"
        @change="(value: string) => update(field.key, value ?? '')"
      >
        <el-option v-for="option in field.options" :key="option" :label="option" :value="option" />
      </el-select>
    </div>
    <el-button :disabled="activeCount === 0" @click="reset">重置</el-button>
    <el-tag v-if="showCount" :type="resultCount === totalCount ? 'info' : 'success'" effect="plain">
      命中 {{ resultCount }} / {{ totalCount }}
    </el-tag>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.filter-input {
  width: 260px;
}
.filter-field {
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-label {
  font-size: 13px;
  color: #8a7a68;
}
</style>
