import {
  AISettingsProviderContext,
  AppSettingsProviderContext,
} from "@renderer/context";
import { zodResolver } from "@hookform/resolvers/zod";
import { useContext, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Form,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  PingPoint,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from "@renderer/components/ui";
import { t } from "i18next";
import { LANGUAGES } from "@/constants";
import { ChevronDownIcon, ChevronUpIcon, LoaderIcon } from "lucide-react";
import { parseText } from "media-captions";
import { milisecondsToTimestamp } from "@/utils";
import { SttEngineOptionEnum } from "@/types/enums";
import {
  LEARNING_ASR_ENGINES,
  resolveLearningAsrEngine,
} from "@/lib/learning-asr-models";

const transcriptionSchema = z.object({
  language: z.string(),
  service: z.union([z.enum(LEARNING_ASR_ENGINES), z.literal("upload")]),
  text: z.string().optional(),
  isolate: z.boolean().optional(),
});

export const TranscriptionCreateForm = (props: {
  onSubmit: (data: z.infer<typeof transcriptionSchema>) => void;
  originalText?: string;
  onCancel?: () => void;
  transcribing: boolean;
  committing?: boolean;
  transcribingProgress: number;
  transcribingOutput: string;
}) => {
  const {
    transcribing = false,
    committing = false,
    transcribingProgress = 0,
    transcribingOutput,
    onSubmit,
    onCancel,
    originalText,
  } = props;
  const { learningLanguage } = useContext(AppSettingsProviderContext);
  const { sttEngine } = useContext(AISettingsProviderContext);

  const form = useForm<z.infer<typeof transcriptionSchema>>({
    resolver: zodResolver(transcriptionSchema),
    values: {
      language: learningLanguage,
      service: (originalText
        ? "upload"
        : resolveLearningAsrEngine(sttEngine) || "") as z.infer<
        typeof transcriptionSchema
      >["service"],
      text: originalText,
      isolate: false,
    },
  });
  const [collapsibleOpen, setCollapsibleOpen] = useState(false);

  const handleSubmit = (data: z.infer<typeof transcriptionSchema>) => {
    const { service, text } = data;

    if (service === "upload" && !text) {
      toast.error(t("pleaseUploadTranscriptFile"));
      return;
    }

    onSubmit(data);
  };

  const parseSubtitle = (file: File) => {
    const fileType = file.name.split(".").pop();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        let text = e.target.result;
        if (typeof text !== "string") {
          reject(new Error("Failed to read file"));
        }

        const caption = await parseText(text as string, {
          strict: false,
          type: fileType as "srt" | "vtt",
        });
        if (caption.cues.length === 0) {
          text = cleanSubtitleText(text as string);
        } else {
          // Write cues to text in SRT format
          text = caption.cues
            .map((cue) => {
              return `${milisecondsToTimestamp(
                cue.startTime * 1000
              )} --> ${milisecondsToTimestamp(cue.endTime * 1000)}\n${
                cue.text
              }`;
            })
            .join("\n\n");
        }

        if (text.length === 0) {
          reject(new Error("No text found in the file"));
        }

        // Remove all content inside `()`
        text = text.replace(/\(.*?\)/g, "").trim();
        resolve(text);
      };

      reader.onerror = (e) => {
        reject(e);
      };

      reader.readAsText(file);
    });
  };

  const cleanSubtitleText = (text: string) => {
    // Remove all line starting with `#`
    // Remove all timestamps like `00:00:00,000` or `00:00:00.000 --> 00:00:00.000`
    // Remove all empty lines
    // Remove all lines with only spaces
    return text
      .replace(
        /(\d{2}:\d{2}:\d{2}[,.]\d{3}(\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3})?)\s+/g,
        ""
      )
      .replace(/#.*\n/g, "")
      .replace(/^\s*[\r\n]/gm, "")
      .replace(/^\s+$/gm, "");
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="gap-4 grid w-full"
      >
        <FormField
          control={form.control}
          name="service"
          render={({ field }) => (
            <FormItem className="grid w-full items-center">
              <FormLabel>{t("sttAiService")}</FormLabel>
              <Select
                disabled={transcribing}
                value={field.value}
                onValueChange={field.onChange}
              >
                <SelectTrigger data-testid="transcription-service-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value={SttEngineOptionEnum.CLOUDFLARE_WORKERS_AI}
                    data-testid="transcription-service-cloudflare-worker"
                  >
                    {t("cloudflareWorkerTranscribeName")}
                  </SelectItem>
                  <SelectItem
                    value={SttEngineOptionEnum.MAI_TRANSCRIBE}
                    data-testid="transcription-service-mai"
                  >
                    {t("maiTranscribeName")}
                  </SelectItem>
                  <SelectItem value={SttEngineOptionEnum.AZURE_MAI} data-testid="stt-engine-azure-mai">
                    {t("azureMaiTranscribeName")}
                  </SelectItem>
                  <SelectItem value={SttEngineOptionEnum.AZURE_SPEECH} data-testid="stt-engine-azure-speech">
                    {t("azureFastTranscribeName")}
                  </SelectItem>
                  <SelectItem value={SttEngineOptionEnum.OPENAI}>
                    OpenAI
                  </SelectItem>
                  <SelectItem value="upload">{t("upload")}</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                {(form.watch("service") === SttEngineOptionEnum.AZURE_MAI ||
                  form.watch("service") === SttEngineOptionEnum.AZURE_SPEECH) && t("azureTranscribeDescription")}
                {form.watch("service") === SttEngineOptionEnum.OPENAI &&
                  t("openaiSpeechToTextDescription")}
                {form.watch("service") ===
                  SttEngineOptionEnum.MAI_TRANSCRIBE &&
                  (
                    <>
                      <div>{t("maiTranscribeDescription")}</div>
                      <div data-testid="mai-transcribe-model">
                        * {t("model")}: microsoft/mai-transcribe-2
                      </div>
                    </>
                  )}
                {form.watch("service") ===
                  SttEngineOptionEnum.CLOUDFLARE_WORKERS_AI && (
                  <>
                    <div>{t("cloudflareWorkerTranscribeDescription")}</div>
                    <div data-testid="cloudflare-worker-transcription-model">
                      * {t("model")}: @cf/openai/whisper-large-v3-turbo
                    </div>
                  </>
                )}
                {form.watch("service") === "upload" &&
                  t("uploadSpeechToTextDescription")}
              </FormDescription>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="language"
          render={({ field }) => (
            <FormItem className="grid w-full items-center">
              <FormLabel>{t("language")}</FormLabel>
              <Select
                disabled={transcribing}
                value={field.value}
                onValueChange={field.onChange}
              >
                <SelectTrigger>
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
              <FormMessage />
            </FormItem>
          )}
        />
        {form.watch("service") === "upload" && (
          <>
            <FormField
              control={form.control}
              name="text"
              render={({ field }) => (
                <FormItem className="grid w-full items-center">
                  {field.value != undefined && (
                    <>
                      <FormLabel>{t("transcript")}</FormLabel>
                      <Textarea
                        className="h-36"
                        {...field}
                        disabled={transcribing}
                      />
                    </>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}
        <Collapsible open={collapsibleOpen} onOpenChange={setCollapsibleOpen}>
          <CollapsibleContent className="mb-4 space-y-4">
            {form.watch("service") === "upload" && (
              <FormField
                control={form.control}
                name="text"
                render={({ field }) => (
                  <FormItem className="grid w-full items-center">
                    <FormLabel>{t("uploadTranscriptFile")}</FormLabel>
                    <Input
                      disabled={transcribing}
                      type="file"
                      accept=".txt,.srt,.vtt"
                      onChange={async (event) => {
                        const file = event.target.files[0];

                        if (file) {
                          parseSubtitle(file)
                            .then((text) => {
                              field.onChange(text);
                            })
                            .catch((error) => {
                              toast.error(error.message);
                            });
                        } else {
                          field.onChange("");
                        }
                      }}
                    />
                    <FormDescription>
                      {t("uploadTranscriptFileDescription")}
                    </FormDescription>
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="isolate"
              render={({ field }) => (
                <FormItem className="grid w-full items-center">
                  <FormLabel>{t("isolateVoice")}</FormLabel>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={transcribing}
                  />
                  <FormDescription>
                    {t("isolateVoiceDescription")}
                  </FormDescription>
                </FormItem>
              )}
            />
          </CollapsibleContent>
          <div className="flex justify-center">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                {collapsibleOpen ? (
                  <>
                    <ChevronUpIcon className="h-4 w-4" />
                    <span className="ml-2">{t("lessOptions")}</span>
                  </>
                ) : (
                  <>
                    <ChevronDownIcon className="h-4 w-4" />
                    <span className="ml-2">{t("moreOptions")}</span>
                  </>
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </Collapsible>

        <TranscribeProgress
          service={form.watch("service")}
          transcribing={transcribing}
          committing={committing}
          transcribingProgress={transcribingProgress}
          transcribingOutput={transcribingOutput}
        />

        <div className="flex justify-end space-x-4">
          {onCancel && (
            <Button
              type="reset"
              variant="outline"
              onClick={onCancel}
              disabled={committing}
            >
              {committing
                ? t("saving")
                : transcribing
                  ? t("cancelTranscription")
                  : t("cancel")}
            </Button>
          )}
          <Button
            data-testid="transcribe-continue-button"
            disabled={transcribing || !form.watch("service")}
            type="submit"
            variant="default"
          >
            {transcribing && <LoaderIcon className="animate-spin w-4 mr-2" />}
            {t("continue")}
          </Button>
        </div>
      </form>
    </Form>
  );
};

const TranscribeProgress = (props: {
  service: string;
  transcribing: boolean;
  committing?: boolean;
  transcribingProgress: number;
  transcribingOutput?: string;
}) => {
  const {
    service,
    transcribing,
    committing = false,
    transcribingProgress,
    transcribingOutput,
  } = props;
  if (!transcribing) return null;

  return (
    <div className="mb-4 space-y-2" data-testid="transcription-progress">
      <div className="flex items-center space-x-4 mb-2">
        <PingPoint colorClassName="bg-yellow-500" />
        <span>{committing ? t("saving") : t("transcribing")}</span>
      </div>
      {(service === "local" ||
        service === SttEngineOptionEnum.AZURE_MAI ||
        service === SttEngineOptionEnum.AZURE_SPEECH ||
        service === SttEngineOptionEnum.MAI_TRANSCRIBE ||
        service === SttEngineOptionEnum.CLOUDFLARE_WORKERS_AI) &&
        transcribingProgress > 0 && (
        <Progress
          value={transcribingProgress}
          data-testid="mai-transcribe-progress"
        />
      )}
      {transcribingOutput && (
        <div className="max-w-full rounded-lg border bg-zinc-950 p-3 dark:bg-zinc-900 h-20 overflow-y-auto">
          <code className="px-[0.3rem] py-[0.2rem] rounded text-ej-muted font-mono text-xs break-words">
            {transcribingOutput}
          </code>
        </div>
      )}
    </div>
  );
};
