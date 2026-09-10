import { useContext, useMemo } from "react";
import { t } from "i18next";
import { Switch, toast } from "@renderer/components/ui";
import {
  AppSettingsProviderContext,
  ChatSessionProviderContext,
} from "@renderer/context";
import { ChatMessageRoleEnum, ChatTypeEnum } from "@/types/enums";
import { GradientAvatar, Pill, StatBox } from "@renderer/components/enjoy";
import { scoreColor } from "@renderer/lib/design";
import { displayableResourceUrl } from "@renderer/lib/retired-resource";

const STOP_WORDS = new Set([
  "about", "because", "before", "between", "should", "through", "together",
  "something", "someone", "sometimes", "another", "however", "therefore",
  "yourself", "myself", "really", "always", "little", "people", "little",
  "please", "thanks", "thought", "though", "without", "against", "around",
]);

/** Extract candidate vocabulary from what the agent said in this chat. */
const collectVocabulary = (messages: ChatMessageType[]) => {
  const words: string[] = [];

  messages
    .filter((message) => message.role === ChatMessageRoleEnum.AGENT)
    .slice(-30)
    .forEach((message) => {
      (message.content || "").match(/[A-Za-z][A-Za-z'-]{5,}/g)?.forEach((raw) => {
        const word = raw.toLowerCase().replace(/^['-]+|['-]+$/g, "");
        if (word.length < 6 || STOP_WORDS.has(word)) return;
        if (words.includes(word)) return;
        words.push(word);
      });
    });

  return words.slice(-14).reverse();
};

const SettingRow = (props: {
  label: string;
  hint?: string;
  control: React.ReactNode;
}) => (
  <div className="flex items-start justify-between gap-3 py-2.5">
    <div className="min-w-0">
      <div className="text-xs text-ej-ink">{props.label}</div>
      {props.hint && (
        <div className="mt-0.5 text-xxs text-ej-muted leading-snug">
          {props.hint}
        </div>
      )}
    </div>
    <div className="shrink-0 pt-0.5">{props.control}</div>
  </div>
);

export const ChatAside = () => {
  const { chat, chatMembers, chatMessages } = useContext(
    ChatSessionProviderContext
  );
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const primaryMember = chatMembers?.find(
    (member) => member.userType === "ChatAgent"
  );
  const agent = primaryMember?.agent;
  const model =
    primaryMember?.config?.gpt?.model || primaryMember?.config?.tts?.model;
  const voice = primaryMember?.config?.tts?.voice;

  const updateConfig = (config: Record<string, any>) => {
    EnjoyApp.chats
      .update(chat.id, {
        name: chat.name,
        config: { ...chat.config, ...config },
      })
      .catch((error) => {
        toast.error(error.message);
      });
  };

  const scores = chatMessages
    .filter((message) => message.role === ChatMessageRoleEnum.USER)
    .map((message) => message.recording?.pronunciationAssessment?.pronunciationScore)
    .filter((score): score is number => typeof score === "number");
  const averageScore = scores.length
    ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
    : null;

  const vocabulary = useMemo(
    () => collectVocabulary(chatMessages),
    [chatMessages]
  );

  return (
    <aside className="h-content min-h-0 overflow-y-auto scroll border-l border-ej-line bg-ej-side">
      <div className="px-4 py-5 text-center border-b border-ej-line">
        <div className="inline-flex">
          {displayableResourceUrl(agent?.avatarUrl) ? (
            <img
              src={displayableResourceUrl(agent.avatarUrl)}
              alt={agent.name}
              className="size-16 rounded-full object-cover"
            />
          ) : (
            <GradientAvatar
              name={agent?.name || chat.name}
              id={chat.id}
              size={64}
            />
          )}
        </div>

        <div className="mt-2.5 text-sm font-semibold text-ej-ink truncate">
          {agent?.name || chat.name}
        </div>
        <div className="mt-0.5 text-xxs text-ej-muted truncate">
          {[model, voice].filter(Boolean).join(" · ")}
        </div>

        {agent?.description && (
          <p className="mt-2.5 text-xs text-ej-ink2 leading-relaxed line-clamp-4 text-left">
            {agent.description}
          </p>
        )}
      </div>

      <div className="px-4 py-4 border-b border-ej-line">
        <div className="ej-label mb-1">{t("chatSettings")}</div>

        {chat.type !== ChatTypeEnum.TTS && (
          <SettingRow
            label={t("autoPlay")}
            hint={t("autoPlayHint")}
            control={
              <Switch
                checked={Boolean(chat.config?.enableAutoTts)}
                onCheckedChange={(value) =>
                  updateConfig({ enableAutoTts: value })
                }
              />
            }
          />
        )}

        <SettingRow
          label={t("chatAssistant")}
          hint={t("chatAssistantHint")}
          control={
            <Switch
              checked={Boolean(chat.config?.enableChatAssistant)}
              onCheckedChange={(value) =>
                updateConfig({ enableChatAssistant: value })
              }
            />
          }
        />

        {voice && (
          <SettingRow
            label={t("voice")}
            control={
              <span className="text-xs text-ej-muted truncate max-w-[120px] inline-block">
                {voice}
              </span>
            }
          />
        )}

        {chat.config?.sttEngine && (
          <SettingRow
            label={t("speechToTextEngine")}
            control={
              <span className="text-xs text-ej-muted truncate max-w-[120px] inline-block">
                {chat.config.sttEngine}
              </span>
            }
          />
        )}
      </div>

      <div className="px-4 py-4 grid gap-2 border-b border-ej-line">
        <StatBox label={t("messages")} value={chatMessages.length} />
        <StatBox
          label={t("averagePronunciationScore")}
          value={
            averageScore === null ? (
              "--"
            ) : (
              <span style={{ color: scoreColor(averageScore) }}>
                {averageScore}
              </span>
            )
          }
          hint={
            scores.length > 0
              ? t("recordingsCount", { count: scores.length })
              : undefined
          }
        />
      </div>

      {vocabulary.length > 0 && (
        <div className="px-4 py-4">
          <div className="ej-label mb-2">{t("newVocabularyInChat")}</div>
          <div className="flex flex-wrap gap-1.5">
            {vocabulary.map((word) => (
              <Pill key={word} className="select-text">
                {word}
              </Pill>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};
