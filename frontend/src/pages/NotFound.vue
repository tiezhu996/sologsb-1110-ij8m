<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <el-result icon="warning" title="页面不存在" sub-title="请从左侧菜单进入古琴斫制工序记录台的各功能页">
    <template #extra>
      <el-button type="primary" @click="router.push('/')">返回琴坯进度</el-button>
    </template>
  </el-result>
</template>
