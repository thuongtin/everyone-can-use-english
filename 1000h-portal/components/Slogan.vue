<template>
  <div class="text-center slogan-section mt-[52px] lg:mt-[82px]">
    <div class="container m-auto mb-2">
      <Logo width="112" height="29" class="inline-block text-primary" />
    </div>

    <div class="mb-3">
      <div
        class="slogan inline-block text-greyscale_2 text-[24px] md:text-[48px] px-6 md:px-12 lg:max-w-[800px]"
      >
        Dành trọn sự tập trung cho 1000 giờ luyện tập để làm chủ kỹ năng bạn cần...
      </div>
    </div>

    <div
      class="hint flex justify-center text-greyscale_4 text-[14px] md:text-[18px]"
    >
      Cùng
      <span class="flex text-greyscale_1 mr-1">
        <img
          src="/portal-static/icon/enjoy-app.svg"
          width="24"
          height="24"
          class="mx-1"
        />
        Enjoy App
      </span>
      tận hưởng 1000 giờ học tập này
    </div>

    <div class="mt-6 max-sm:inline-flex max-sm:gap-4 max-sm:flex-col">
      <a
        :href="distributionLinks.docsUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        <button
          class="action px-4 py-3 md:px-5 md:py-4 text-[14px] md:text-[16px] max-sm:w-[260px]"
        >
          <span class="mr-1">Xem hướng dẫn học 1000 giờ</span>

          <img src="/portal-static/icon/arrow-right.svg" width="24" />
        </button>
      </a>

      <a
        :href="distributionLinks.downloadUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        <button
          class="action secondary px-4 py-3 md:px-5 md:py-4 text-[14px] md:text-[16px] sm:ml-4 max-sm:w-[260px]"
        >
          <span class="mr-1">Xem hướng dẫn tải Enjoy App</span>
        </button>
      </a>
    </div>

  </div>

  <div class="demo mt-[80px] md:mt-[120px] h-[260px] md:h-[380px] lg:h-[620px]">
    <div class="bg h-[260px] md:h-[380px] lg:h-[620px]"></div>

    <div class="container m-auto text-center">
      <DemoScreen />
    </div>
  </div>
</template>

<script lang="ts">
export default {
  name: "Slogan",
};
</script>

<script lang="ts" setup>
import { resolveDistributionLinks } from "~/utils/distribution-links";

const distributionLinks = resolveDistributionLinks(useRuntimeConfig().public);

</script>

<style lang="scss" scoped>
.slogan {
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 700;
  line-height: 1.5;
}

.container {
  position: relative;
}

.action {
  transition: ease-in-out 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #252525;
  color: white;
  border-radius: 9999px;

  &:hover {
    background: #4797f5;
  }
}

.action.secondary {
  border: 2px solid #252525;
  color: #252525;
  background: white;

  &:hover {
    color: #4797f5;
    border-color: #4797f5;
  }
}

.demo {
  position: relative;

  .bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    background-image: url("/portal-static/images/bg-demo.png");
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    z-index: -1;
  }

  .demo-screen {
    border-radius: 12px;
  }
}
</style>
