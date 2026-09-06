<template>
  <div class="price">
    <div class="container m-auto">
      <div class="gap-[48px] grid grid-cols-1 md:grid-cols-2">
        <div class="intro">
          <div class="title text-[20px] md:text-[32px]">Dịch vụ bổ sung</div>
          <div class="subtitle text-[14px] md:text-[16px]">
            Enjoy App
            tính phí theo mức sử dụng của từng tính năng. Khi dùng hết số dư ban đầu, bạn có thể nạp thêm để tiếp tục dùng dịch vụ trả phí.
          </div>

          <div class="items">
            <div v-for="(item, index) in items" :key="index" class="item">
              <span>
                <img src="/portal-static/icon/check.svg" />
              </span>
              <span class="text-[14px] md:text-[16px]">{{ item }}</span>
            </div>
          </div>
        </div>

        <div class="self-center">
          <img
            class="md:h-[356px] lg:hidden"
            src="/portal-static/images/payment.png"
          />

          <img
            class="hidden lg:block"
            src="/portal-static/images/payment-2.png"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default {
  name: "Price",
};
</script>

<script lang="ts" setup>
const items = ref([
  "Luyện nhại với nhiều âm thanh hơn",
  "Luyện nhại với nhiều video hơn",
  "Luyện đọc thêm bài viết",
  "Tăng số lượt trò chuyện với trợ lý AI",
  "Các dịch vụ bổ sung khác đang được phát triển",
]);
</script>

<style lang="scss" scoped>
.price {
  margin-top: 126px;
  color: #212121;

  .intro {
    flex-basis: 400px;

    .title {
      line-height: 32px;
      font-weight: 600;
    }

    .subtitle {
      font-weight: 400;
      margin-top: 20px;
    }
  }

  .items {
    margin-top: 32px;

    .item {
      display: flex;
      align-items: center;
      line-height: 1;
      gap: 12px;
      font-size: 18px;
      font-weight: 500;
      margin-bottom: 24px;

      &:last-child {
        margin-bottom: 0;
        color: #979797;
      }
    }
  }
}
</style>
