import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
import footnote from "markdown-it-footnote";
import sup from "markdown-it-sup";
import sub from "markdown-it-sub";
import mark from "markdown-it-mark";
import ins from "markdown-it-ins";
import carousel from "./lib/markdown-it-carousel";
import { vietnameseThemeLabels } from "./lib/vietnamese-theme-labels";

// import markdownit from 'markdown-it'

export default withMermaid(
  // https://vitepress.dev/reference/site-config
  defineConfig({
    title: "1000 giờ",
    lang: "vi-VN",
    description: "Dành 1000 giờ tập trung rèn luyện kỹ năng bạn cần. Học tiếng Anh với hướng dẫn bằng tiếng Việt.",
    head: [
      [
        "script",
        {
          async: "",
          src: "https://www.googletagmanager.com/gtag/js?id=G-Z2QZPX3T9W",
        },
      ],
      [
        "script",
        {},
        `window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'G-Z2QZPX3T9W');`,
      ],
      ["link", { rel: "icon", href: "/images/clock.svg" }],
    ],
    themeConfig: {
      // https://vitepress.dev/reference/default-theme-config
      nav: [
        { text: "Trang chủ", link: "/" },
        { text: "Hướng dẫn Enjoy", link: "/enjoy-app/" },
      ],

      search: {
        provider: "local",
        options: {
          locales: {
            root: {
              translations: {
                button: { buttonText: "Tìm kiếm", buttonAriaLabel: "Tìm kiếm tài liệu" },
                modal: {
                  displayDetails: "Hiện chi tiết",
                  resetButtonTitle: "Xóa nội dung tìm kiếm",
                  backButtonTitle: "Đóng tìm kiếm",
                  noResultsText: "Không tìm thấy kết quả cho",
                  footer: {
                    selectText: "chọn",
                    selectKeyAriaLabel: "phím Enter",
                    navigateText: "di chuyển",
                    navigateUpKeyAriaLabel: "mũi tên lên",
                    navigateDownKeyAriaLabel: "mũi tên xuống",
                    closeText: "đóng",
                    closeKeyAriaLabel: "phím Escape",
                  },
                },
              },
            },
          },
        },
      },
      outline: { label: "Trên trang này" },
      docFooter: { prev: "Trang trước", next: "Trang tiếp theo" },
      lastUpdated: { text: "Cập nhật lần cuối" },
      darkModeSwitchLabel: "Giao diện",
      lightModeSwitchTitle: "Chuyển sang giao diện sáng",
      darkModeSwitchTitle: "Chuyển sang giao diện tối",
      sidebarMenuLabel: "Mục lục",
      returnToTopLabel: "Về đầu trang",
      skipToContentLabel: "Đến nội dung chính",

      sidebar: {
        "/": [
          {
            text: "Hướng dẫn Enjoy",
            link: "/enjoy-app/",
            collapsed: true,
            items: [
              { text: "Cài đặt ứng dụng", link: "/enjoy-app/install" },
              { text: "Cấu hình", link: "/enjoy-app/settings" },
              { text: "Luyện với âm thanh", link: "/enjoy-app/audios" },
              { text: "Luyện với video", link: "/enjoy-app/videos" },
              {
                text: "Đọc tài liệu",
                link: "/enjoy-app/document",
                items: [
                  { text: "Sách và tệp trên máy", link: "/enjoy-app/document-ebook" },
                  { text: "Bài viết trực tuyến", link: "/enjoy-app/document-webpage" },
                ],
              },
              {
                text: "Trò chuyện với AI",
                link: "/enjoy-app/chat",
                items: [
                  { text: "Tạo và dùng trợ lý", link: "/enjoy-app/chat-with-agent" },
                  { text: "Trò chuyện nhóm", link: "/enjoy-app/chat-group" },
                  { text: "Copilot", link: "/enjoy-app/chat-copilot" },
                ],
              },
              {
                text: "Trợ lý kiểu cũ",
                link: "/enjoy-app/ai-assistant",
                collapsed: true,
                items: [
                  { text: "GPT", link: "/enjoy-app/gpt-conversation" },
                  { text: "Chuyển văn bản thành giọng nói", link: "/enjoy-app/tts-conversation" },
                ],
              },
              { text: "Tạo tài liệu luyện tập bằng AI", link: "/enjoy-app/use-case-generate-audio-resources" },
              { text: "Câu hỏi thường gặp", link: "/enjoy-app/faq" },
              { text: "Lịch sử phiên bản", link: "/enjoy-app/changelog" },
            ],
          },
          {
            text: "Giới thiệu ngắn",
            collapsed: true,
            link: "/intro",
            items: [
              { text: "1. Có nên rèn luyện não bộ?", link: "/why" },
              { text: "2. Điều gì rèn luyện não bộ tốt nhất?", link: "/what" },
            ],
          },
          {
            text: "Nhiệm vụ luyện tập",
            collapsed: true,
            items: [
              { text: "1. Bắt đầu nhiệm vụ", link: "/training-tasks/kick-off" },
              { text: "2. Phương pháp luyện tập", link: "/training-tasks/procedures" },
              {
                text: "3. Trí tuệ nhân tạo",
                collapsed: false,
                link: "/training-tasks/ai",
                items: [
                  {
                    text: "3.1. Năng lực ngôn ngữ cơ bản",
                    link: "/training-tasks/language",
                  },
                  {
                    text: "3.2. Khó khăn của người trưởng thành",
                    link: "/training-tasks/predicaments",
                  },
                  {
                    text: "3.3. Sự hỗ trợ của AI",
                    link: "/training-tasks/revolution",
                  },
                  { text: "3.4. Nhiệm vụ không quá phức tạp", link: "/training-tasks/ground" },
                  { text: "3.5. Hiệu quả đáng ngạc nhiên", link: "/training-tasks/wonder" },
                ],
              },
              { text: "4. Điều bất ngờ", link: "/training-tasks/surprise" },
            ],
          },
          {
            text: "Rèn luyện phát âm",
            link: "/sounds-of-american-english/0-intro",
            collapsed: true,
            items: [
              {
                text: "1. Nền tảng",
                link: "/sounds-of-american-english/1-basics",
                items: [
                  {
                    text: "1.1. Âm vị và ký hiệu phiên âm",
                    link: "/sounds-of-american-english/1.1-phonemes",
                  },
                  {
                    text: "1.2. Bảng chữ cái tiếng Anh",
                    link: "/sounds-of-american-english/1.2-alphabets",
                  },
                ],
              },
              {
                text: "2. Cơ quan phát âm",
                link: "/sounds-of-american-english/2-articulators",
              },
              {
                text: "3. Tìm hiểu từng âm vị",
                collapsed: true,
                link: "/sounds-of-american-english/3-details",
                items: [
                  {
                    text: "3.1. Nguyên âm",
                    collapsed: true,
                    link: "/sounds-of-american-english/3.1-vowels",
                    items: [
                      {
                        text: "3.1.1. ə/ɚ/ɝː",
                        link: "/sounds-of-american-english/3.1.1-ə",
                      },
                      {
                        text: "3.1.2. ʌ/ɑː/ɑːr",
                        link: "/sounds-of-american-english/3.1.2-ɑ",
                      },
                      {
                        text: "3.1.3. ɪ/i/iː/ɪr",
                        link: "/sounds-of-american-english/3.1.3-i",
                      },
                      {
                        text: "3.1.4. ʊ/u/uː/ʊr",
                        link: "/sounds-of-american-english/3.1.4-u",
                      },
                      {
                        text: "3.1.5. e/æ/er",
                        link: "/sounds-of-american-english/3.1.5-e",
                      },
                      {
                        text: "3.1.6. ɒ/ɑː/ɔː/ɔːrː",
                        link: "/sounds-of-american-english/3.1.6-ɔ",
                      },
                      {
                        text: "3.1.7. aɪ... oʊ",
                        link: "/sounds-of-american-english/3.1.7-aɪ",
                      },
                    ],
                  },
                  {
                    text: "3.2. Phụ âm",
                    collapsed: true,
                    link: "/sounds-of-american-english/3.2-consonants",
                    items: [
                      {
                        text: "3.2.1. p/b",
                        link: "/sounds-of-american-english/3.2.1-pb",
                      },
                      {
                        text: "3.2.2. t/d",
                        link: "/sounds-of-american-english/3.2.2-td",
                      },
                      {
                        text: "3.2.3. k/g",
                        link: "/sounds-of-american-english/3.2.3-kg",
                      },
                      {
                        text: "3.2.4. f/v",
                        link: "/sounds-of-american-english/3.2.4-fv",
                      },
                      {
                        text: "3.2.5. s/z",
                        link: "/sounds-of-american-english/3.2.5-sz",
                      },
                      {
                        text: "3.2.6. θ/ð",
                        link: "/sounds-of-american-english/3.2.6-θð",
                      },
                      {
                        text: "3.2.7. ʃ/ʒ",
                        link: "/sounds-of-american-english/3.2.7-ʃʒ",
                      },
                      {
                        text: "3.2.8. tʃ/dʒ",
                        link: "/sounds-of-american-english/3.2.8-tʃdʒ",
                      },
                      {
                        text: "3.2.9. tr/dr",
                        link: "/sounds-of-american-english/3.2.9-trdr",
                      },
                      {
                        text: "3.2.10. ts/dz",
                        link: "/sounds-of-american-english/3.2.10-tsdz",
                      },
                      {
                        text: "3.2.11. m, n, ŋ",
                        link: "/sounds-of-american-english/3.2.11-mnŋ",
                      },
                      {
                        text: "3.2.12. l, r",
                        link: "/sounds-of-american-english/3.2.12-lr",
                      },
                      {
                        text: "3.2.13. w, j",
                        link: "/sounds-of-american-english/3.2.13-wj",
                      },
                      {
                        text: "3.2.14. h",
                        link: "/sounds-of-american-english/3.2.14-h",
                      },
                    ],
                  },
                  {
                    text: "3.3. Các cách ghi phiên âm khác nhau",
                    link: "/sounds-of-american-english/3.3-variations",
                  },
                ],
              },
              {
                text: "4. Lời nói tự nhiên",
                collapsed: true,
                link: "/sounds-of-american-english/4-natural-speech",
                items: [
                  {
                    text: "4.1. Âm tiết",
                    link: "/sounds-of-american-english/4.1-syllables",
                  },
                  {
                    text: "4.2. Từ",
                    link: "/sounds-of-american-english/4.2-words",
                  },
                  {
                    text: "4.3. Cụm ý",
                    link: "/sounds-of-american-english/4.3-grouping",
                  },
                  {
                    text: "4.4. Nối âm",
                    link: "/sounds-of-american-english/4.4-linking",
                  },
                  {
                    text: "4.5. Câu",
                    link: "/sounds-of-american-english/4.5-sentences",
                  },
                ],
              },
              {
                text: "5. Vượt lên trên nền tảng",
                link: "/sounds-of-american-english/5-above-ground",
              },
              {
                text: "6. Xây dựng vốn từ",
                collapsed: true,
                link: "/sounds-of-american-english/6-vocabulary",
                items: [
                  {
                    text: "6.1. Ghi nhớ từ hiệu quả",
                    link: "/sounds-of-american-english/6.1-effectiveness",
                  },
                  {
                    text: "6.2. Một cách viết, nhiều cách đọc",
                    link: "/sounds-of-american-english/6.2-polyphonic-spellings",
                  },
                  {
                    text: "6.3. Các từ ghép thường gặp",
                    link: "/sounds-of-american-english/6.3-compound-words",
                  },
                  {
                    text: "6.4. Gốc từ và phụ tố thường gặp",
                    link: "/sounds-of-american-english/6.4-parts-of-words",
                  },
                ],
              },
              {
                text: "7. Từ đây về sau",
                link: "/sounds-of-american-english/7-whats-next",
              },
              {
                text: "8. Phụ lục",
                collapsed: true,
                link: "/sounds-of-american-english/8-appendix",
                items: [
                  {
                    text: "8.1. Nhập ký hiệu phiên âm và ký hiệu đặc biệt",
                    link: "/sounds-of-american-english/8.1-inputting-phonemes-and-symbols",
                  },
                  {
                    text: "8.2. Lấy phiên âm và âm thanh CEPD",
                    link: "/sounds-of-american-english/8.2-cepd-phonetics-and-sound",
                  },
                  {
                    text: "8.3. Bài tập ký hiệu phiên âm",
                    link: "/sounds-of-american-english/8.3-phoneme-exercises",
                  },
                  {
                    text: "8.4. Tạo bài luyện nói hằng ngày",
                    link: "/sounds-of-american-english/8.4-daily-speech-exercises",
                  },
                ],
              },
            ],
          },
          {
            text: "Bên trong não bộ",
            collapsed: true,
            items: [
              { text: "1. Thế giới lớn trong không gian nhỏ", link: "/in-the-brain/01-inifinite" },
              { text: "2. Tất cả là những kết nối", link: "/in-the-brain/02-links" },
              { text: "3. Mọi việc đều như giờ thể dục", link: "/in-the-brain/03-sports" },
              {
                text: "4. Mọi việc đều như giờ ngôn ngữ",
                link: "/in-the-brain/04-literature",
              },
              { text: "5. Mọi hoạt động đều cần năng lượng", link: "/in-the-brain/05-energy" },
              {
                text: "6. Dùng thì giữ, ít dùng thì suy giảm và tái sử dụng",
                link: "/in-the-brain/06-use-or-lose",
              },
              {
                text: "7. Lặp lại đủ nhiều trong thời gian ngắn",
                link: "/in-the-brain/07-repitition",
              },
              {
                text: "8. Sự cạnh tranh giữa mạng cũ và mạng mới",
                link: "/in-the-brain/08-compitition",
              },
              {
                text: "9. Không chú ý thì như không tồn tại",
                link: "/in-the-brain/09-unnoticed",
              },
              {
                text: "10. Thành thạo là giảm gánh nặng",
                link: "/in-the-brain/10-unloading",
              },
              { text: "11. Bị chú ý là gánh nặng lớn nhất", link: "/in-the-brain/11-burden" },
              {
                text: "12. Hữu hạn, loại trừ và không thể tái tạo",
                link: "/in-the-brain/12-unreproducible",
              },
              {
                text: "13. Tất cả đều là phản ứng hóa học",
                link: "/in-the-brain/13-chemical",
              },
              {
                text: "14. Ngưỡng an toàn quyết định kết quả",
                link: "/in-the-brain/14-threshold",
              },
            ],
          },
          {
            text: "Tự luyện tập",
            collapsed: true,
            link: `/self-training/00-intro`,
            items: [
              { text: "1. Đưa quân vào trận", link: "/self-training/01-fight" },
              { text: "2. Chỉ có thể tự học", link: "/self-training/02-last-resort" },
              {
                text: "3. Kiên trì thử và luyện",
                link: "/self-training/03-trials-and-errors",
              },
              { text: "4. Thoát khỏi mê cung", link: "/self-training/04-maze" },
              { text: "5. Tự sửa sai", link: "/self-training/05-correction" },
              { text: "6. Tự tạo động lực", link: "/self-training/06-motives" },
              { text: "7. Tự khích lệ", link: "/self-training/07-encouraging" },
              { text: "8. Tự giám sát", link: "/self-training/08-supervising" },
              { text: "9. Tự lập kế hoạch", link: "/self-training/09-planning" },
              { text: "10. Trở về điều cốt lõi", link: "/self-training/10-going-back" },
            ],
          },
        ],
      },

      socialLinks: [
        {
          icon: "github",
          link: "https://github.com/zuodaotech/everyone-can-use-english/tree/main/1000-hours",
        },
      ],
    },

    sitemap: {
      hostname: "https://1000h.org",
    },

    lastUpdated: true,

    vite: { plugins: [vietnameseThemeLabels()] },

    markdown: {
      // https://vitepress.dev/reference/markdown
      math: true,
      codeCopyButtonTitle: "Sao chép mã",
      container: {
        infoLabel: "Thông tin",
        noteLabel: "Ghi chú",
        tipLabel: "Gợi ý",
        warningLabel: "Cảnh báo",
        dangerLabel: "Nguy hiểm",
        detailsLabel: "Chi tiết",
        importantLabel: "Quan trọng",
        cautionLabel: "Lưu ý",
      },
      config: (md) => {
        // use more markdown-it plugins!
        md.use(footnote);
        md.use(sub);
        md.use(sup);
        md.use(mark);
        md.use(ins);
        md.use(carousel);
        const alertLabels: Record<string, string> = {
          NOTE: "Ghi chú",
          INFO: "Thông tin",
          TIP: "Gợi ý",
          IMPORTANT: "Quan trọng",
          WARNING: "Cảnh báo",
          CAUTION: "Lưu ý",
          DANGER: "Nguy hiểm",
        };
        md.core.ruler.before("github-alerts", "vietnamese-alert-titles", (state) => {
          for (let index = 0; index < state.tokens.length; index++) {
            const open = state.tokens[index];
            if (open.type !== "blockquote_open") continue;
            for (let next = index + 1; next < state.tokens.length; next++) {
              const token = state.tokens[next];
              if (token.type === "blockquote_close" && token.level === open.level) break;
              if (token.type !== "inline") continue;
              const match = token.content.match(/^\[!(TIP|NOTE|INFO|IMPORTANT|WARNING|CAUTION|DANGER)\]([^\n\r]*)/i);
              if (match && !match[2].trim()) {
                const label = alertLabels[match[1].toUpperCase()];
                token.content = `${match[0].trimEnd()} ${label}${token.content.slice(match[0].length)}`;
              }
              break;
            }
          }
        });
        const renderLinkOpen = md.renderer.rules.link_open;
        md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
          const token = tokens[index];
          if (token.attrGet("class")?.split(" ").includes("header-anchor")) {
            const title = (token.attrGet("aria-label") || "")
              .replace(/^Permalink to "/, "")
              .replace(/"$/, "")
              .replace(/<[^>]*>/g, "")
              .replace(/\s*\{#[^}]+\}/g, "")
              .trim();
            token.attrSet("aria-label", `Liên kết đến mục ${md.utils.unescapeAll(title)}`);
          }
          return renderLinkOpen
            ? renderLinkOpen(tokens, index, options, env, renderer)
            : renderer.renderToken(tokens, index, options);
        };
      },
      toc: {
        level: [1, 2, 3],
      },
    },
  })
);
