<template>
  <div class="features mt-[64px] md:mt-[96px] lg:mt-[128px]">
    <div class="container m-auto">
      <div class="top flex justify-between">
        <div class="text-greyscale_1">
          <div class="title text-[20px] md:text-[32px]">Tính năng nổi bật</div>
          <div class="subtitle text-[14px] md:text-[16px]">
            Các công cụ hỗ trợ bạn nghe, nói, đọc và ôn tập tiếng Anh.
          </div>
        </div>

        <div class="hint text-greyscale_4">
          Tính năng <br />
          sản phẩm
        </div>
      </div>

      <div class="cards grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        <div v-for="(feature, index) in features" :key="index" class="card">
          <div class="mr-6">
            <span class="icon">
              <img :src="feature.icon" />
            </span>
          </div>

          <div>
            <div class="title">{{ feature.title }}</div>
            <div class="subtitle">{{ feature.subtitle }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default {
  name: "Features",
};
</script>

<script lang="ts" setup>
const features = ref([
  {
    icon: "/portal-static/images/head-phone.png",
    title: "Luyện nhại với dạng sóng âm thanh",
    subtitle: "Âm thanh được phân tích và hiển thị trực quan để bạn luyện nhại theo mẫu.",
  },
  {
    icon: "/portal-static/images/camera.png",
    title: "Luyện nhại theo video",
    subtitle: "Bạn có thể luyện nhại theo video, tương tự như với âm thanh.",
  },
  {
    icon: "/portal-static/images/lang.png",
    title: "Đọc bài viết",
    subtitle: "Nhập bài viết ngoại ngữ để đọc và phân tích.",
  },
  {
    icon: "/portal-static/images/robot.png",
    title: "Trò chuyện tự nhiên với AI",
    subtitle: "Trợ lý AI đồng hành cùng bạn luyện ngoại ngữ.",
  },
  {
    icon: "/portal-static/images/note.png",
    title: "Ôn lại ghi chú",
    subtitle: "Gặp phần khó khi học? Ghi chú lại rồi ôn tập để hiểu chắc hơn.",
  },
  {
    icon: "/portal-static/images/book.png",
    title: "Ghi nhớ từ vựng",
    subtitle: "Gặp từ mới? Thêm vào sổ từ vựng để ôn tập.",
  },
  {
    icon: "/portal-static/images/cham.png",
    title: "Cùng cộng đồng luyện tập",
    subtitle: "Cùng những người học khác tiến bộ qua mỗi ngày, mỗi tuần, mỗi tháng.",
  },
]);
</script>

<style lang="scss" scoped>
.features {
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
      font-size: 14px;
      font-style: italic;
      font-weight: 400;
      text-align: right;
    }
  }

  .cards {
    display: grid;
    gap: 48px;
    margin-top: 32px;

    .card {
      display: flex;

      .icon {
        display: inline-block;
        width: 64px;
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .title {
        margin-bottom: 16px;
        font-size: 20px;
        font-weight: 500;
      }

      .subtitle {
        color: #979797;
        font-size: 14px;
        font-weight: 400;
      }
    }

    .compitition {
      color: #fff;
      background-image: url("/portal-static/images/bg-features.png");
      background-repeat: no-repeat;
      background-size: cover;
      position: relative;
      overflow: hidden;

      &::after {
        content: "";
        position: absolute;
        top: 48px;
        right: -20px;
        width: 824px;
        height: 448px;
        background-image: url("/portal-static/images/rank.png");
      }
    }
  }
}
</style>
