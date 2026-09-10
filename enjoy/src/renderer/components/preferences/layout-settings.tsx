import { t } from "i18next";
import { useContext } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { LayoutPref, LayoutProviderContext } from "@renderer/context";
import { SettingGroup } from "./settings-primitives";
import { PreviewTile } from "./preview-tile";

/** Three bars standing in for the content of a column. */
const ColumnBars = () => (
  <>
    <div className="absolute left-1.5 right-1.5 top-2 h-1.5 rounded-sm bg-ej-ink/40" />
    <div className="absolute left-1.5 right-3 top-5 h-1 rounded-sm bg-ej-ink/20" />
    <div className="absolute left-1.5 right-5 top-8 h-1 rounded-sm bg-ej-ink/20" />
  </>
);

const MiniLayout = (props: {
  column: { left: string; right: string };
  dashed?: boolean;
  sidePanel?: boolean;
}) => (
  <div className="absolute inset-0 bg-ej-bg" aria-hidden>
    <div className="absolute bottom-0 left-0 top-0 w-[22%] border-r border-ej-line bg-ej-side">
      <div className="absolute left-1.5 top-3 h-1.5 w-[60%] rounded-sm bg-ej-ink/40" />
      <div className="absolute left-1.5 top-7 h-1 w-[50%] rounded-sm bg-ej-ink/20" />
    </div>

    <div
      className={`absolute bottom-2 top-2 rounded-[5px] border bg-ej-surface ${
        props.dashed ? "border-dashed border-ej-line2" : "border-ej-line2"
      }`}
      style={{ left: props.column.left, right: props.column.right }}
    >
      <ColumnBars />
    </div>

    {props.sidePanel && (
      <div className="absolute bottom-2 right-[5%] top-2 w-[22%] rounded-[5px] border border-ej-line2 bg-ej-surface">
        <div className="absolute left-1.5 right-1.5 top-2 h-1.5 rounded-sm bg-ej-accent" />
      </div>
    )}
  </div>
);

/**
 * Fixed keeps the content centred with secondary panels as tabs, fluid
 * spreads them out side by side. Auto switches on wide windows.
 */
export const LayoutSettings = () => {
  const { layoutPref, setLayoutPref, fluidPending } = useContext(
    LayoutProviderContext
  );

  const options: {
    value: LayoutPref;
    label: string;
    description: string;
    preview: React.ReactNode;
  }[] = [
    {
      value: "auto",
      label: t("layoutMode.auto"),
      description: t("settings.layout.auto.desc"),
      preview: (
        <MiniLayout column={{ left: "34%", right: "14%" }} dashed />
      ),
    },
    {
      value: "fixed",
      label: t("layoutMode.fixed"),
      description: t("settings.layout.fixed.desc"),
      preview: <MiniLayout column={{ left: "34%", right: "14%" }} />,
    },
    {
      value: "fluid",
      label: t("layoutMode.fluid"),
      description: t("settings.layout.fluid.desc"),
      preview: <MiniLayout column={{ left: "28%", right: "32%" }} sidePanel />,
    },
  ];

  return (
    <SettingGroup title={t("settings.layout.label")}>
      <div className="flex gap-3">
        {options.map((option) => (
          <PreviewTile
            key={option.value}
            selected={layoutPref === option.value}
            label={option.label}
            description={option.description}
            onSelect={() => setLayoutPref(option.value)}
          >
            {option.preview}
          </PreviewTile>
        ))}
      </div>

      {fluidPending && (
        <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-ej-warn">
          <AlertTriangleIcon className="size-3.5 shrink-0" />
          {t("layoutMode.fluidPendingHint")}
        </div>
      )}
    </SettingGroup>
  );
};
