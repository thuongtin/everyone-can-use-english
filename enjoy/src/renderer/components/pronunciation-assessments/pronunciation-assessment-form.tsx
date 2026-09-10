import {
  Input,
  SelectContent,
  SelectTrigger,
  SelectValue,
  Select,
  SelectItem,
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Textarea,
  toast,
} from "@renderer/components/ui";
import {
  EjButton,
  EjIconButton,
  Pill,
  RecordingDot,
  Segmented,
} from "@renderer/components/enjoy";
import { t } from "i18next";
import { useNavigate } from "react-router-dom";
import { useContext, useEffect, useState } from "react";
import { AppSettingsProviderContext } from "@/renderer/context";
import { LANGUAGES } from "@/constants";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckIcon,
  LoaderIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  UploadIcon,
} from "lucide-react";
import { useEjColor, usePronunciationAssessments } from "@/renderer/hooks";
import { useAudioRecorder } from "react-audio-voice-recorder";
import { LiveAudioVisualizer } from "react-audio-visualize";

const pronunciationAssessmentSchema = z.object({
  file: z.instanceof(FileList).optional(),
  recordingFile: z.instanceof(Blob).optional(),
  language: z.string().min(2),
  referenceText: z.string().optional(),
});

/** Accents offered as a segmented shortcut above the full language list. */
const ACCENTS = [
  { value: "en-US", label: "US" },
  { value: "en-GB", label: "UK" },
];

const FIELD =
  "h-9 rounded-[10px] border-ej-line bg-ej-surface text-xs text-ej-ink focus-visible:ring-ej-accent";

