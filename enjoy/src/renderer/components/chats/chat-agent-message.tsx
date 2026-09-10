import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from "@renderer/components/ui";
import { MarkdownWrapper, CopilotForwarder } from "@renderer/components";
import { cn, formatDateTime } from "@renderer/lib/utils";
import { t } from "i18next";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  ForwardIcon,
  LanguagesIcon,
  LoaderIcon,
  MicIcon,
  MoreHorizontalIcon,
  SpeechIcon,
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import {
  AppSettingsProviderContext,
  ChatSessionProviderContext,
} from "@renderer/context";
import { useAiCommand, useSpeech } from "@renderer/hooks";
import { useCopyToClipboard } from "@uidotdev/usehooks";
import { md5 } from "js-md5";
import { ChatAgentTypeEnum, ChatTypeEnum } from "@/types/enums";
import {
  EjAudioBubble,
  EjIconButton,
  GradientAvatar,
  TypingDots,
} from "@renderer/components/enjoy";
import { displayableResourceUrl } from "@renderer/lib/retired-resource";

export const ChatAgentMessage = (props: {
  chatMessage: ChatMessageType;
  isLastMessage?: boolean;
  onEditChatMember: (chatMember: ChatMemberType) => void;
}) => {
  const { chatMessage, onEditChatMember, isLastMessage } = props;
  const { chat, chatMembers, askAgent } = useContext(
    ChatSessionProviderContext
  );
  const ref = useRef<HTMLDivElement>(null);
  const [speeching, setSpeeching] = useState(false);
  const [translation, setTranslation] = useState<string>();
  const [displayContent, setDisplayContent] = useState(
    !(chat.type === ChatTypeEnum.TTS || chat.config.enableAutoTts)
  );
  const [displayPlayer, setDisplayPlayer] = useState(false);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [ref]);

  useEffect(() => {
    if (isLastMessage) {
      askAgent();
    }
  }, [chatMessage]);

  if (!chatMessage) return;
  const chatMember = chatMembers.find((m) => m?.id === chatMessage.member?.id);
  if (!chatMember?.agent) return;

  const model =
    chatMember.agent.type === ChatAgentTypeEnum.TTS
      ? chatMember.agent.config.tts?.voice
      : chatMember.config.gpt?.model;

  return (
    <div ref={ref} className="flex items-start gap-2.5 mb-6">
      <button
        type="button"
        title={t("editAgent")}
        className="shrink-0 mt-0.5"
        onClick={() => onEditChatMember(chatMember)}
      >
        {displayableResourceUrl(chatMember.agent.avatarUrl) ? (
          <img
            src={displayableResourceUrl(chatMember.agent.avatarUrl)}
            alt={chatMember.agent.name}
            className="size-[34px] rounded-full object-cover"
          />
        ) : (
          <GradientAvatar
            name={chatMember.agent.name}
            id={chatMember.agent.id}
            size={34}
          />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div
          className="flex items-baseline gap-2 mb-1.5 cursor-pointer"
          onClick={() => onEditChatMember(chatMember)}
        >
          <span className="text-xs font-semibold text-ej-ink shrink-0">
            {chatMember.agent.name}
          </span>
          {model && (
            <span className="text-xxs text-ej-muted truncate">{model}</span>
          )}
        </div>

        {chatMessage.speech?.id ? (
          <div className="mb-2">
            {displayPlayer ? (
              <EjAudioBubble
                id={chatMessage.speech.id}
                src={chatMessage.speech.src}
                autoplay={true}
                className="w-full max-w-[420px]"
              />
            ) : (
              <button
                type="button"
                onClick={() => setDisplayPlayer(true)}
                className="inline-flex items-center gap-2.5 rounded-ej border border-ej-line bg-ej-surface2 px-2.5 py-2 transition-colors duration-ej hover:border-ej-line2"
              >
                <span className="size-[34px] rounded-full bg-ej-accent text-white inline-flex items-center justify-center">
                  <SpeechIcon className="size-4" />
                </span>
                <span className="text-xxs text-ej-muted">{t("play")}</span>
              </button>
            )}
          </div>
        ) : (
          speeching && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-ej border border-ej-line bg-ej-surface2 px-3 py-2.5">
              <TypingDots />
              <span className="text-xxs text-ej-muted">
                {t("textToSpeech")}
              </span>
            </div>
          )
        )}

        <MarkdownWrapper
          className={cn(
            "select-text prose ej-prose max-w-full text-[15px] leading-[1.65] text-ej-ink",
            !displayContent && "blur-[6px] select-none pointer-events-none"
          )}
        >
          {chatMessage.content}
        </MarkdownWrapper>

        {displayContent && translation && (
          <div className="mt-2 rounded-ej border border-ej-line bg-ej-surface2 px-3 py-2.5">
            <div className="ej-label mb-1">{t("translation")}</div>
            <MarkdownWrapper className="select-text prose ej-prose max-w-full text-[13px] leading-[1.6] text-ej-ink2">
              {translation}
            </MarkdownWrapper>
          </div>
        )}

        <ChatAgentMessageActions
          chatMessage={chatMessage}
          speeching={speeching}
          setSpeeching={setSpeeching}
          displayContent={displayContent}
          setDisplayContent={setDisplayContent}
          translation={translation}
          setTranslation={setTranslation}
          autoSpeech={
            isLastMessage &&
            (chat.type === ChatTypeEnum.TTS || chat.config.enableAutoTts)
          }
        />

        <div className="mt-1 text-xxxs text-ej-muted timestamp">
          {formatDateTime(chatMessage.createdAt)}
        </div>
      </div>
    </div>
  );
};

