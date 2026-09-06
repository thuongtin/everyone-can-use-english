<template>
  <div
    class="comments mt-[64px] md:mt-[96px] pb-[32px] md:pb-[64px] lg:mt-[128px]"
  >
    <div class="container m-auto">
      <div class="top py-[32px] md:py-[64px] text-center">
        <div class="hint text-[13px] md:text-[14px]">Cộng đồng</div>
        <div class="title text-[24px] md:text-[32px]">Nhận xét của người dùng</div>
        <p class="mt-3 text-sm text-greyscale_4">
          Bản dịch lời nhận xét từ cộng đồng Enjoy gốc, giữ nguyên tên hiển thị để dẫn nguồn.
          Đây là trải nghiệm cá nhân của người viết, không phải lời chứng thực riêng cho bản Việt hóa.
        </p>
      </div>
    </div>

    <div class="items-container">
      <div class="items">
        <div
          v-for="(item, index) in [...comments, ...comments]"
          :key="index"
          class="item"
        >
          <img class="quote" src="/portal-static/icon/double-quote.svg" />

          <div class="top">
            <span>
              <img
                width="56"
                height="56"
                class="rounded-full"
                :src="item.avatar"
              />
            </span>

            <div class="ml-3">
              <div class="name">{{ item.name }}</div>
              <div class="hint">{{ item.hint }}</div>
            </div>
          </div>
          <div class="content" :style="{ width: item.width + 'px' || 'auto' }">
            {{ item.text }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default {
  name: "Comments",
};
</script>

<script lang="ts" setup>
import { parseUserStats, request, type UserStats } from "@/utils/http";

type UserStatsEntry = {
  mixinId: number;
  stats: UserStats;
};

const items = ref([
  {
    width: 420,
    mixinId: 39491012,
    avatar: "/portal-static/images/avatar.png",
    name: "Liu Yan^Box-DCA Practice Group 7 Years",
    hint: "Luyện tập tập trung",
    text: "Enjoy rất tiện sử dụng. Trước đây tôi tự viết bản thảo tiếng Trung, để Enjoy dịch sang tiếng Anh rồi luyện từng câu theo phát âm và ngữ điệu mẫu. Khi đạt trên 95 điểm, tôi bắt đầu học thuộc theo cách phát âm đúng. Giờ tôi đọc thành tiếng và học thuộc các tiếng lóng, cách nói thông dụng mà thầy Xiaolai tổng hợp mỗi ngày. Tôi đã tích lũy được nhiều cách dùng trước đây chưa quen, ngày nào cũng học thêm điều mới và tiến bộ. Tôi thực sự thấy mỗi ngày có ý nghĩa. Cảm ơn thầy Xiaolai đã giúp mọi người cùng đi trên con đường đúng.",
  },
  {
    mixinId: 39279749,
    avatar: "/portal-static/images/avatar.png",
    name: "Long Xiaofang aytc93",
    hint: "Luyện tập tập trung",
    text: "Mỗi sáng thức dậy lúc 5 giờ, tôi bắt đầu bằng việc đọc thành tiếng với Enjoy. Các thành ngữ thông dụng rất hay: mỗi ngày tôi đọc 10 mục, mỗi mục có 3 bản âm thanh. Đánh giá phát âm rất hữu ích, giúp biết âm tiết nào cần sửa. Tôi dùng Enjoy dịch cẩm nang trên 1000h rồi tạo âm thanh, chuẩn bị một lần đủ nội dung cho cả tháng. Những dòng chữ ấy khích lệ tôi luyện đủ 3 giờ mỗi ngày.",
  },
  {
    width: 420,
    mixinId: 37339898,
    avatar: "/portal-static/images/avatar.png",
    name: "Yvonne",
    hint: "Luyện tập tập trung",
    text: "Cảm nhận thực tế của tôi những ngày qua là có luyện tập thì có hiệu quả. Nhiều chi tiết phát âm trước kia tôi hoàn toàn không để ý đều được nhận diện và đánh dấu rõ. Tôi đã thay đổi rất nhiều trong những ngày này. Sau hàng loạt điều chỉnh nhỏ ở họng, lưỡi, môi và răng, việc đạt điểm cao dễ hơn nhiều so với lúc mới tập. Trước đây tôi đọc đi đọc lại không biết bao nhiêu lần; riêng hệ thống đã ghi nhận 400 đến 500 lượt đánh giá mỗi ngày. Giờ với 9 đến 10 câu, chỉ hơn 200 lượt là tôi đã có nhiều điểm 99 đến 100. Xin nhấn mạnh: hãy đặc biệt chú ý các dấu màu trong kết quả đánh giá để sửa ngay, điều này giúp ích rất nhiều. Tính năng phân tích câu cũng rất mạnh, tách rõ mọi thành phần của từng câu, hỗ trợ hiểu nghĩa, ngắt câu khi đọc và điều chỉnh nhấn mạnh, nhịp độ. Mọi người cùng cố gắng nhé!",
  },
  {
    mixinId: 37306363,
    avatar: "/portal-static/images/avatar.png",
    name: "Jing Huan",
    hint: "Luyện tập tập trung",
    text: "Enjoy thật mạnh mẽ! Gia đình tôi sống ở Hàn Quốc nên tiếng mẹ đẻ của các con đương nhiên là tiếng Hàn. Tôi rất ngạc nhiên khi Enjoy hỗ trợ cả bản dịch chú giải ngữ pháp bằng tiếng Hàn! Đầu năm, sau khi quyết định cùng con lớn học lớp 5 luyện tiếng Anh bằng Enjoy, tôi đã dừng lớp tiếng Anh ngoại khóa. Sau nửa năm luyện tập, con tiến bộ rất rõ: điểm tiếng Anh luôn tốt nhất lớp và khả năng nói thì rất xuất sắc. Trong khi đó, nhiều bạn cùng lớp vẫn trả tiền học thêm tiếng Anh.",
  },
  {
    mixinId: 1054922,
    avatar: "/portal-static/images/avatar.png",
    name: "Hou Liang",
    hint: "Luyện tập tập trung",
    text: "Enjoy rất dễ dùng. Với tôi, tính năng quan trọng nhất là chia nhỏ nhiệm vụ gần như không giới hạn, khiến việc học tiếng Anh trở nên đơn giản như trẻ nhỏ tập nói, gần như không còn ngưỡng bắt đầu. Cuối cùng chỉ còn một việc: luyện tập. Nếu học chưa tốt thì là do bản thân luyện chưa đủ. Cảm ơn đội ngũ phát triển Enjoy; ứng dụng khiến tôi muốn luyện mãi.",
  },
  {
    mixinId: 39637034,
    avatar: "/portal-static/images/avatar.png",
    name: "BigGang",
    hint: "Luyện tập tập trung",
    text: "Enjoy khiến việc luyện nói tiếng Anh của gia đình tôi tự nhiên như ăn cơm. Tôi và hai con dùng Enjoy để kể lại một tập Peppa Pig mỗi ngày. Sau ba tháng, khả năng nói của các con tiến bộ vượt bậc; giáo viên tiếng Anh người nước ngoài đánh giá rất cao khi con tốt nghiệp mẫu giáo. Tôi tin rằng khi thời gian luyện tập tích lũy dần, có thể chỉ ba năm hoặc ít hơn, các con sẽ sử dụng tiếng Anh hoàn toàn thoải mái. Enjoy là công cụ rất hữu ích cho bất cứ ai muốn học và luyện tiếng Anh. Tôi rất khuyến khích sử dụng.",
  },
  {
    mixinId: 37381381,
    avatar: "/portal-static/images/avatar.png",
    name: "Yang Xiucheng",
    hint: "Luyện tập tập trung",
    text: "Enjoy là phòng tập cho não bộ của tôi. Tôi thấy vui khi từng động tác phát âm dần chuyển từ vụng về sang thành thạo.",
  },
  {
    mixinId: 31766,
    avatar: "/portal-static/avatars/31766.jpg",
    name: "A Xin",
    hint: "Luyện tập tập trung",
    text: "Việc phát hiện mình phát âm sai rất hữu ích. Trước đây tôi không nhận ra; giờ đã chú ý và bắt đầu luyện để sửa.",
  },
  {
    mixinId: 39503702,
    avatar: "/portal-static/avatars/39503702.jpg",
    name: "Early Summer Tree",
    hint: "Luyện tập tập trung",
    text: "Sau năm tháng, cảm nhận ngôn ngữ và độ thành thạo khi nói của tôi tốt hơn rất nhiều, khả năng đọc cũng tiến bộ theo. Càng đọc nhiều tôi càng mạnh dạn. Tôi nghĩ mình sẽ dám mở lời khi gặp người nước ngoài; đôi khi còn tự đặt được vài câu ngắn.",
  },
  {
    mixinId: 37300002,
    avatar: "/portal-static/avatars/37300002.jpg",
    name: "Huang Mingying",
    hint: "Luyện tập tập trung",
    text: "Đọc theo mẫu dần giúp tôi cảm nhận được chỗ ngắt nghỉ và lên, xuống giọng.",
  },
  {
    mixinId: 39440639,
    avatar: "/portal-static/avatars/39440639.jpg",
    name: "Zhu Guoqing",
    hint: "Luyện tập tập trung",
    text: "Ứng dụng giúp tôi giải quyết vấn đề phát âm, giống một người hướng dẫn riêng luôn sẵn sàng sửa lỗi. Nhiều thói quen phát âm cũ đã được sửa, giúp phát âm tiếng Anh của tôi tiến bộ rất nhiều so với trước.",
  },
  {
    mixinId: 40303463,
    avatar: "/portal-static/images/avatar.png",
    name: "Dongxinmu",
    hint: "Luyện tập tập trung",
    text: "Tôi đọc lưu loát hơn và diễn đạt tự nhiên hơn.",
  },
  {
    avatar: "/portal-static/images/avatar.png",
    name: "Người dùng ẩn danh",
    hint: "-",
    text: "Về tiếng Anh, tôi phát âm tốt hơn, đồng thời học thuộc nhanh và hiệu quả hơn. Về việc học, tôi đã hình thành được thói quen nhất định và cũng buộc mình phải liên tục vận dụng điều đã học.",
  },
  {
    avatar: "/portal-static/images/avatar.png",
    name: "Người dùng ẩn danh",
    hint: "-",
    text: "Sau những ngày đọc theo mẫu, tôi không còn sợ học tiếng Anh nữa, cứ như không có câu nào mình không đọc được. Có phần mềm này, kế hoạch học tiếng Anh của tôi cũng được đẩy nhanh.",
  },
  {
    avatar: "/portal-static/images/avatar.png",
    name: "Người dùng ẩn danh",
    hint: "-",
    text: "Sửa phát âm, thuận tiện luyện đọc theo mẫu và hiểu cách nhấn mạnh, điều chỉnh nhịp độ khi đọc.",
  },
  {
    avatar: "/portal-static/images/avatar.png",
    name: "Người dùng ẩn danh",
    hint: "-",
    text: "Tôi đã sửa được nhiều âm trước kia đọc sai hoặc nhầm lẫn. Dịch rất nhanh, lại có âm thanh để luyện đọc theo nên thật tiện! Tôi học được nhiều cách diễn đạt chưa từng nghĩ tới cùng nhiều từ mới. Ghi lại quá trình luyện tập cũng khiến tôi thấy mình làm được điều gì đó. Tôi không còn băn khoăn học tiếng Anh có ích gì nữa: cứ luyện tập, riêng quá trình đó đã đủ hữu ích rồi!",
  },
  {
    avatar: "/portal-static/images/avatar.png",
    name: "Người dùng ẩn danh",
    hint: "-",
    text: "Tự động tạo phiên âm và luyện đọc từng câu khiến việc luyện tập rất thuận tiện. Phím tắt cũng dễ dùng, khả năng nói của tôi đã tiến bộ đáng kể.",
  },
]);

const infos = ref<UserStatsEntry[]>([]);

const comments = computed(() => {
  return items.value.map((item) => {
    const stats = infos.value.find((info) => info.mixinId === item.mixinId)?.stats;

    if (!stats) return item;

    return {
      ...item,
      ...(stats.name ? { name: stats.name } : {}),
      ...(stats.avatarUrl ? { avatar: stats.avatarUrl } : {}),
      ...(stats.recordingsDuration !== undefined
        ? {
            hint: `Luyện tập tập trung ${(stats.recordingsDuration / 1000 / 60 / 60).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} giờ`,
          }
        : {}),
    };
  });
});

onMounted(async () => {
  await requestUserInfo();
});

async function requestUserInfo() {
  const mixinIds = items.value
    .map((item) => item.mixinId)
    .filter((mixinId): mixinId is number => Number.isInteger(mixinId));

  const results = await Promise.all(
    mixinIds.map(async (mixinId) => {
      try {
        const stats = parseUserStats(
          await request(`https://enjoy.bot/api/users/${mixinId}/stats`)
        );

        return stats ? { mixinId, stats } : null;
      } catch (error) {
        console.warn("comment stats request failed", error);
        return null;
      }
    })
  );

  infos.value = results.filter(
    (result): result is UserStatsEntry => result !== null
  );
}
</script>
<style lang="scss" scoped>
.comments {
  background: linear-gradient(180deg, #e6f0f9 0%, #fff 100%);
  background-repeat: no-repeat;
  background-size: cover;

  > .container .top {
    .title {
      font-weight: 600;
      color: #3e5c77;
    }

    .hint {
      font-family: "New York";
      font-style: italic;
      font-weight: 400;
      opacity: 0.5;
      color: #3e5c77;
    }
  }

  .items-container {
    overflow: hidden;
    padding: 0 24px;
  }

  .items {
    display: flex;
    flex-wrap: nowrap;
    gap: 16px;
    animation: scroll 90s linear infinite;

    &:hover {
      animation-play-state: paused;
    }

    .item {
      padding: 24px;
      border-radius: 4px;
      background: #fff;
      flex: 0 0 340px;
      position: relative;

      .quote {
        position: absolute;
        right: 24px;
        top: 32px;
        width: 24px;
      }

      .top {
        display: flex;
        align-items: center;

        .name {
          font-size: 16px;
          font-weight: 500;
        }

        .hint {
          font-size: 12px;
          font-weight: 400;
          opacity: 0.6;
          margin-top: 6px;
        }
      }

      .content {
        margin-top: 30px;
        font-weight: 400;
        line-height: 150%;
      }
    }
  }
}

@keyframes scroll {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(-6309px);
  }
}
</style>
