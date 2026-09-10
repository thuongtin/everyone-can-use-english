import { t } from "i18next";
import { useContext, useEffect, useMemo, useState } from "react";
import { LoaderIcon, RefreshCwIcon } from "lucide-react";
import { AppSettingsProviderContext } from "@renderer/context";
import { cn } from "@renderer/lib/utils";
import { SettingButton } from "./settings-primitives";

type ProbeResult = { text: string; tone?: "ok" | "warn" | "bad" };
type ProbeState = Record<string, ProbeResult | "error" | undefined>;

const DOT_CLASS = {
  ok: "bg-ej-ok",
  warn: "bg-ej-warn",
  bad: "bg-ej-bad",
  idle: "bg-ej-line2",
};

const formatTime = (date: Date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;

export const NetworkState = () => {
  const { EnjoyApp, proxy } = useContext(AppSettingsProviderContext);
  const [states, setStates] = useState<ProbeState>({});
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [checkedAt, setCheckedAt] = useState<Date>();

  const probes = useMemo(
    () => [
      {
        key: "connection",
        label: "Kết nối thiết bị",
        run: async (): Promise<ProbeResult> => ({
          text: navigator.onLine ? "Có kết nối" : "Offline",
          tone: navigator.onLine ? "ok" : "warn",
        }),
      },
      {
        key: "platform",
        label: t("settings.platform"),
        run: async (): Promise<ProbeResult> => {
          const info = await EnjoyApp.app.getPlatformInfo();
          return { text: `${info.platform} ${info.version} · ${info.arch}` };
        },
      },
    ],
    [EnjoyApp]
  );

  const refresh = async () => {
    setRefreshing(true);

    await Promise.all(
      probes.map(async (probe) => {
        try {
          const result = await probe.run();
          setStates((prev) => ({ ...prev, [probe.key]: result }));
        } catch {
          setStates((prev) => ({ ...prev, [probe.key]: "error" }));
        }
      })
    );

    setCheckedAt(new Date());
    setRefreshing(false);
  };

  useEffect(() => {
    void refresh();
  }, [proxy]);

  return (
    <div className="mt-2 rounded-ej border border-ej-line bg-ej-surface2/40 px-3.5 py-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {probes.map((probe) => {
          const state = states[probe.key];
          const tone =
            state === "error"
              ? "bad"
              : typeof state === "object"
                ? state.tone || "idle"
                : "idle";

          return (
            <div key={probe.key} className="flex items-center gap-2">
              <span
                className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[tone])}
              />
              <span className="shrink-0 text-[11px] text-ej-muted">
                {probe.label}
              </span>
              <span className="ml-auto min-w-0 truncate text-[12.5px] font-semibold text-ej-ink ej-tabular">
                {state === undefined ? (
                  <LoaderIcon className="size-3.5 animate-spin text-ej-muted" />
                ) : state === "error" ? (
                  <span className="text-ej-bad">{t("connectError")}</span>
                ) : (
                  state.text
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-ej-line pt-2.5">
        <span className="text-[11px] text-ej-muted">
          {checkedAt ? t("settings.checkedAt", { time: formatTime(checkedAt) }) : ""}
        </span>
        <SettingButton disabled={refreshing} onClick={refresh}>
          <RefreshCwIcon className={cn("size-3", refreshing && "animate-spin")} />
          {t("settings.recheck")}
        </SettingButton>
      </div>
    </div>
  );
};
