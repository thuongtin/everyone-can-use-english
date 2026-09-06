<template>
  <div class="footer">
    <div>© {{ year }} Công ty Công nghệ Giáo dục Bandu Bắc Kinh</div>
    <div class="opacity-50 mt-1">Mã đăng ký website tại Trung Quốc: Beijing ICP 2022015741-3</div>
  </div>
</template>

<script lang="ts">
export default {
  name: "PageFooter",
};
</script>

<script lang="ts" setup>
const year = computed(() => {
  return new Date().getFullYear();
});
</script>

<style lang="scss" scoped>
.footer {
  color: #0d0d0d;
  padding: 65px 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  font-size: 12px;
  font-weight: 400;
}
</style>