export const PronunciationAssessmentForm = () => {
  const navigate = useNavigate();
  const { EnjoyApp, learningLanguage } = useContext(AppSettingsProviderContext);
  const [submitting, setSubmitting] = useState(false);
  const [source, setSource] = useState<"record" | "upload">("record");
  const { createAssessment, ensureEnjoyAiConfigured } =
    usePronunciationAssessments();

  const form = useForm<z.infer<typeof pronunciationAssessmentSchema>>({
    resolver: zodResolver(pronunciationAssessmentSchema),
    values: {
      language: learningLanguage,
      referenceText: "",
    },
  });

  const fileField = form.register("file");

  const ensureAssessmentReady = async (): Promise<boolean> => {
    try {
      await ensureEnjoyAiConfigured();
      return true;
    } catch (error) {
      toast.error(
        `Bản ghi đã được lưu. ${
          error instanceof Error
            ? error.message
            : "Hãy cấu hình Azure Speech trước khi tạo đánh giá phát âm."
        }`
      );
      return false;
    }
  };

  const onSubmit = async (
    data: z.infer<typeof pronunciationAssessmentSchema>
  ) => {
    if ((!data.file || data.file.length === 0) && !data.recordingFile) {
      toast.error(t("noFileOrRecording"));
      form.setError("recordingFile", { message: t("noFileOrRecording") });
      return;
    }
    const { language, referenceText } = data;

    let recording: RecordingType;
    try {
      recording = await createRecording(data);
    } catch (err) {
      toast.error(err.message);
    }
    if (!recording) return;

    setSubmitting(true);
    if (!(await ensureAssessmentReady())) {
      setSubmitting(false);
      return;
    }
    createAssessment({
      language,
      reference: referenceText,
      recording,
    })
      .then(() => {
        navigate("/pronunciation_assessments");
      })
      .catch((err) => {
        toast.error(err.message);
      })
      .finally(() => setSubmitting(false));
  };

  const createRecording = async (
    data: z.infer<typeof pronunciationAssessmentSchema>
  ): Promise<RecordingType> => {
    const { language, referenceText, file, recordingFile } = data;
    let arrayBuffer: ArrayBuffer;
    if (recordingFile) {
      arrayBuffer = await recordingFile.arrayBuffer();
    } else {
      arrayBuffer = await new Blob([file[0]]).arrayBuffer();
    }

    return EnjoyApp.recordings.create({
      language,
      referenceText,
      blob: {
        type: recordingFile?.type || file[0].type,
        arrayBuffer,
      },
    });
  };

  const uploadedFile = form.watch("file")?.[0];
  const recordedBlob = form.watch("recordingFile");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <section className="rounded-ej-lg border border-ej-line bg-ej-surface p-6 shadow-ej">
          <div className="mb-5 flex items-center justify-between gap-3">
            <span className="ej-label">{t("audioSource")}</span>
            <Segmented<"record" | "upload">
              value={source}
              onChange={setSource}
              options={[
                { value: "record", label: t("record") },
                { value: "upload", label: t("upload") },
              ]}
            />
          </div>

          {source === "record" ? (
            <FormField
              control={form.control}
              name="recordingFile"
              render={({ field }) => (
                <FormItem>
                  <RecorderButton
                    submitting={submitting}
                    onStart={() => {
                      form.resetField("recordingFile");
                      return true;
                    }}
                    onFinish={(blob) => {
                      field.onChange(blob);
                    }}
                  />
                  <FormMessage className="text-center text-xxs text-ej-bad" />
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="file"
              render={() => (
                <FormItem>
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-ej border border-dashed border-ej-line2 bg-ej-surface2 px-6 py-9 text-center transition-colors duration-ej hover:border-ej-accent hover:bg-ej-accent-soft">
                    <UploadIcon className="size-5 text-ej-muted" />
                    <span className="text-xs font-semibold text-ej-ink">
                      {uploadedFile ? uploadedFile.name : t("chooseAudioFile")}
                    </span>
                    <span className="text-xxs text-ej-muted">
                      {t("audioFileHint")}
                    </span>
                    <Input
                      disabled={submitting}
                      type="file"
                      className="hidden"
                      accept="audio/*"
                      {...fileField}
                    />
                  </label>
                  <FormMessage className="text-xxs text-ej-bad" />
                </FormItem>
              )}
            />
          )}

          {source === "record" && recordedBlob && (
            <div className="mt-5 rounded-ej border border-ej-line bg-ej-surface2 p-3.5">
              <div className="ej-label mb-2">{t("recording")}</div>
              <audio controls className="w-full">
                <source src={URL.createObjectURL(recordedBlob)} />
              </audio>
            </div>
          )}
        </section>

        <section className="space-y-5 rounded-ej-lg border border-ej-line bg-ej-surface p-6 shadow-ej">
          <FormField
            control={form.control}
            name="language"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="ej-label">{t("language")}</FormLabel>
                <div className="flex flex-wrap items-center gap-3">
                  <Segmented
                    value={field.value}
                    onChange={field.onChange}
                    options={ACCENTS}
                  />
                  <Select
                    disabled={submitting}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className={`${FIELD} w-[220px]`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((language) => (
                        <SelectItem key={language.code} value={language.code}>
                          {language.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <FormMessage className="text-xxs text-ej-bad" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="referenceText"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel className="ej-label">
                    {t("referenceText")}
                  </FormLabel>
                  <Pill tone="muted">{t("optional")}</Pill>
                </div>
                <Textarea
                  disabled={submitting}
                  placeholder={t("inputReferenceTextOrLeaveItBlank")}
                  className="min-h-[200px] rounded-[10px] border-ej-line bg-ej-surface font-literata text-[15px] leading-7 text-ej-ink focus-visible:ring-ej-accent"
                  {...field}
                />
                <FormMessage className="text-xxs text-ej-bad" />
              </FormItem>
            )}
          />
        </section>

        <EjButton
          variant="primary"
          size="lg"
          type="submit"
          disabled={submitting || !form.formState.isDirty}
          className="w-full"
          data-testid="conversation-form-submit"
        >
          {submitting ? (
            <LoaderIcon className="size-4 animate-spin" />
          ) : (
            <MicIcon className="size-4" />
          )}
          {t("assessWithAzureSpeech")}
        </EjButton>
      </form>
    </Form>
  );
};

const RecorderButton = (props: {
  submitting?: boolean;
  onStart?: () => boolean | Promise<boolean>;
  onFinish: (blob: Blob) => void;
}) => {
  const { submitting, onStart, onFinish } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [access, setAccess] = useState<boolean>(false);
  const barColor = useEjColor("--ej-accent", "#2d6be0");
  const {
    startRecording,
    stopRecording,
    togglePauseResume,
    recordingBlob,
    isRecording,
    isPaused,
    recordingTime,
    mediaRecorder,
  } = useAudioRecorder();

  const askForMediaAccess = () => {
    EnjoyApp.system.preferences.mediaAccess("microphone").then((access) => {
      if (access) {
        setAccess(true);
      } else {
        setAccess(false);
        toast.warning(t("noMicrophoneAccess"));
      }
    });
  };

  useEffect(() => {
    askForMediaAccess();
  }, []);

  useEffect(() => {
    if (recordingBlob) {
      onFinish(recordingBlob);
    }
  }, [recordingBlob]);

  useEffect(() => {
    if (!isRecording) return;

    if (recordingTime >= 60 * 5) {
      stopRecording();
    }
  }, [recordingTime]);

  if (isRecording) {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="flex items-center gap-2">
          <RecordingDot />
          <span className="ej-tabular text-sm font-bold text-ej-ink">
            {Math.floor(recordingTime / 60)}:
            {String(recordingTime % 60).padStart(2, "0")}
          </span>
        </div>

        {/* 280px / (4px bar + 6px gap) renders 28 bars. */}
        <LiveAudioVisualizer
          mediaRecorder={mediaRecorder}
          barWidth={4}
          gap={6}
          width={280}
          height={64}
          barColor={barColor}
          fftSize={512}
          maxDecibels={-10}
          minDecibels={-80}
          smoothingTimeConstant={0.4}
        />

        <div className="flex items-center gap-3">
          <EjIconButton
            size={40}
            onClick={(event) => {
              event.preventDefault();
              togglePauseResume();
            }}
            data-tooltip-id="global-tooltip"
            data-tooltip-content={isPaused ? t("continue") : t("pause")}
          >
            {isPaused ? (
              <PlayIcon className="size-4" />
            ) : (
              <PauseIcon className="size-4" />
            )}
          </EjIconButton>
          <button
            type="button"
            data-tooltip-id="global-tooltip"
            data-tooltip-content={t("finish")}
            onClick={(event) => {
              event.preventDefault();
              stopRecording();
            }}
            className="flex size-11 items-center justify-center rounded-full bg-ej-ok text-white shadow-ej transition-opacity duration-ej hover:opacity-90"
          >
            <CheckIcon className="size-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <button
        type="button"
        data-tooltip-id="global-tooltip"
        data-tooltip-content={t("record")}
        disabled={submitting}
        onClick={async (event) => {
          event.preventDefault();
          if (onStart && !(await onStart())) return;
          if (access) {
            startRecording();
          } else {
            askForMediaAccess();
          }
        }}
        className="flex size-16 items-center justify-center rounded-full bg-ej-accent text-white shadow-ej transition-transform duration-ej hover:scale-105 disabled:opacity-50"
      >
        {submitting ? (
          <LoaderIcon className="size-6 animate-spin" />
        ) : (
          <MicIcon className="size-6" />
        )}
      </button>
      <p className="text-xxs text-ej-muted">{t("tapToStartRecording")}</p>
    </div>
  );
};
