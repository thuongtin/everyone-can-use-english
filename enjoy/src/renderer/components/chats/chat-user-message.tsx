import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Textarea,
  toast,
} from "@renderer/components/ui";
import {
  CopilotForwarder,
  MarkdownWrapper,
  PronunciationAssessmentScoreDetail,
} from "@renderer/components";
import { cn, formatDateTime } from "@renderer/lib/utils";
import { scoreChipClass } from "@renderer/lib/design";
import { t } from "i18next";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  ForwardIcon,
  GaugeCircleIcon,
  InfoIcon,
  LoaderIcon,
  MicIcon,
  MoreHorizontalIcon,
  SparklesIcon,
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import {
  AppSettingsProviderContext,
  ChatSessionProviderContext,
} from "@renderer/context";
import { useAiCommand } from "@renderer/hooks";
import { md5 } from "js-md5";
import { useCopyToClipboard } from "@uidotdev/usehooks";
import { ChatMessageRoleEnum, ChatMessageStateEnum } from "@/types/enums";
import { EjAudioBubble, EjIconButton } from "@renderer/components/enjoy";

export const ChatUserMessage = (props: {
  chatMessage: ChatMessageType;
  isLastMessage: boolean;
}) => {
  const { chatMessage, isLastMessage } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<boolean>(false);
  const [content, setContent] = useState<string>(chatMessage.content);
  const { updateMessage, askAgent, submitting, asking } = useContext(
    ChatSessionProviderContext
  );
  const pending = chatMessage.state === ChatMessageStateEnum.PENDING;

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [ref]);

  useEffect(() => {
    if (!isLastMessage) return;
    // If the message is from recording, wait for user to confirm before asking agent
    if (chatMessage.state !== ChatMessageStateEnum.COMPLETED) {
      return;
    } else {
      askAgent();
    }
  }, [chatMessage]);

  return (
    <div ref={ref} className="flex justify-end mb-6">
      <div className="w-full max-w-[85%] flex flex-col items-end">
        <div
          className={cn(
            "w-fit max-w-full px-3.5 py-2.5 rounded-[16px_16px_4px_16px] border",
            pending
              ? "bg-ej-hl border-ej-hl-ink/20"
              : "bg-ej-accent-soft border-ej-accent-soft2"
          )}
        >
          <ChatUserMessageRecording chatMessage={chatMessage} />

          {editing ? (
            <div>
              <Textarea
                className="bg-ej-surface mb-2 text-[15px]"
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => setEditing(false)}
                  variant="secondary"
                  size="sm"
                  className="rounded-full h-7 px-3 text-xs"
                >
                  {t("cancel")}
                </Button>
                <Button
                  onClick={() =>
                    updateMessage(chatMessage.id, { content }).finally(() =>
                      setEditing(false)
                    )
                  }
                  variant="default"
                  size="sm"
                  className="rounded-full h-7 px-3 text-xs"
                >
                  {t("save")}
                </Button>
              </div>
            </div>
          ) : (
            Boolean(chatMessage.content) && (
              <MarkdownWrapper className="select-text prose ej-prose max-w-full text-[15px] leading-[1.65] text-ej-ink">
                {chatMessage.content}
              </MarkdownWrapper>
            )
          )}
        </div>

        <ChatUserMessageActions
          chatMessage={chatMessage}
          setContent={setContent}
          setEditing={setEditing}
        />

        {pending && !submitting && !asking && (
          <div className="mt-1.5 flex items-center gap-2">
            <InfoIcon
              data-tooltip-id={`${chatMessage.chatId}-tooltip`}
              data-tooltip-content={t("confirmBeforeSending")}
              className="size-3.5 text-ej-warn"
            />
            <button
              type="button"
              disabled={submitting || Boolean(asking)}
              onClick={() => askAgent()}
              className="h-7 px-4 rounded-full bg-ej-ink text-ej-bg text-xs font-semibold transition-opacity duration-ej hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none"
            >
              {t("send")}
            </button>
          </div>
        )}

        <div className="mt-1 text-xxxs text-ej-muted timestamp">
          {formatDateTime(chatMessage.createdAt)}
        </div>
      </div>
    </div>
  );
};

