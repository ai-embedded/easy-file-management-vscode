<template>
  <el-config-provider :locale="elementLocale">
    <slot />
  </el-config-provider>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElConfigProvider } from 'element-plus';
import { getElementLocale } from '../utils/i18n';

const { locale } = useI18n();
const elementLocale = ref(getElementLocale(locale.value));

// 监听语言变更
watch(locale, (newLocale) => {
  elementLocale.value = getElementLocale(newLocale);
}, { immediate: true });
</script>