const ChatAgentMessageActions = (props: {
  chatMessage: ChatMessageType;
  speeching: boolean;
  setSpeeching: (speeching: boolean) => void;
  displayContent: boolean;
  setDisplayContent: (displayContent: boolean) => void;
  translation: string;
  setTranslation: (translation: string) => void;
  autoSpeech: boolean;
}) => {
  const {
    chatMessage,
    speeching,
    setSpeeching,
    displayContent,
    setDisplayContent,
    translation,
    setTranslation,
    autoSpeech,
  } = props;
  const { setShadowing, deleteMessage } = useContext(
    ChatSessionProviderContext
  );
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [_, copyToClipboard] = useCopyToClipboard();
  const [copied, setCopied] = useState<boolean>(false);
  const [resourcing, setResourcing] = useState<boolean>(false);
  const { tts } = useSpeech();
  const [translating, setTranslating] = useState<boolean>(false);
  const { translate, summarizeTopic } = useAiCommand();

  const handleTranslate = async () => {
    if (translating) return;
    if (!chatMessage.content) return;

    const cacheKey = `translate-${md5(chatMessage.content)}`;
    try {
      const cached = await EnjoyApp.cacheObjects.get(cacheKey);

      if (cached && !translation) {
        setTranslation(cached);
      } else {
        setTranslating(true);
        const result = await translate(chatMessage.content, cacheKey);
        setTranslation(result);
        setTranslating(false);
      }
    } catch (err) {
      toast.error(err.message);
      setTranslating(false);
    }
  };

  const createSpeech = async () => {
    if (chatMessage?.speech) return;
    if (speeching) return;

    // To use fresh config from chat member
    const chatMember = await EnjoyApp.chatMembers.findOne({
      where: {
        id: chatMessage.member.id,
      },
    });

    if (!chatMember) {
      toast.error(t("models.chatMembers.notFound"));
      return;
    }

    setSpeeching(true);

    tts({
      sourceType: "ChatMessage",
      sourceId: chatMessage.id,
      text: chatMessage.content,
      configuration:
        chatMember.agent.type === ChatAgentTypeEnum.TTS
          ? chatMember.agent.config.tts
          : chatMember.config.tts,
    })
      .catch((err) => {
        toast.error(err.message);
      })
      .finally(() => {
        setSpeeching(false);
      });
  };

  const startShadow = async () => {
    if (resourcing) return;
    const speech = chatMessage.speech;
    if (!speech) return;

    const audio = await EnjoyApp.audios.findOne({
      md5: speech.md5,
    });

    if (!audio) {
      setResourcing(true);
      let name =
        speech.text.length > 20
          ? speech.text.substring(0, 17).trim() + "..."
          : speech.text;

      try {
        name = await summarizeTopic(speech.text);
      } catch (e) {
        console.warn(e);
      }

      EnjoyApp.audios
        .create(speech.filePath, {
          name,
          originalText: speech.text,
        })
        .then((audio) => setShadowing(audio))
        .catch((err) => toast.error(t(err.message)))
        .finally(() => {
          setResourcing(false);
        });
    } else {
      setShadowing(audio);
    }
  };

  const handleDownload = async () => {
    EnjoyApp.dialog
      .showSaveDialog({
        title: t("download"),
        defaultPath: chatMessage.speech.filename,
        filters: [
          {
            name: "Audio",
            extensions: [chatMessage.speech.filename.split(".").pop()],
          },
        ],
      })
      .then((savePath) => {
        if (!savePath) return;

        toast.promise(
          EnjoyApp.download.start(chatMessage.speech.src, savePath as string),
          {
            success: () => t("downloadedSuccessfully"),
            error: t("downloadFailed"),
            position: "bottom-right",
          }
        );
      })
      .catch((err) => {
        toast.error(err.message);
      });
  };

  useEffect(() => {
    if (chatMessage?.speech) return;
    if (autoSpeech) {
      createSpeech();
    }
  }, [chatMessage]);

  return (
    <DropdownMenu>
      <div className="mt-2 flex items-center gap-0.5 -ml-1.5">
        {Boolean(chatMessage.speech) &&
          (resourcing ? (
            <EjIconButton disabled>
              <LoaderIcon
                data-tooltip-id="global-tooltip"
                data-tooltip-content={t("addingResource")}
                className="size-4 animate-spin"
              />
            </EjIconButton>
          ) : (
            <EjIconButton
              data-tooltip-id="global-tooltip"
              data-tooltip-content={t("shadowingExercise")}
              data-testid="message-start-shadow"
              onClick={startShadow}
            >
              <MicIcon className="size-4" />
            </EjIconButton>
          ))}

        {!Boolean(chatMessage.speech) && (
          <EjIconButton
            data-tooltip-id="global-tooltip"
            data-tooltip-content={t("textToSpeech")}
            onClick={createSpeech}
          >
            <SpeechIcon className="size-4" />
          </EjIconButton>
        )}

        <EjIconButton
          data-tooltip-id="global-tooltip"
          data-tooltip-content={displayContent ? t("hideContent") : t("displayContent")}
          active={!displayContent}
          onClick={() => setDisplayContent(!displayContent)}
        >
          {displayContent ? (
            <EyeOffIcon className="size-4" />
          ) : (
            <EyeIcon className="size-4" />
          )}
        </EjIconButton>

        {translating ? (
          <EjIconButton disabled>
            <LoaderIcon
              data-tooltip-id="global-tooltip"
              data-tooltip-content={t("translating")}
              className="size-4 animate-spin"
            />
          </EjIconButton>
        ) : (
          displayContent && (
            <EjIconButton
              data-tooltip-id="global-tooltip"
              data-tooltip-content={t("translation")}
              active={Boolean(translation)}
              onClick={handleTranslate}
            >
              <LanguagesIcon className="size-4" />
            </EjIconButton>
          )
        )}

        <EjIconButton
          data-tooltip-id="global-tooltip"
          data-tooltip-content={t("copyText")}
          onClick={() => {
            copyToClipboard(chatMessage.content);
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 3000);
          }}
        >
          {copied ? (
            <CheckIcon className="size-4 text-ej-ok" />
          ) : (
            <CopyIcon className="size-4" />
          )}
        </EjIconButton>

        <CopilotForwarder
          prompt={chatMessage.content}
          trigger={
            <EjIconButton
              data-tooltip-id="global-tooltip"
              data-tooltip-content={t("forward")}
            >
              <ForwardIcon className="size-4" />
            </EjIconButton>
          }
        />

        {Boolean(chatMessage.speech) && (
          <EjIconButton
            data-tooltip-id="global-tooltip"
            data-tooltip-content={t("download")}
            data-testid="chat-message-download-speech"
            onClick={handleDownload}
          >
            <DownloadIcon className="size-4" />
          </EjIconButton>
        )}

        <DropdownMenuTrigger asChild>
          <EjIconButton>
            <MoreHorizontalIcon className="size-4" />
          </EjIconButton>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent align="start">
        <DropdownMenuItem
          className="cursor-pointer text-xs"
          onClick={() => deleteMessage(chatMessage.id)}
        >
          <span className="mr-auto text-ej-bad">{t("delete")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
