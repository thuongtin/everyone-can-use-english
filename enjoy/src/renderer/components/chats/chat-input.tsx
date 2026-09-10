import {
  ArrowUpIcon,
  CheckIcon,
  LoaderIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  StepForwardIcon,
  TypeIcon,
  WandIcon,
  XIcon,
} from "lucide-react";
import { Textarea } from "@renderer/components/ui";
import { useContext, useEffect, useRef, useState } from "react";
import { LiveAudioVisualizer } from "react-audio-visualize";
import {
  AppSettingsProviderContext,
  ChatSessionProviderContext,
  HotKeysSettingsProviderContext,
} from "@renderer/context";
import { t } from "i18next";
import autosize from "autosize";
import { ChatMentioning, ChatSuggestionButton } from "@renderer/components";
import { useHotkeys } from "react-hotkeys-hook";
import { ChatTypeEnum } from "@/types/enums";
import { cn } from "@renderer/lib/utils";
import { EjIconButton } from "@renderer/components/enjoy";

const Kbd = (props: { children: React.ReactNode }) => (
  <span className="rounded border border-ej-line bg-ej-surface2 px-1 py-px text-xxxs font-medium text-ej-ink2">
    {props.children}
  </span>
);

export const ChatInput = () => {
  const {
    chat,
    submitting,
    startRecording,
    stopRecording,
    cancelRecording,
    togglePauseResume,
    isRecording,
    mediaRecorder,
    recordingTime,
    isPaused,
    askAgent,
    createMessage,
    shadowing,
    chatAgents,
  } = useContext(ChatSessionProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [inputMode, setInputMode] = useState<"text" | "audio">("text");
  const [content, setContent] = useState("");
  const { currentHotkeys } = useContext(HotKeysSettingsProviderContext);
  const [mentioned, setMentioned] = useState<ChatAgentType[]>([]);

  useEffect(() => {
    if (!inputRef.current) return;

    autosize(inputRef.current);

    inputRef.current.addEventListener("keypress", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitRef.current?.click();
      }
    });

    inputRef.current.focus();

    return () => {
      inputRef.current?.removeEventListener("keypress", () => {});
      autosize.destroy(inputRef.current);
    };
  }, [inputRef.current]);

  useEffect(() => {
    if (content) return;

    const evt = new CustomEvent("autosize:update", {
      bubbles: true,
      cancelable: false,
    });
    inputRef.current?.dispatchEvent(evt);
  }, [content]);

  useEffect(() => {
    EnjoyApp.cacheObjects
      .get(`chat-input-mode-${chat.id}`)
      .then((cachedInputMode) => {
        if (cachedInputMode) {
          setInputMode(cachedInputMode as typeof inputMode);
        }
      });
  }, []);

  useEffect(() => {
    EnjoyApp.cacheObjects.set(`chat-input-mode-${chat.id}`, inputMode);
  }, [inputMode]);

  useHotkeys(
    currentHotkeys.StartOrStopRecording,
    () => {
      if (shadowing) return;
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    },
    {
      preventDefault: true,
    }
  );

  useHotkeys(
    currentHotkeys.PlayNextSegment,
    () => {
      if (shadowing) return;
      askAgent({ force: true });
    },
    {
      preventDefault: true,
    }
  );

  const timer = `${Math.floor(recordingTime / 60)}:${String(
    recordingTime % 60
  ).padStart(2, "0")}`;

  const hints = (
    <div className="mt-1.5 flex items-center justify-center gap-3 text-xxxs text-ej-muted">
      <span className="flex items-center gap-1">
        <Kbd>Enter</Kbd>
        {t("send")}
      </span>
      <span className="flex items-center gap-1">
        <Kbd>{currentHotkeys.StartOrStopRecording}</Kbd>
        {t("record")}
      </span>
    </div>
  );

  if (isRecording) {
    return (
      <div className="z-10 w-full">
        <div className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[14px] bg-ej-bad text-white shadow-ej">
          <span className="size-2 shrink-0 rounded-full bg-white animate-ej-pulse" />

          <LiveAudioVisualizer
            mediaRecorder={mediaRecorder}
            barWidth={2}
            gap={2}
            width={140}
            height={30}
            fftSize={512}
            maxDecibels={-10}
            minDecibels={-80}
            smoothingTimeConstant={0.4}
            barColor="rgba(255,255,255,0.85)"
          />

          <div className="flex-1 min-w-0 text-xs truncate">
            {t("recordingVoiceMessage")}
            <span className="ej-tabular"> · {timer}</span>
          </div>

          <button
            type="button"
            data-tooltip-id={`${chat.id}-tooltip`}
            data-tooltip-content={t("cancel")}
            onClick={cancelRecording}
            className="size-8 shrink-0 rounded-full bg-white/15 hover:bg-white/25 inline-flex items-center justify-center transition-colors duration-ej"
          >
            <XIcon className="size-4" />
          </button>
          <button
            type="button"
            data-tooltip-id={`${chat.id}-tooltip`}
            data-tooltip-content={isPaused ? t("continue") : t("pause")}
            onClick={togglePauseResume}
            className="size-8 shrink-0 rounded-full bg-white/15 hover:bg-white/25 inline-flex items-center justify-center transition-colors duration-ej"
          >
            {isPaused ? (
              <PlayIcon className="size-4 fill-current" />
            ) : (
              <PauseIcon className="size-4 fill-current" />
            )}
          </button>
          <button
            type="button"
            data-tooltip-id={`${chat.id}-tooltip`}
            data-tooltip-content={t("finish")}
            onClick={stopRecording}
            className="size-8 shrink-0 rounded-full bg-white text-ej-bad hover:opacity-90 inline-flex items-center justify-center transition-opacity duration-ej"
          >
            <CheckIcon className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  if (inputMode === "text") {
    return (
      <ChatMentioning
        input={content}
        members={chatAgents}
        mentioned={mentioned.map((chatAgent) => chatAgent.id)}
        onMention={(chatAgent) => {
          setMentioned([...mentioned, chatAgent]);
        }}
        onRemove={(chatAgent) => {
          setMentioned(mentioned.filter((ca) => ca.id !== chatAgent.id));
        }}
        onCancel={() => setContent("")}
      >
        <div className="z-10 w-full">
          {mentioned.length > 0 && (
            <div className="w-full rounded-ej border border-ej-accent-soft2 bg-ej-accent-soft px-3 py-2 mb-1.5">
              {mentioned.map((chatAgent) => (
                <div
                  className="flex items-center justify-between gap-2"
                  key={chatAgent.id}
                >
                  <div className="flex-1 min-w-0 text-xs text-ej-accent-ink truncate">
                    {chatAgents.findIndex((ca) => ca.id === chatAgent.id) > -1
                      ? t("askAgentToReply", { name: chatAgent.name })
                      : t("inviteAgentInChatAndReply", {
                          name: chatAgent.name,
                        })}
                  </div>
                  <EjIconButton
                    size={22}
                    className="text-ej-accent-ink"
                    onClick={() =>
                      setMentioned(
                        mentioned.filter((ca) => ca.id !== chatAgent.id)
                      )
                    }
                  >
                    <XIcon className="size-3.5" />
                  </EjIconButton>
                </div>
              ))}
            </div>
          )}

          <div className="w-full flex items-end gap-1 px-2 py-2 rounded-[14px] border border-ej-line bg-ej-surface shadow-ej">
            <EjIconButton
              size={32}
              data-tooltip-id={`${chat.id}-tooltip`}
              data-tooltip-content={t("audioInput")}
              disabled={submitting}
              onClick={() => setInputMode("audio")}
            >
              <MicIcon className="size-[18px]" />
            </EjIconButton>

            <Textarea
              ref={inputRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={submitting}
              placeholder={t("pressEnterToSend")}
              data-testid="chat-input"
              className="flex-1 bg-transparent text-ej-ink placeholder:text-ej-muted rounded-lg text-sm leading-6 px-1.5 py-1.5 shadow-none focus-visible:outline-0 focus-visible:ring-0 border-none min-h-8 max-h-[40vh] scrollbar-thin !overflow-x-hidden resize-none"
            />

            <button
              ref={submitRef}
              type="button"
              data-tooltip-id={`${chat.id}-tooltip`}
              data-tooltip-content={t("send")}
              onClick={() =>
                createMessage(content, {
                  mentions: mentioned.map((m) => m.id),
                  onSuccess: () => setContent(""),
                })
              }
              disabled={submitting || !content.trim() || content === "@"}
              className={cn(
                "size-8 shrink-0 rounded-full inline-flex items-center justify-center transition-all duration-ej",
                "disabled:pointer-events-none",
                content.trim() && content !== "@"
                  ? "bg-ej-ink text-ej-bg hover:opacity-90"
                  : "bg-ej-surface2 text-ej-muted"
              )}
            >
              {submitting ? (
                <LoaderIcon className="size-4 animate-spin" />
              ) : (
                <ArrowUpIcon className="size-4" />
              )}
            </button>

            {chat.config.enableChatAssistant && (
              <ChatSuggestionButton chat={chat} asChild>
                <EjIconButton
                  size={32}
                  data-tooltip-id={`${chat.id}-tooltip`}
                  data-tooltip-content={t("suggestion")}
                >
                  <WandIcon className="size-[18px]" />
                </EjIconButton>
              </ChatSuggestionButton>
            )}

            {chat.type === ChatTypeEnum.GROUP && (
              <EjIconButton
                size={32}
                data-tooltip-id={`${chat.id}-tooltip`}
                data-tooltip-content={t("continue")}
                disabled={submitting}
                onClick={() => askAgent({ force: true })}
              >
                <StepForwardIcon className="size-[18px]" />
              </EjIconButton>
            )}
          </div>

          {hints}
        </div>
      </ChatMentioning>
    );
  }

  return (
    <div className="z-10 w-full">
      <div className="w-full flex items-center justify-center gap-3 px-2.5 py-2.5 rounded-[14px] border border-ej-line bg-ej-surface shadow-ej">
        <EjIconButton
          size={32}
          data-tooltip-id={`${chat.id}-tooltip`}
          data-tooltip-content={t("textInput")}
          disabled={submitting}
          onClick={() => setInputMode("text")}
        >
          <TypeIcon className="size-[18px]" />
        </EjIconButton>

        <button
          type="button"
          data-tooltip-id={`${chat.id}-tooltip`}
          data-tooltip-content={t("record")}
          disabled={submitting}
          onClick={startRecording}
          className="size-11 rounded-full bg-ej-bad text-white inline-flex items-center justify-center transition-opacity duration-ej hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none"
        >
          {submitting ? (
            <LoaderIcon className="size-5 animate-spin" />
          ) : (
            <MicIcon className="size-5" />
          )}
        </button>

        {chat.config.enableChatAssistant && (
          <ChatSuggestionButton chat={chat} asChild>
            <EjIconButton
              size={32}
              data-tooltip-id={`${chat.id}-tooltip`}
              data-tooltip-content={t("suggestion")}
            >
              <WandIcon className="size-[18px]" />
            </EjIconButton>
          </ChatSuggestionButton>
        )}

        {chat.type === ChatTypeEnum.GROUP && (
          <EjIconButton
            size={32}
            data-tooltip-id={`${chat.id}-tooltip`}
            data-tooltip-content={t("continue")}
            disabled={submitting}
            onClick={() => askAgent({ force: true })}
          >
            <StepForwardIcon className="size-[18px]" />
          </EjIconButton>
        )}
      </div>

      {hints}
    </div>
  );
};
