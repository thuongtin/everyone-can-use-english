import { t } from "i18next";
import { useContext, useEffect, useRef, useState } from "react";
import { MicIcon } from "lucide-react";
import { toast } from "@renderer/components/ui";
import { AppSettingsProviderContext } from "@renderer/context";
import { cn } from "@renderer/lib/utils";
import {
  SettingButton,
  SettingCard,
  SettingDisclosure,
  SettingGroup,
  SettingInput,
  SettingOption,
  SettingRow,
  SettingSelect,
  SettingSwitch,
} from "./settings-primitives";

/** Bars of the level meter, matching the handoff. */
const BAR_COUNT = 14;
/** The test is a quick sanity check, not a recording session. */
const TEST_DURATION = 5000;

const LevelMeter = (props: { testing: boolean; levels: number[] }) => (
  <div className="flex h-[22px] flex-1 items-end gap-[3px]">
    {Array.from({ length: BAR_COUNT }).map((_, index) => (
      <div
        key={index}
        className={cn(
          "flex-1 origin-bottom rounded-[2px] transition-transform duration-75",
          props.testing ? "bg-ej-accent" : "bg-ej-line2"
        )}
        style={{
          height: "100%",
          transform: `scaleY(${
            props.testing
              ? Math.max(0.08, props.levels[index] ?? 0)
              : index % 2
                ? 0.5
                : 0.2
          })`,
        }}
      />
    ))}
  </div>
);

/**
 * Which microphone the app records with, plus a live meter so the user can tell
 * a dead input from a quiet one before they record a whole sentence.
 */
export const RecorderSettings = () => {
  const { recorderConfig, setRecorderConfig } = useContext(
    AppSettingsProviderContext
  );
  const [devices, setDevices] = useState<SettingOption[]>([]);
  const [testing, setTesting] = useState<boolean>(false);
  const [levels, setLevels] = useState<number[]>([]);

  const streamRef = useRef<MediaStream>();
  const contextRef = useRef<AudioContext>();
  const frameRef = useRef<number>();
  const stopTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) =>
        setDevices([
          { value: "", label: t("settings.defaultInputDevice") },
          ...list
            .filter((device) => device.kind === "audioinput" && device.deviceId)
            .map((device) => ({
              value: device.deviceId,
              label: device.label || device.deviceId,
            })),
        ])
      )
      .catch(() => setDevices([]));
  }, []);

  const stopTest = () => {
    clearTimeout(stopTimer.current);
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    contextRef.current?.close();
    streamRef.current = undefined;
    contextRef.current = undefined;
    setLevels([]);
    setTesting(false);
  };

  useEffect(() => stopTest, []);

  const startTest = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: recorderConfig?.deviceId
          ? { deviceId: { exact: recorderConfig.deviceId } }
          : true,
      });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      context.createMediaStreamSource(stream).connect(analyser);

      streamRef.current = stream;
      contextRef.current = context;
      setTesting(true);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        setLevels(
          Array.from({ length: BAR_COUNT }, (_, index) =>
            Math.min(1, (data[index] ?? 0) / 180)
          )
        );
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();

      stopTimer.current = setTimeout(stopTest, TEST_DURATION);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      stopTest();
    }
  };

  const save = (config: Partial<RecorderConfigType>) => {
    setRecorderConfig({ ...recorderConfig, ...config }).then(() =>
      toast.success(t("recorderConfigSaved"))
    );
  };

  return (
    <SettingGroup title={t("settings.recording")}>
      <SettingCard>
        <SettingRow label={t("settings.inputDevice")}>
          <SettingSelect
            value={recorderConfig?.deviceId || ""}
            options={
              devices.length
                ? devices
                : [{ value: "", label: t("settings.defaultInputDevice") }]
            }
            onChange={(deviceId) => save({ deviceId })}
          />
        </SettingRow>
      </SettingCard>

      <div className="mt-2 flex items-center gap-3 rounded-ej border border-ej-line px-3.5 py-3">
        <MicIcon
          className={cn(
            "size-4 shrink-0",
            testing ? "text-ej-accent" : "text-ej-muted"
          )}
        />
        <LevelMeter testing={testing} levels={levels} />
        <span className="shrink-0 text-[11.5px] text-ej-muted">
          {testing ? t("settings.listening") : t("settings.inputLevel")}
        </span>
        <SettingButton onClick={testing ? stopTest : startTest}>
          {testing ? t("settings.stopTest") : t("settings.testMic")}
        </SettingButton>
      </div>

      <div className="mt-2">
        <SettingDisclosure
          label={t("recorderConfig")}
          description={t("recorderConfigDescription")}
        >
          <div className="flex flex-col gap-3">
            {(
              [
                "autoGainControl",
                "echoCancellation",
                "noiseSuppression",
              ] as const
            ).map((key) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <span className="text-[12.5px] text-ej-ink2">{key}</span>
                <SettingSwitch
                  aria-label={key}
                  checked={Boolean(recorderConfig?.[key])}
                  onCheckedChange={(checked) => save({ [key]: checked })}
                />
              </div>
            ))}

            {(["sampleRate", "sampleSize"] as const).map((key) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <span className="text-[12.5px] text-ej-ink2">{key}</span>
                <SettingInput
                  type="number"
                  defaultValue={recorderConfig?.[key]}
                  className="min-w-[140px]"
                  onBlur={(event) => {
                    const value = Number(event.target.value);
                    if (!value || value === recorderConfig?.[key]) return;
                    save({ [key]: value });
                  }}
                />
              </div>
            ))}
          </div>
        </SettingDisclosure>
      </div>
    </SettingGroup>
  );
};
