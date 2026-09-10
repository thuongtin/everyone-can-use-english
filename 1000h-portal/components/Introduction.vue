<template>
  <div class="introduction mt-[64px] md:mt-[96px] lg:mt-[128px]">
    <div class="container m-auto">
      <div class="top flex justify-between">
        <div class="text-greyscale_1">
          <div class="title text-[20px] md:text-[32px]">Phương pháp học đơn giản</div>
          <div class="subtitle text-[14px] md:text-[16px]">
            Với sự hỗ trợ của AI, hãy bắt tay vào luyện tập mà không sa đà vào phương pháp phức tạp.
          </div>
        </div>

        <div class="hint text-[13px] md:text-[14px] text-greyscale_4">
          Về <br />
          sản phẩm
        </div>
      </div>

      <div class="cards grid-cols-1 md:grid-cols-2 lg:grid-cols-4 mt-8">
        <a
          v-for="(card, index) in cards"
          :key="index"
          :href="distributionLinks.docsUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="card"
          :style="{ backgroundImage: `url(${card.bg})` }"
        >
          <div class="lable" :style="{ color: card.colors[0] }">
            {{ card.label }}
          </div>
          <div class="title my-4" :style="{ color: card.colors[0] }">
            {{ card.title }}
          </div>
          <div class="subtitle" :style="{ color: card.colors[1] }">
            {{ card.subtitle }}
          </div>

          <div class="arrow">
            <img src="/portal-static/icon/arrow-upright.svg" />
          </div>
        </a>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default {
  name: "Introduction",
};
</script>

<script lang="ts" setup>
import { resolveDistributionLinks } from "~/utils/distribution-links";

const distributionLinks = resolveDistributionLinks(useRuntimeConfig().public);

const cards = ref([
  {
    label: "Sửa phát âm",
    title: "AI hỗ trợ sửa phát âm",
    subtitle: "Luyện phát âm với đánh giá từ Azure Speech khi bạn đã cấu hình dịch vụ.",
    bg: "/portal-static/images/bg-intro-1.png",
    colors: ["#384C6B", "#7B93AF"],
  },
  {
    label: "Theo dõi việc học",
    title: "Theo dõi quá trình học",
    subtitle: "Xem lại lịch sử học tập để nhận ra sự tiến bộ của mình.",
    bg: "/portal-static/images/bg-intro-2.png",
    colors: ["#4A6760", "#7C978F"],
  },
  {
    label: "Nhiều loại học liệu",
    title: "Học liệu trực tuyến đa dạng",
    subtitle: "Nhập âm thanh và video từ Internet, học ngôn ngữ qua nội dung bạn yêu thích.",
    bg: "/portal-static/images/bg-intro-3.png",
    colors: ["#384C6B", "#7B93AF"],
  },
  {
    label: "Củng cố trí nhớ",
    title: "Rèn luyện trí nhớ",
    subtitle: "Ôn lại nội dung với hệ thống ghi nhớ của Enjoy để củng cố điều đã học.",
    bg: "/portal-static/images/bg-intro-4.png",
    colors: ["#70584A", "#A4978D"],
  },
]);

</script>

<style lang="scss" scoped>
.introduction {
  .top {
    .title {
      font-weight: 600;
    }

    .subtitle {
      margin-top: 4px;
      font-weight: 400;
    }

    .hint {
      font-family: "New York";
      font-style: italic;
      font-weight: 400;
      text-align: right;
    }
  }

  .cards {
    display: grid;
    gap: 16px;

    .card {
      cursor: pointer;
      position: relative;
      text-decoration: none;
      color: #fff;
      height: 350px;
      padding: 24px;
      border-radius: 4px;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;

      &::before {
        content: "";
        position: absolute;
        top: 0;
        right: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        border-radius: 4px;
        background: #e5eff8;
        transition: ease-in-out 0.2s;
      }

      &:hover {
        &::before {
          opacity: 0.3;
        }

        .arrow {
          opacity: 1;
        }
      }

      .lable {
        font-family: "New York";
        font-size: 12px;
        font-style: italic;
      }

      .title {
        font-size: 20px;
        font-weight: 500;
        line-height: 1.5;
      }

      .subtitle {
        font-size: 14px;
        font-weight: 400;
        line-height: 1.5;
      }

      .arrow {
        position: absolute;
        opacity: 0;
        bottom: 24px;
        left: 24px;
        transition: ease-in-out 0.2s;
      }
    }
  }
}
</style>
