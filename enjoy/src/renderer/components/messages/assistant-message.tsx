import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetClose,
  toast,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  SheetTitle,
} from "@renderer/components/ui";
import {
  SpeechPlayer,
  AudioPlayer,
  ConversationShortcuts,
  MarkdownWrapper,
} from "@renderer/components";
import { useState, useEffect, useContext } from "react";
import {
  LoaderIcon,
  CopyIcon,
  CheckIcon,
  SpeechIcon,
  MicIcon,
  ChevronDownIcon,
  ForwardIcon,
  AlertCircleIcon,
  MoreVerticalIcon,
  DownloadIcon,
} from "lucide-react";
import { useCopyToClipboard } from "@uidotdev/usehooks";
import { t } from "i18next";
import { AppSettingsProviderContext } from "@renderer/context";
import { useSpeech, useAiCommand } from "@renderer/hooks";
import { EjIconButton } from "@renderer/components/enjoy";
import { formatDateTime } from "@renderer/lib/utils";

export const AssistantMessageComponent = (props: {
  message: MessageType;
  configuration: { [key: string]: any };
  onRemove: () => void;
}) => {
  const { message, configuration, onRemove } = props;
  const [_, copyToClipboard] = useCopyToClipboard();
  const [copied, setCopied] = useState<boolean>(false);
  const [speech, setSpeech] = useState<Partial<SpeechType>>(
    message.speeches?.[0]
  );
  const [speeching, setSpeeching] = useState<boolean>(false);
  const [resourcing, setResourcing] = useState<boolean>(false);
  const [shadowing, setShadowing] = useState<boolean>(false);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { tts } = useSpeech();
  const { summarizeTopic } = useAiCommand();

  useEffect(() => {
    if (speech) return;
    if (configuration?.type !== "tts") return;

    findOrCreateSpeech();
  }, [message]);

  const findOrCreateSpeech = async () => {
    const msg = await EnjoyApp.messages.findOne({ id: message.id });
    if (msg && msg.speeches.length > 0) {
      setSpeech(msg.speeches[0]);
    } else {
      createSpeech();
    }
  };

  const createSpeech = () => {
    if (speeching) return;

    setSpeeching(true);

    tts({
      sourceType: "Message",
      sourceId: message.id,
      text: message.content,
      configuration: configuration.tts,
    })
      .then((speech) => {
        setSpeech(speech);
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

    const audio = await EnjoyApp.audios.findOne({
      md5: speech.md5,
    });

    if (!audio) {
      setResourcing(true);
      let title =
        speech.text.length > 20
          ? speech.text.substring(0, 17).trim() + "..."
          : speech.text;

      try {
        title = await summarizeTopic(speech.text);
      } catch (e) {
        console.warn(e);
      }

      await EnjoyApp.audios.create(speech.filePath, {
        name: title,
        originalText: speech.text,
      });
      setResourcing(false);
    }

    setShadowing(true);
  };

  const handleDownload = async () => {
    if (!speech) return;

    EnjoyApp.dialog
      .showSaveDialog({
        title: t("download"),
        defaultPath: speech.filename,
        filters: [
          {
            name: "Audio",
            extensions: [speech.filename.split(".").pop()],
          },
        ],
      })
      .then((savePath) => {
        if (!savePath) return;

        toast.promise(EnjoyApp.download.start(speech.src, savePath as string), {
          loading: t("downloadingFile", { file: speech.filename }),
          success: () => t("downloadedSuccessfully"),
          error: t("downloadFailed"),
          position: "bottom-right",
        });
      })
      .catch((err) => {
        toast.error(err.message);
      });
  };

  return (
    <div id={`message-${message.id}`} className="ai-message">
      <div className="mb-2 flex items-center gap-2">
        <Avatar className="avatar size-8">
          <AvatarImage></AvatarImage>
          <AvatarFallback className="bg-ej-surface2 capitalize text-ej-ink2">
            {configuration?.model?.[0] || "AI"}
          </AvatarFallback>
        </Avatar>
        <div className="text-xxs font-semibold text-ej-muted">
          {configuration?.model}
        </div>
      </div>
      <div className="mb-2 flex w-full flex-col gap-2 rounded-[16px_16px_16px_4px] border border-ej-line bg-ej-surface px-3.5 py-2.5">
        {configuration.type === "tts" &&
          (speeching ? (
            <div className="py-2 text-xs text-ej-muted">
              <span>{t("creatingSpeech")}</span>
            </div>
          ) : (
            !speech && (
              <div className="flex items-center py-2 text-xs text-ej-muted">
                <AlertCircleIcon className="mr-2 size-3.5 text-ej-warn" />
                <span>{t("speechNotCreatedYet")}</span>
              </div>
            )
          ))}

        {configuration.type === "gpt" && (
          <MarkdownWrapper
            className="message-content prose max-w-full select-text text-ej-ink dark:prose-invert"
            data-source-type="Message"
            data-source-id={message.id}
          >
            {message.content}
          </MarkdownWrapper>
        )}

        {Boolean(speech) && <SpeechPlayer speech={speech} />}

        <DropdownMenu>
          <div className="flex items-center justify-start gap-3 text-ej-muted">
            {!speech &&
              (speeching ? (
                <LoaderIcon
                  data-tooltip-id="global-tooltip"
                  data-tooltip-content={t("creatingSpeech")}
                  className="size-3.5 animate-spin"
                />
              ) : (
                <SpeechIcon
                  data-tooltip-id="global-tooltip"
                  data-tooltip-content={t("textToSpeech")}
                  data-testid="message-create-speech"
                  onClick={createSpeech}
                  className="size-3.5 cursor-pointer transition-colors duration-ej hover:text-ej-ink"
                />
              ))}

            {configuration.type === "gpt" && (
              <>
                {copied ? (
                  <CheckIcon className="size-3.5 text-ej-ok" />
                ) : (
                  <CopyIcon
                    data-tooltip-id="global-tooltip"
                    data-tooltip-content={t("copyText")}
                    className="size-3.5 cursor-pointer transition-colors duration-ej hover:text-ej-ink"
                    onClick={() => {
                      copyToClipboard(message.content);
                      setCopied(true);
                      setTimeout(() => {
                        setCopied(false);
                      }, 3000);
                    }}
                  />
                )}
                <ConversationShortcuts
                  prompt={message.content}
                  excludedIds={[message.conversationId]}
                  trigger={
                    <ForwardIcon
                      data-tooltip-id="global-tooltip"
                      data-tooltip-content={t("forward")}
                      className="size-3.5 cursor-pointer transition-colors duration-ej hover:text-ej-ink"
                    />
                  }
                />
              </>
            )}

            {Boolean(speech) &&
              (resourcing ? (
                <LoaderIcon
                  data-tooltip-id="global-tooltip"
                  data-tooltip-content={t("addingResource")}
                  className="size-3.5 animate-spin"
                />
              ) : (
                <MicIcon
                  data-tooltip-id="global-tooltip"
                  data-tooltip-content={t("shadowingExercise")}
                  data-testid="message-start-shadow"
                  onClick={startShadow}
                  className="size-3.5 cursor-pointer transition-colors duration-ej hover:text-ej-ink"
                />
              ))}
            {Boolean(speech) && (
              <DownloadIcon
                data-tooltip-id="global-tooltip"
                data-tooltip-content={t("download")}
                data-testid="message-download-speech"
                onClick={handleDownload}
                className="size-3.5 cursor-pointer transition-colors duration-ej hover:text-ej-ink"
              />
            )}

            <DropdownMenuTrigger asChild>
              <EjIconButton size={22} aria-label={t("more")}>
                <MoreVerticalIcon className="size-3.5" />
              </EjIconButton>
            </DropdownMenuTrigger>
          </div>

          <DropdownMenuContent align="start">
            <DropdownMenuItem className="cursor-pointer" onClick={onRemove}>
              <span className="mr-auto capitalize text-ej-bad">
                {t("delete")}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="timestamp flex justify-start text-xxs text-ej-muted">
        {formatDateTime(message.createdAt)}
      </div>

      <Sheet
        modal={false}
        open={shadowing}
        onOpenChange={(value) => setShadowing(value)}
      >
        <SheetContent
          container="main-panel-content"
          aria-describedby={undefined}
          side="bottom"
          className="flex h-content flex-col gap-0 border-ej-line bg-ej-bg p-0"
          displayClose={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <SheetHeader className="flex items-center justify-center space-y-0 py-1">
            <SheetTitle className="sr-only">{t("shadow")}</SheetTitle>
            <SheetClose asChild>
              <EjIconButton aria-label={t("close")}>
                <ChevronDownIcon className="size-4" />
              </EjIconButton>
            </SheetClose>
          </SheetHeader>

          {Boolean(speech) && shadowing && <AudioPlayer md5={speech.md5} />}
        </SheetContent>
      </Sheet>
    </div>
  );
};
