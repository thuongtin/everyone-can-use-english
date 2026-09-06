<template>
  <div
    v-if="loaded"
    class="demo-screen w-[312px] md:w-[682px] lg:w-[1024px] top-[-40px] md:top-[-60px]"
  >
    <img class="bg" :src="bg" alt="" aria-hidden="true" />

    <section
      class="content-container"
      aria-label="Minh họa thư viện học liệu"
    >
      <div class="demo-label">Minh họa học liệu tiếng Anh</div>

      <article
        v-for="item in examples"
        :key="item.title"
        class="content-card"
      >
        <img class="content" :src="item.image" :alt="item.alt" />
        <div class="content-copy">
          <h3>{{ item.title }}</h3>
          <p>{{ item.description }}</p>
        </div>
      </article>
    </section>

    <div class="sidebar-container">
      <img class="logo" :src="applogo" alt="Enjoy App" />
      <img class="sidebar" :src="sidebar" alt="Thanh điều hướng của Enjoy App" />
      <img class="help" :src="help" alt="Trợ giúp" />
    </div>
  </div>
</template>

<script lang="ts">
export default {
  name: "DemoScreen",
};
</script>

<script lang="ts" setup>
import bg from "~/assets/images/background.png";
import applogo from "~/assets/images/applogo.png";
import sidebar from "~/assets/images/sidebar.png";
import help from "~/assets/images/help.png";
import content1 from "~/assets/images/content1.png";
import content2 from "~/assets/images/content2.png";

const loaded = ref(false);

const examples = [
  {
    title: "Sách nói tiếng Anh",
    description: "Chọn sách bạn yêu thích để nghe, nhại theo và ghi chú từ mới.",
    image: content1,
    alt: "Danh sách sách nói tiếng Anh từ Audible.com",
  },
  {
    title: "Video tiếng Anh có phụ đề",
    description: "Luyện nghe và nói theo các bài nói tiếng Anh từ TED.",
    image: content2,
    alt: "Danh sách video tiếng Anh từ TED",
  },
];

onMounted(async () => {
  await Promise.all([
    import("~/assets/images/content1.png"),
    import("~/assets/images/content2.png"),
    import("~/assets/images/applogo.png"),
    import("~/assets/images/sidebar.png"),
    import("~/assets/images/help.png"),
  ]);

  loaded.value = true;
});
</script>

<style lang="scss" scoped>
.demo-screen {
  display: inline-block;
  position: relative;
  overflow: hidden;

  img {
    position: absolute;
  }

  .bg {
    --startY: 640px;
    position: relative;
    display: block;
    width: 100%;
    height: 260px;
    object-fit: fill;
    animation: rotateIn 2s cubic-bezier(0.33, 1, 0.68, 1);
  }

  .sidebar-container {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;

    .logo {
      top: 5px;
      left: 7px;
    }

    .sidebar {
      top: 17px;
      left: 2px;
      width: 100%;
      max-width: none;
      // sidebar.png contains a non-transparent full-width canvas; retain only the navigation column.
      clip-path: inset(0 87.5% 0 0);
    }

    .help {
      width: 35px;
      bottom: 4px;
      left: 2px;
    }

    img {
      --delay: 0.1s;
      --startY: -120px;
      opacity: 0;
      animation: fadeIn 0.5s calc(var(--delay) + 0.5s) forwards
          cubic-bezier(0.65, 0, 0.35, 1),
        rotateIn 2s var(--delay) cubic-bezier(0.4, 0, 0.2, 1);
    }
  }

  .content-container {
    position: absolute;
    top: 8px;
    right: 8px;
    bottom: 8px;
    left: 56px;
    z-index: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
    align-content: start;

    .demo-label {
      grid-column: 1 / -1;
      justify-self: start;
      padding: 2px 6px;
      border-radius: 9999px;
      background: #252525;
      color: #fff;
      font-size: 8px;
      font-weight: 600;
      line-height: 1.2;
    }

    .content-card {
      min-width: 0;
      padding: 4px;
      overflow: hidden;
      border: 1px solid rgba(215, 215, 215, 0.9);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 2px 8px rgba(37, 37, 37, 0.08);
      opacity: 0;
      animation: fadeIn 0.5s var(--delay, 0.2s) forwards
        cubic-bezier(0.65, 0, 0.35, 1);

      &:nth-child(2) {
        --delay: 0.35s;
      }
    }

    .content {
      position: relative;
      display: block;
      width: 100%;
      height: auto;
      border-radius: 3px;
    }

    .content-copy {
      position: relative;
      padding: 3px 4px 1px;
      color: #252525;

      h3 {
        overflow: hidden;
        font-size: 10px;
        font-weight: 700;
        line-height: 1.2;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      p {
        margin-top: 2px;
        color: #6e6e6e;
        font-size: 8px;
        font-weight: 400;
        line-height: 1.25;
      }
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bg,
    .sidebar-container img,
    .content-container .content-card {
      opacity: 1;
      animation: none;
    }
  }
}

@media (min-width: 768px) {
  .demo-screen {
    .bg {
      height: 380px;
    }

    .sidebar-container {
      .logo {
        top: 15px;
        left: 12px;
      }

      .sidebar {
        top: 39px;
        left: 3px;
      }

      .help {
        width: 89px;
        bottom: 7px;
        left: 2px;
      }
    }

    .content-container {
      top: 14px;
      right: 12px;
      bottom: 14px;
      left: 122px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;

      .content-copy {
        padding: 5px 7px 3px;

        h3 {
          font-size: 13px;
        }

        p {
          margin-top: 3px;
          font-size: 10px;
        }
      }

      .demo-label {
        padding: 3px 8px;
        font-size: 11px;
      }
    }
  }
}

@media (min-width: 1024px) {
  .demo-screen {
    .bg {
      height: 620px;
    }

    .sidebar-container {
      .logo {
        top: 20px;
        left: 20px;
      }

      .sidebar {
        top: 60px;
        left: 5px;
      }

      .help {
        width: 120px;
        bottom: 12px;
        left: 5px;
      }
    }

    .content-container {
      top: 20px;
      right: 22px;
      bottom: 20px;
      left: 184px;
      gap: 18px;

      .content-copy {
        padding: 7px 9px 5px;

        h3 {
          font-size: 16px;
        }

        p {
          margin-top: 4px;
          font-size: 12px;
        }
      }

      .demo-label {
        padding: 4px 10px;
        font-size: 13px;
      }
    }
  }
}

@keyframes fadeIn {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

@keyframes rotateIn {
  0% {
    transform: perspective(1200px) rotateX(30deg) translateY(var(--startY));
  }
  75% {
    transform: perspective(1200px) rotateX(1.31deg) translateY(0);
  }
  100% {
    transform: perspective(1200px) rotateX(0deg) translateY(0);
  }
}
</style>
