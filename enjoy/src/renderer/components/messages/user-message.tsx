import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@renderer/components/ui";
import {
  SpeechPlayer,
  ConversationShortcuts,
  MarkdownWrapper,
} from "@renderer/components";
import { useContext, useState } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import {
  CheckCircleIcon,
  LoaderIcon,
  AlertCircleIcon,
  CopyIcon,
  CheckIcon,
  ForwardIcon,
  MoreVerticalIcon,
} from "lucide-react";
import { useCopyToClipboard } from "@uidotdev/usehooks";
import { t } from "i18next";
import { EjIconButton } from "@renderer/components/enjoy";
import { formatDateTime } from "@renderer/lib/utils";
import { displayableResourceUrl } from "@renderer/lib/retired-resource";

export const UserMessageComponent = (props: {
  message: MessageType;
  configuration?: { [key: string]: any };
  onResend: () => void;
  onRemove: () => void;
}) => {
  const { message, onResend, onRemove } = props;
  const speech = message.speeches?.[0];
  const { user } = useContext(AppSettingsProviderContext);
  const [_, copyToClipboard] = useCopyToClipboard();
  const [copied, setCopied] = useState<boolean>(false);
  return (
    <div id={`message-${message.id}`} className="">
      <div className="mb-2 flex items-center justify-end gap-2">
        <div className="text-xxs font-semibold text-ej-muted">{user.name}</div>
        <Avatar className="size-8">
          <AvatarImage src={displayableResourceUrl(user.avatarUrl)} />
          <AvatarFallback className="bg-ej-accent capitalize text-white">
            {user.name?.[0] ?? "U"}
          </AvatarFallback>
        </Avatar>
      </div>
      <div className="mb-2 flex w-full flex-col gap-2 rounded-[16px_16px_4px_16px] border border-ej-accent-soft2 bg-ej-accent-soft px-3.5 py-2.5">
        <MarkdownWrapper className="message-content prose max-w-full select-text text-ej-ink dark:prose-invert">
          {message.content}
        </MarkdownWrapper>

        {Boolean(speech) && <SpeechPlayer speech={speech} />}

        <DropdownMenu>
          <div className="flex items-center justify-end gap-3 text-ej-muted">
            {message.createdAt ? (
              <CheckCircleIcon
                data-tooltip-id="global-tooltip"
                data-tooltip-content={t("sent")}
                className="size-3.5"
              />
            ) : message.status === "pending" ? (
              <LoaderIcon
                data-tooltip-id="global-tooltip"
                data-tooltip-content={t("sending")}
                className="size-3.5 animate-spin"
              />
            ) : (
              message.status === "error" && (
                <DropdownMenuTrigger>
                  <AlertCircleIcon className="size-3.5 text-ej-bad" />
                </DropdownMenuTrigger>
              )
            )}
            {copied ? (
              <CheckIcon className="size-3.5 text-ej-ok" />
            ) : (
              <CopyIcon
                data-tooltip-id="global-tooltip"
                data-tooltip-content={t("copy")}
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

            <DropdownMenuTrigger asChild>
              <EjIconButton size={22} aria-label={t("more")}>
                <MoreVerticalIcon className="size-3.5" />
              </EjIconButton>
            </DropdownMenuTrigger>
          </div>

          <DropdownMenuContent align="end">
            <DropdownMenuItem className="cursor-pointer" onClick={onResend}>
              <span className="mr-auto capitalize">{t("resend")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" onClick={onRemove}>
              <span className="mr-auto capitalize text-ej-bad">
                {t("remove")}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="timestamp flex justify-end text-xxs text-ej-muted">
        {formatDateTime(message.createdAt)}
      </div>
    </div>
  );
};
