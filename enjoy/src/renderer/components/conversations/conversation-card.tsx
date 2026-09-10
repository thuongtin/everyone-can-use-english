import { EllipsisIcon, MessageCircleIcon, SpeechIcon } from "lucide-react";
import dayjs from "@renderer/lib/dayjs";
import { useContext } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from "@renderer/components/ui";
import { EjIconButton, Pill } from "@renderer/components/enjoy";
import { cn } from "@renderer/lib/utils";
import { t } from "i18next";

export const ConversationCard = (props: {
  conversation: ConversationType;
  /** Highlights the row that is open in the reading pane. */
  active?: boolean;
  /** Denser row used by the fluid sidebar. */
  compact?: boolean;
}) => {
  const { conversation, active, compact } = props;
  const { EnjoyApp, learningLanguage } = useContext(AppSettingsProviderContext);

  const handleDelete = () => {
    EnjoyApp.conversations.destroy(conversation.id).then(() => {
      toast.success(t("conversationDeleted"));
    });
  };

  const handleMigrate = () => {
    EnjoyApp.conversations
      .migrate(conversation.id)
      .then(() => {
        toast.success(t("conversationMigrated"));
      })
      .catch((error) => {
        toast.error(error.message);
      });
  };

  const model =
    conversation.type === "tts"
      ? conversation.configuration?.tts?.model
      : conversation.model;

  return (
    <div
      data-testid={`conversation-card-${conversation.id}`}
      className={cn(
        "group flex items-center gap-3 rounded-ej border bg-ej-surface cursor-pointer",
        "transition-all duration-ej hover:-translate-y-0.5 hover:shadow-ej",
        compact ? "px-3 py-2.5" : "px-4 py-3 mb-2",
        active
          ? "border-ej-accent bg-ej-accent-soft"
          : "border-ej-line hover:border-ej-line2"
      )}
    >
      <span
        className={cn(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-[10px]",
          active
            ? "bg-ej-accent text-white"
            : "bg-ej-surface2 text-ej-accent-ink"
        )}
      >
        {conversation.type === "tts" ? (
          <SpeechIcon className="size-4" />
        ) : (
          <MessageCircleIcon className="size-4" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-ej-ink">
          {conversation.name}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Pill tone="muted">{conversation.engine}</Pill>
          {model && <Pill tone="muted">{model}</Pill>}
          {!compact && (
            <Pill tone="muted">
              {conversation.language || learningLanguage}
            </Pill>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="ej-tabular text-xxs text-ej-muted">
          {dayjs(conversation.createdAt).format("HH:mm l")}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <EjIconButton
              onClick={(event) => event.preventDefault()}
              aria-label={t("more")}
            >
              <EllipsisIcon className="size-3.5" />
            </EjIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={(event) => {
                event.stopPropagation();
                handleMigrate();
              }}
            >
              <span>{t("migrateToChat")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(event) => {
                event.stopPropagation();
                handleDelete();
              }}
            >
              <span className="text-ej-bad">{t("delete")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
