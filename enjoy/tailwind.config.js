/** @type {import('tailwindcss').Config} */

const defaultTheme = require("tailwindcss/defaultTheme");
const plugin = require("tailwindcss/plugin");

// Raw design tokens declared in src/index.css. Exposed as `ej-*` color
// utilities so new UI can reference the design language directly, while the
// shadcn primitives keep consuming their own `hsl(var(--token))` names.
//
// Declared as a function so Tailwind opacity modifiers (`bg-ej-surface/40`)
// still resolve: a plain `var(--x)` string cannot be parsed for alpha and
// Tailwind silently drops the whole utility, so we emit color-mix() instead.
const ej =
  (name) =>
  ({ opacityValue, opacityVariable } = {}) => {
    const color = `var(--ej-${name})`;
    if (opacityVariable || opacityValue === undefined) return color;

    const alpha = Number(opacityValue);
    if (!Number.isFinite(alpha)) return color;

    return `color-mix(in srgb, ${color} ${alpha * 100}%, transparent)`;
  };

module.exports = {
  darkMode: ["class"],
  content: ["./src/renderer/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      spacing: {
        titlebar: "var(--ej-titlebar-h)",
        aside: "var(--ej-aside-w)",
      },
      height: {
        content: "calc(100vh - var(--ej-titlebar-h))",
      },
      minHeight: {
        content: "calc(100vh - var(--ej-titlebar-h))",
      },
      maxHeight: {
        content: "calc(100vh - var(--ej-titlebar-h))",
      },
      maxWidth: {
        content: "var(--ej-content-max)",
      },
      fontSize: {
        xxs: "0.625rem",
        xxxs: "0.5rem",
      },
      fontFamily: {
        sans: ["Be Vietnam Pro", "Noto Sans", ...defaultTheme.fontFamily.sans],
        // English reading content: articles, transcripts, lesson bodies.
        literata: ["Literata", ...defaultTheme.fontFamily.serif],
        // Existing font-code utilities display IPA, not source code.
        code: ["CharisSIL", "Noto Sans", ...defaultTheme.fontFamily.sans],
        ipa: ["CharisSIL", "Noto Sans", ...defaultTheme.fontFamily.sans],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        "active-word": "hsl(var(--active-word))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        ej: {
          bg: ej("bg"),
          surface: ej("surface"),
          surface2: ej("surface2"),
          side: ej("side"),
          ink: ej("ink"),
          ink2: ej("ink2"),
          muted: ej("muted"),
          line: ej("line"),
          line2: ej("line2"),
          accent: ej("accent"),
          "accent-ink": ej("accent-ink"),
          "accent-soft": ej("accent-soft"),
          "accent-soft2": ej("accent-soft2"),
          hl: ej("hl"),
          "hl-ink": ej("hl-ink"),
          ok: ej("ok"),
          "ok-soft": ej("ok-soft"),
          warn: ej("warn"),
          "warn-soft": ej("warn-soft"),
          bad: ej("bad"),
          "bad-soft": ej("bad-soft"),
          wave: ej("wave"),
          "wave-on": ej("wave-on"),
          pitch: ej("pitch"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        ej: "12px",
        "ej-lg": "16px",
      },
      boxShadow: {
        ej: "var(--ej-shadow)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
        rise: {
          from: { opacity: 0, transform: "translateY(6px)" },
          to: { opacity: 1, transform: "none" },
        },
        "ej-pulse": {
          "0%, 100%": { transform: "scale(1)", opacity: 1 },
          "50%": { transform: "scale(1.4)", opacity: 0.4 },
        },
        blink: {
          "0%, 100%": { opacity: 0.25 },
          "50%": { opacity: 1 },
        },
        bars: {
          "0%, 100%": { transform: "scaleY(.35)" },
          "50%": { transform: "scaleY(1)" },
        },
        "flip-in": {
          from: { opacity: 0, transform: "rotateX(-90deg)" },
          to: { opacity: 1, transform: "none" },
        },
        softpulse: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.55 },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        rise: "rise 0.18s ease-out both",
        "ej-pulse": "ej-pulse 1.2s ease-in-out infinite",
        blink: "blink 1s ease-in-out infinite",
        bars: "bars 0.7s ease-in-out infinite",
        "flip-in": "flip-in 0.28s ease-out both",
        softpulse: "softpulse 1.2s ease-in-out infinite",
      },
      transitionDuration: {
        ej: "140ms",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
    require("tailwind-scrollbar"),
    require("tailwind-scrollbar-hide"),
    require("@vidstack/react/tailwind.cjs"),
    // Layout-mode variants. `data-fluid` lives on <html> and is toggled by the
    // layout preference (auto switches at >= 1440px).
    plugin(({ addVariant }) => {
      addVariant("fluid", ':where(html[data-fluid="true"]) &');
      addVariant("fixed-layout", ':where(html:not([data-fluid="true"])) &');
    }),
  ],
};
