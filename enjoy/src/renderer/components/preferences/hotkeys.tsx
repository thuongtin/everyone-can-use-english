import { t } from "i18next";
import { useContext, useEffect, useState } from "react";
import { HotKeysSettingsProviderContext, Hotkey } from "@renderer/context";
import { toast } from "@renderer/components/ui";
import { cn } from "@renderer/lib/utils";
import { Undo2Icon } from "lucide-react";
import { SettingButton, SettingGroup } from "./settings-primitives";

const MODIFIERS = ["meta", "control", "ctrl", "alt", "shift", "command", "cmd"];

const KEY_LABELS: Record<string, string> = {
  meta: "⌘",
  command: "⌘",
  cmd: "⌘",
  control: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  space: "Space",
  comma: ",",
};

type HotkeyRow = {
  keyName: Hotkey;
  label: string;
  description: string;
  readOnly?: boolean;
};

type HotkeyGroup = {
  label: string;
  rows: HotkeyRow[];
};

const groups = (): HotkeyGroup[] => [
  {
    label: t("system"),
    rows: [
      {
        keyName: "QuitApp",
        label: t("quitApp"),
        description: t("hotkeyDescriptions.quitApp"),
        readOnly: true,
      },
      {
        keyName: "OpenPreferences",
        label: t("openPreferences"),
        description: t("hotkeyDescriptions.openPreferences"),
      },
      {
        keyName: "OpenCopilot",
        label: t("openCopilot"),
        description: t("hotkeyDescriptions.openCopilot"),
      },
    ],
  },
  {
    label: t("player"),
    rows: [
      {
        keyName: "PlayOrPause",
        label: t("playOrPause"),
        description: t("hotkeyDescriptions.playOrPause"),
      },
      {
        keyName: "StartOrStopRecording",
        label: t("startOrStopRecording"),
        description: t("hotkeyDescriptions.startOrStopRecording"),
      },
      {
        keyName: "PlayOrPauseRecording",
        label: t("playOrPauseRecording"),
        description: t("hotkeyDescriptions.playOrPauseRecording"),
      },
      {
        keyName: "PlayPreviousSegment",
        label: t("playPreviousSegment"),
        description: t("hotkeyDescriptions.playPreviousSegment"),
      },
      {
        keyName: "PlayNextSegment",
        label: t("playNextSegment"),
        description: t("hotkeyDescriptions.playNextSegment"),
      },
      {
        keyName: "PronunciationAssessment",
        label: t("pronunciationAssessment"),
        description: t("hotkeyDescriptions.pronunciationAssessment"),
      },
      {
        keyName: "IncreasePlaybackRate",
        label: t("increasePlaybackRate"),
        description: t("hotkeyDescriptions.increasePlaybackRate"),
      },
      {
        keyName: "DecreasePlaybackRate",
        label: t("decreasePlaybackRate"),
        description: t("hotkeyDescriptions.decreasePlaybackRate"),
      },
      {
        keyName: "Compare",
        label: t("compare"),
        description: t("hotkeyDescriptions.compare"),
      },
    ],
  },
];

const labelFor = (key: string) =>
  KEY_LABELS[key.toLowerCase()] ??
  (key.length === 1 ? key.toUpperCase() : key);

export const Hotkeys = () => {
  const {
    currentHotkeys,
    recordingHotkeys,
    changeHotkey,
    startRecordingHotkeys,
    stopRecordingHotkeys,
    resetHotkeys,
  } = useContext(HotKeysSettingsProviderContext);
  const [editing, setEditing] = useState<Hotkey | null>(null);

  const recorded: string[] = recordingHotkeys ? [...recordingHotkeys] : [];

  // The recorded set is complete once it holds a non-modifier key, so commit
  // right there instead of asking for an extra confirmation click.
  useEffect(() => {
    if (!editing) return;
    if (!recorded.some((key) => !MODIFIERS.includes(key.toLowerCase()))) return;

    const keyName = editing;
    setEditing(null);

    Promise.resolve(changeHotkey?.(keyName, new Set(recorded)))
      .then((result: any) => {
        stopRecordingHotkeys?.();
        if (result?.error === "conflict") {
          toast.error(
            t("customizeShortcutsConflictToast", {
              input: result.input,
              otherHotkeyName: (result.data as string[])
                .map((name) => t(name.charAt(0).toLowerCase() + name.slice(1)))
                .join(", "),
            })
          );
        } else if (result?.error === "invalid") {
          toast.error(t("customizeShortcutsInvalidToast"));
        } else {
          toast.success(t("customizeShortcutsUpdated"));
        }
      })
      .catch(() => stopRecordingHotkeys?.());
  }, [recorded.join("+"), editing]);

  useEffect(() => () => stopRecordingHotkeys?.(), []);

  const startEditing = (keyName: Hotkey) => {
    setEditing(keyName);
    startRecordingHotkeys?.();
  };

  const handleReset = () => {
    Promise.resolve(resetHotkeys?.())
      .then(() => toast.success(t("customizeShortcutsUpdated")))
      .catch((err) => toast.error(err.message));
  };

  return (
    <>
      <div className="mt-5 flex items-center gap-3 rounded-ej border border-ej-line bg-ej-surface2/50 px-3.5 py-2.5">
        <span className="text-xs leading-[1.5] text-ej-ink2">
          {t("settings.hotkeyHint")}
        </span>
        <SettingButton className="ml-auto" onClick={handleReset}>
          <Undo2Icon className="size-3" />
          {t("settings.restoreDefaults")}
        </SettingButton>
      </div>

      {groups().map((group) => (
        <SettingGroup key={group.label} title={group.label}>
          <div className="overflow-hidden rounded-ej border border-ej-line bg-ej-surface">
            {group.rows.map((row, index) => {
              const isEditing = editing === row.keyName;
              const keys = (currentHotkeys[row.keyName] || "").split("+");

              return (
                <div
                  key={row.keyName}
                  title={row.readOnly ? t("settings.systemKey") : undefined}
                  className={cn(
                    "flex items-center justify-between gap-4 px-3.5 py-2.5",
                    index > 0 && "border-t border-ej-line",
                    isEditing && "bg-ej-accent-soft",
                    row.readOnly && "cursor-not-allowed opacity-55"
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ej-ink">
                      {row.label}
                    </div>
                    <div className="truncate text-[11.5px] text-ej-muted">
                      {row.description}
                    </div>
                  </div>

                  {isEditing ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        stopRecordingHotkeys?.();
                      }}
                      className="h-7 shrink-0 animate-softpulse rounded-lg border border-ej-accent px-3 text-xs font-semibold text-ej-accent-ink"
                    >
                      {recorded.length
                        ? recorded.map(labelFor).join(" ")
                        : t("customizeShortcutsRecording")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={row.readOnly}
                      onClick={() => startEditing(row.keyName)}
                      className={cn(
                        "flex shrink-0 items-center gap-1",
                        row.readOnly ? "cursor-not-allowed" : "cursor-pointer"
                      )}
                    >
                      {keys.map((key, keyIndex) => (
                        <kbd
                          key={`${key}-${keyIndex}`}
                          className={cn(
                            "h-7 min-w-[28px] rounded-lg border border-b-2 border-ej-line bg-ej-surface2 px-2",
                            "flex items-center justify-center text-xs font-semibold text-ej-ink2",
                            !row.readOnly && "hover:border-ej-line2"
                          )}
                        >
                          {labelFor(key)}
                        </kbd>
                      ))}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </SettingGroup>
      ))}
    </>
  );
};
