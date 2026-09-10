import { t } from "i18next";
import { useForm } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@renderer/components/ui";
import { LANGUAGES } from "@/constants";

const FIELD =
  "h-9 rounded-[10px] border-ej-line bg-ej-surface text-xs text-ej-ink focus-visible:ring-ej-accent";

export const ConversationFormTTS = (props: {
  form: ReturnType<typeof useForm>;
  ttsProviders: any;
}) => {
  const { form, ttsProviders } = props;

  return (
    <div className="space-y-5 border-t border-ej-line pt-5">
      <div className="ej-label text-ej-accent">{t("textToSpeech")}</div>

      <FormField
        control={form.control}
        name="configuration.tts.engine"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="ej-label">{t("models.conversation.ttsEngine")}</FormLabel>
            <Select
              onValueChange={(engine) => {
                field.onChange(engine);
                const provider = ttsProviders[engine];
                const model = provider?.models?.[0] || "";
                const language = form.getValues("configuration.tts.language");
                const voices = provider?.voices || [];
                const voice = voices.find?.(
                  (option: any) =>
                    typeof option === "object" && option.language === language
                ) || voices[0];
                form.setValue("configuration.tts.model", model, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
                form.setValue(
                  "configuration.tts.voice",
                  typeof voice === "string" ? voice : voice?.value || "",
                  { shouldDirty: true, shouldValidate: true }
                );
              }}
              defaultValue={field.value}
              value={field.value}
            >
              <FormControl>
                <SelectTrigger className={FIELD}>
                  <SelectValue placeholder={t("selectTtsEngine")} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {Object.keys(ttsProviders).map((key) => (
                  <SelectItem key={key} value={key}>
                    {ttsProviders[key].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {ttsProviders[
        form.watch("configuration.tts.engine")
      ]?.configurable?.includes("model") && (
        <FormField
          control={form.control}
          name="configuration.tts.model"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="ej-label">{t("models.conversation.ttsModel")}</FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger className={FIELD}>
                    <SelectValue placeholder={t("selectTtsModel")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(
                    ttsProviders[form.watch("configuration.tts.engine")]
                      ?.models || []
                  ).map((model: string) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {ttsProviders[
        form.watch("configuration.tts.engine")
      ]?.configurable?.includes("language") && (
        <FormField
          control={form.control}
          name="configuration.tts.language"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="ej-label">{t("models.conversation.ttsLanguage")}</FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger className={FIELD}>
                    <SelectValue placeholder={t("selectTtsLanguage")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {ttsProviders[
        form.watch("configuration.tts.engine")
      ]?.configurable?.includes("voice") && (
        <FormField
          control={form.control}
          name="configuration.tts.voice"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="ej-label">{t("models.conversation.ttsVoice")}</FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger className={FIELD}>
                    <SelectValue placeholder={t("selectTtsVoice")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(
                    ttsProviders[form.watch("configuration.tts.engine")]
                      ?.voices || []
                  ).map((voice: any) => {
                    if (typeof voice === "string") {
                      return (
                        <SelectItem key={voice} value={voice}>
                          <span className="capitalize">{voice}</span>
                        </SelectItem>
                      );
                    } else if (
                      voice.language ===
                      form.watch("configuration.tts.language")
                    ) {
                      return (
                        <SelectItem key={voice.value} value={voice.value}>
                          <span className="capitalize">{voice.label}</span>
                        </SelectItem>
                      );
                    }
                  })}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {ttsProviders[
        form.watch("configuration.tts.engine")
      ]?.configurable.includes("baseUrl") && (
        <FormField
          control={form.control}
          name="configuration.tts.baseUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="ej-label">{t("models.conversation.ttsBaseUrl")}</FormLabel>
              <Input
                {...field}
                className={FIELD}
                placeholder={t("models.conversation.ttsBaseUrlDescription")}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
};
