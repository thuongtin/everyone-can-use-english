<template>
  <span
    class="wordmark"
    :style="{ minWidth: `${width}px`, height: `${height}px`, fontSize: `${Number(height) * 0.85}px` }"
  >1000 giờ</span>
</template>

<script lang="ts" setup>
defineProps({
  width: { type: String, default: "72" },
  height: { type: String, default: "18" },
});
</script>

<style scoped>
.wordmark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 700;
  line-height: 1;
  color: inherit;
}
</style>
