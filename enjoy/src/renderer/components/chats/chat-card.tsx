import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui";
import { ChatBubbleIcon } from "@radix-ui/react-icons";
import { EllipsisIcon, SpeechIcon, UsersRoundIcon } from "lucide-react";
import { t } from "i18next";
import dayjs from "@renderer/lib/dayjs";
import { ChatTypeEnum } from "@/types/enums";
import { cn } from "@renderer/lib/utils";
import { EjIconButton } from "@renderer/components/enjoy";

export const ChatCard = (props: {
  chat: ChatType;
  selected: boolean;
  displayDate?: boolean;
  disabled?: boolean;
  onSelect: (chat: ChatType) => void;
  onDelete?: (chat: ChatType) => void;
}) => {
  const {
    chat,
    selected = false,
    displayDate = false,
    disabled = false,
    onSelect,
    onDelete,
  } = props;

  return (
    <div>
      {displayDate && (
        <div className="ej-label mt-3 mb-1.5 px-1">
          {dayjs(chat.updatedAt).fromNow()}
        </div>
      )}

      <div
        className={cn(
          "group flex items-center gap-2 px-2.5 py-2 rounded-ej cursor-pointer",
          "border transition-colors duration-ej",
          selected
            ? "bg-ej-surface border-ej-line shadow-ej"
            : "bg-transparent border-transparent hover:bg-ej-surface/70",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        onClick={() => !disabled && onSelect(chat)}
      >
        <span
          className={cn(
            "shrink-0",
            selected ? "text-ej-accent" : "text-ej-muted"
          )}
        >
          {chat.type === ChatTypeEnum.CONVERSATION && (
            <ChatBubbleIcon className="size-3.5" />
          )}
          {chat.type === ChatTypeEnum.GROUP && (
            <UsersRoundIcon className="size-3.5" />
          )}
          {chat.type === ChatTypeEnum.TTS && <SpeechIcon className="size-3.5" />}
        </span>

        <div className="flex-1 min-w-0 text-xs text-ej-ink truncate">
          {chat.name}
        </div>

        {onDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <EjIconButton
                size={22}
                className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                onClick={(event) => event.stopPropagation()}
              >
                <EllipsisIcon className="size-3.5" />
              </EjIconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="cursor-pointer text-xs"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(chat);
                }}
              >
                <span className="text-ej-bad">{t("delete")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
};
