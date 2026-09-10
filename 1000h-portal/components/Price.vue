<template>
  <div class="price">
    <div class="container m-auto">
      <div class="gap-[48px] grid grid-cols-1 md:grid-cols-2">
        <div class="intro">
          <div class="title text-[20px] md:text-[32px]">Chọn dịch vụ AI của bạn</div>
          <div class="subtitle text-[14px] md:text-[16px]">
            Thư viện và tiến độ học được lưu trên máy. Bạn tự chọn provider cho từng tác vụ; chi phí và hạn mức do provider đó quản lý.
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

        <div class="self-center rounded-2xl border border-gray-200 p-8">
          <h3 class="text-xl font-semibold">Cấu hình một lần, chọn theo nhu cầu</h3>
          <p class="mt-4">Dùng API key riêng, provider local hoặc tài khoản ACP đã cấu hình. Tính năng cần dịch vụ ngoài sẽ hướng dẫn cấu hình trước khi chạy.</p>
          <p class="mt-4">Bạn quản lý thanh toán trực tiếp với provider. Ứng dụng không có ví hay nạp tiền Enjoy.</p>
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
  "Chat và xử lý văn bản với provider đã chọn",
  "Chuyển giọng nói thành văn bản bằng dịch vụ phù hợp",
  "TTS và đánh giá phát âm với cấu hình riêng",
  "Bài đọc, từ vựng và lịch ôn được lưu local",
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