const ChatUserMessageRecording = (props: { chatMessage: ChatMessageType }) => {
  const { chatMessage } = props;
  const { recording } = chatMessage;
  const [displayScoreDetail, setDisplayScoreDetail] = useState(false);
  const assessment = recording?.pronunciationAssessment;
  const score = assessment?.pronunciationScore;

  if (!recording?.src) return null;

  return (
    <div className={cn("min-w-0", Boolean(chatMessage.content) && "mb-2")}>
      <EjAudioBubble
        id={recording.id}
        src={recording.src}
        waveWidth={180}
        className="bg-ej-surface border-ej-accent-soft2"
        trailing={
          typeof score === "number" ? (
            <button
              type="button"
              title={t("pronunciationAssessment")}
              onClick={() => setDisplayScoreDetail(!displayScoreDetail)}
              className={cn(
                "shrink-0 h-6 px-2 rounded-full text-xs font-semibold ej-tabular",
                scoreChipClass(score)
              )}
            >
              {Math.round(score)}
            </button>
          ) : null
        }
      />

      {displayScoreDetail && assessment && (
        <div className="mt-2 rounded-ej border border-ej-line bg-ej-surface p-3">
          <PronunciationAssessmentScoreDetail assessment={assessment} />
        </div>
      )}
    </div>
  );
};

