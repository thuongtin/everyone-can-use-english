import { useTheme } from "@renderer/context";
import { t } from "i18next";
import { SettingGroup } from "./settings-primitives";
import { PreviewTile } from "./preview-tile";

type ThemeValue = "light" | "dark" | "system";

type Palette = {
  bg: string;
  side: string;
  surface: string;
  line: string;
  ink: string;
  accent: string;
};

const LIGHT: Palette = {
  bg: "#F5F3EE",
  side: "#ECE9E2",
  surface: "#FFFFFF",
  line: "#E3DFD6",
  ink: "#1C1B18",
  accent: "#2D6BE0",
};

const DARK: Palette = {
  bg: "#141619",
  side: "#0F1114",
  surface: "#1C1F24",
  line: "#2A2E35",
  ink: "#ECEAE3",
  accent: "#6C9DF2",
};

/** One frozen snapshot of a palette, drawn as a tiny fake window. */
const MiniUi = (props: { palette: Palette; clipPath?: string }) => {
  const { palette: p, clipPath } = props;

  return (
    <div
      className="absolute inset-0"
      style={{ background: p.bg, clipPath }}
      aria-hidden
    >
      <div
        className="absolute bottom-0 left-0 top-0"
        style={{
          width: "27%",
          background: p.side,
          borderRight: `1px solid ${p.line}`,
        }}
      />
      <div
        className="absolute rounded-sm"
        style={{
          left: "6%",
          top: "16%",
          width: "13%",
          height: 6,
          background: p.ink,
          opacity: 0.6,
        }}
      />
      <div
        className="absolute rounded-sm"
        style={{
          left: "6%",
          top: "36%",
          width: "12%",
          height: 5,
          background: p.ink,
          opacity: 0.25,
        }}
      />
      <div
        className="absolute rounded-sm"
        style={{
          left: "6%",
          top: "52%",
          width: "12%",
          height: 5,
          background: p.ink,
          opacity: 0.25,
        }}
      />

      <div
        className="absolute"
        style={{
          left: "35%",
          right: "8%",
          top: "14%",
          height: "34%",
          borderRadius: 5,
          background: p.surface,
          border: `1px solid ${p.line}`,
        }}
      />
      <div
        className="absolute rounded-sm"
        style={{
          left: "35%",
          top: "58%",
          width: "28%",
          height: 6,
          background: p.ink,
          opacity: 0.55,
        }}
      />
      <div
        className="absolute rounded-sm"
        style={{
          left: "35%",
          right: "8%",
          top: "72%",
          height: 5,
          background: p.ink,
          opacity: 0.2,
        }}
      />
      <div
        className="absolute rounded-sm"
        style={{
          left: "72%",
          right: "8%",
          top: "84%",
          height: 6,
          background: p.accent,
        }}
      />
    </div>
  );
};

export const ThemeSettings = () => {
  const { setTheme, theme } = useTheme();

  const options: {
    value: ThemeValue;
    label: string;
    description?: string;
    preview: React.ReactNode;
  }[] = [
    { value: "light", label: t("light"), preview: <MiniUi palette={LIGHT} /> },
    { value: "dark", label: t("dark"), preview: <MiniUi palette={DARK} /> },
    {
      value: "system",
      label: t("system"),
      description: t("settings.theme.system.desc"),
      preview: (
        <>
          <MiniUi palette={LIGHT} clipPath="inset(0 50% 0 0)" />
          <MiniUi palette={DARK} clipPath="inset(0 0 0 50%)" />
        </>
      ),
    },
  ];

  return (
    <SettingGroup title={t("settings.themeMode")}>
      <div className="flex gap-3">
        {options.map((option) => (
          <PreviewTile
            key={option.value}
            selected={theme === option.value}
            label={option.label}
            description={option.description}
            onSelect={() => setTheme(option.value)}
          >
            {option.preview}
          </PreviewTile>
        ))}
      </div>
    </SettingGroup>
  );
};
