import type { Plugin } from "vite";

// These labels are not configurable in the installed VitePress default theme.
const replacements: Record<string, [string, string]> = {
  "VPSidebar.vue": ["Sidebar Navigation", "Điều hướng mục lục"],
  "VPNavBarMenu.vue": ["Main Navigation", "Điều hướng chính"],
  "VPDocFooter.vue": ["Pager", "Điều hướng giữa các trang"],
  "VPNavBarExtra.vue": [
    'label="extra navigation"',
    'label="Tùy chọn điều hướng khác"',
  ],
  "VPNavBarHamburger.vue": [
    'aria-label="mobile navigation"',
    'aria-label="Mở hoặc đóng điều hướng"',
  ],
  "VPSidebarItem.vue": [
    'aria-label="toggle section"',
    'aria-label="Mở hoặc thu gọn mục"',
  ],
};

export function vietnameseThemeLabels(): Plugin {
  return {
    name: "vietnamese-vitepress-theme-labels",
    enforce: "pre",
    transform(source, id) {
      if (!id.includes("/vitepress/dist/client/theme-default/components/")) {
        return;
      }
      const replacement = replacements[id.split("/").at(-1) || ""];
      if (!replacement) return;
      const [original, translated] = replacement;
      if (!source.includes(original)) {
        this.error(`The VitePress label in ${id} changed; review its Vietnamese translation.`);
      }
      return { code: source.replace(original, translated), map: null };
    },
  };
}