const ChatUserMessageActions = (props: {
  chatMessage: ChatMessageType;
  setContent: (content: string) => void;
  setEditing: (value: boolean) => void;
}) => {
  const { chatMessage, setContent, setEditing } = props;
  const { recording } = chatMessage;
  const [refinement, setRefinement] = useState<string>();
  const [refining, setRefining] = useState<boolean>(false);
  const [refinementVisible, setRefinementVisible] = useState<boolean>(true);
  const { refine } = useAiCommand();
  const [_, copyToClipboard] = useCopyToClipboard();
  const [copied, setCopied] = useState<boolean>(false);
  const { EnjoyApp, learningLanguage, user } = useContext(
    AppSettingsProviderContext
  );
  const {
    chatMessages,
    startRecording,
    isRecording,
    isPaused,
    assessing,
    setAssessing,
    deleteMessage,
    submitting,
  } = useContext(ChatSessionProviderContext);

  const handleRefine = async (params?: { reload?: boolean }) => {
    if (refining) return;
    if (!chatMessage.content) return;

    const { reload = false } = params || {};
    const cacheKey = `chat-message-refinement-${md5(chatMessage.id)}`;
    try {
      const cached = await EnjoyApp.cacheObjects.get(cacheKey);

      if (cached && !reload && !refinement) {
        setRefinement(cached);
      } else {
        setRefining(true);

        const context = `I'm chatting in a chatroom. The previous messages are as follows:\n\n${buildChatHistory()}`;
        const result = await refine(chatMessage.content, {
          learningLanguage,
          context,
        });
        EnjoyApp.cacheObjects.set(cacheKey, result);
        setRefinement(result);
        setRefining(false);
      }
    } catch (err) {
      toast.error(err.message);
      setRefining(false);
    }
  };

  const buildChatHistory = () => {
    const messages = chatMessages.filter(
      (m) => new Date(m.createdAt) < new Date(chatMessage.createdAt)
    );
    return messages
      .filter((m) =>
        [ChatMessageRoleEnum.USER, ChatMessageRoleEnum.AGENT].includes(m.role)
      )
      .map((message) =>
        message.role === ChatMessageRoleEnum.USER
          ? `${user.name}: ${message.content}`
          : `${message.member.agent.name}: ${message.content}`
      )
      .join("\n");
  };

  const handleDownload = () => {
    if (!chatMessage.recording) return;

    EnjoyApp.dialog
      .showSaveDialog({
        title: t("download"),
        defaultPath: chatMessage.recording.filename,
        filters: [
          {
            name: "Audio",
            extensions: [chatMessage.recording.filename.split(".").pop()],
          },
        ],
      })
      .then((savePath) => {
        if (!savePath) return;

        toast.promise(
          EnjoyApp.download.start(
            chatMessage.recording.src,
            savePath as string
          ),
          {
            loading: t("downloadingFile", {
              file: chatMessage.recording.filename,
            }),
            success: () => t("downloadedSuccessfully"),
            error: t("downloadFailed"),
            position: "bottom-right",
          }
        );
      })
      .catch((err) => {
        if (err) toast.error(err.message);
      });
  };

  return (
    <>
      <DropdownMenu>
        <div className="mt-1 flex items-center justify-end gap-0.5 -mr-1.5">
          {chatMessage.state === ChatMessageStateEnum.PENDING && (
            <>
              <EjIconButton
                data-tooltip-id="global-tooltip"
                data-tooltip-content={t("edit")}
                disabled={submitting}
                onClick={() => {
                  if (submitting) return;
                  setContent(chatMessage.content);
                  setEditing(true);
                }}
              >
                <EditIcon className="size-4" />
              </EjIconButton>
              <EjIconButton
                data-tooltip-id="global-tooltip"
                data-tooltip-content={t("reRecord")}
                disabled={submitting || isPaused || isRecording}
                onClick={startRecording}
              >
                <MicIcon className="size-4" />
              </EjIconButton>
            </>
          )}

          {chatMessage.recording &&
            (assessing ? (
              <EjIconButton disabled>
                <LoaderIcon className="size-4 animate-spin" />
              </EjIconButton>
            ) : (
              <EjIconButton
                data-tooltip-id="global-tooltip"
                data-tooltip-content={t("pronunciationAssessment")}
                onClick={() => setAssessing(recording)}
              >
                <GaugeCircleIcon className="size-4" />
              </EjIconButton>
            ))}

          {refining ? (
            <EjIconButton disabled>
              <LoaderIcon className="size-4 animate-spin" />
            </EjIconButton>
          ) : (
            <EjIconButton
              data-tooltip-id="global-tooltip"
              data-tooltip-content={t("refine")}
              active={Boolean(refinement)}
              onClick={() => handleRefine()}
            >
              <SparklesIcon className="size-4" />
            </EjIconButton>
          )}

          {chatMessage.state === ChatMessageStateEnum.COMPLETED && (
            <>
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

              {Boolean(chatMessage.recording) && (
                <EjIconButton
                  data-tooltip-id="global-tooltip"
                  data-tooltip-content={t("download")}
                  data-testid="chat-message-download-recording"
                  onClick={handleDownload}
                >
                  <DownloadIcon className="size-4" />
                </EjIconButton>
              )}
            </>
          )}

          <DropdownMenuTrigger asChild>
            <EjIconButton>
              <MoreHorizontalIcon className="size-4" />
            </EjIconButton>
          </DropdownMenuTrigger>
        </div>

        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="cursor-pointer text-xs"
            onClick={() => deleteMessage(chatMessage.id)}
          >
            <span className="mr-auto text-ej-bad">{t("delete")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {refinement && (
        <div className="mt-2 w-full rounded-ej border border-ej-line bg-ej-surface overflow-hidden">
          <Collapsible
            open={refinementVisible}
            onOpenChange={(value) => setRefinementVisible(value)}
          >
            <CollapsibleTrigger asChild>
              <div className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer">
                <div className="flex items-center gap-2">
                  <SparklesIcon className="size-3.5 text-ej-accent" />
                  <span className="text-xs font-semibold text-ej-ink">
                    {t("refine")}
                  </span>
                </div>
                {refinementVisible ? (
                  <ChevronDownIcon className="size-4 text-ej-muted" />
                ) : (
                  <ChevronRightIcon className="size-4 text-ej-muted" />
                )}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-3.5 py-3 border-t border-ej-line max-h-96 overflow-y-auto scroll">
                <MarkdownWrapper className="select-text prose ej-prose max-w-full text-[13px] leading-[1.6] text-ej-ink2">
                  {refinement}
                </MarkdownWrapper>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </>
  );
};
