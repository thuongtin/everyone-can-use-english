import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui";
import { t } from "i18next";
import { EllipsisIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { displayableResourceUrl } from "@renderer/lib/retired-resource";
import {
  EjIconButton,
  GradientAvatar,
  Pill,
} from "@renderer/components/enjoy";

export const ChatAgentCard = (props: {
  chatAgent: ChatAgentType;
  selected?: boolean;
  onSelect: (chatAgent: ChatAgentType) => void;
  onEdit?: (chatAgent: ChatAgentType) => void;
  onDelete?: (chatAgent: ChatAgentType) => void;
}) => {
  const { chatAgent, selected = false, onSelect, onEdit, onDelete } = props;

  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 px-2.5 py-2 rounded-ej cursor-pointer",
        "border transition-colors duration-ej",
        selected
          ? "bg-ej-surface border-ej-line shadow-ej"
          : "bg-transparent border-transparent hover:bg-ej-surface/70"
      )}
      onClick={() => onSelect(chatAgent)}
    >
      {displayableResourceUrl(chatAgent.avatarUrl) ? (
        <img
          src={displayableResourceUrl(chatAgent.avatarUrl)}
          alt={chatAgent.name}
          className="size-[34px] shrink-0 rounded-full object-cover"
        />
      ) : (
        <GradientAvatar name={chatAgent.name} id={chatAgent.id} size={34} />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0 text-xs font-semibold text-ej-ink truncate">
            {chatAgent.name}
          </div>
          <Pill
            tone="muted"
            className="h-[17px] px-1.5 text-xxxs uppercase tracking-wide"
          >
            {chatAgent.type}
          </Pill>
        </div>
        <div className="text-xxs text-ej-muted truncate">
          {chatAgent.description}
        </div>
      </div>

      {(onEdit || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <EjIconButton
              size={24}
              className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              onClick={(event) => event.stopPropagation()}
            >
              <EllipsisIcon className="size-3.5" />
            </EjIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onEdit && (
              <DropdownMenuItem
                className="cursor-pointer text-xs"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(chatAgent);
                }}
              >
                <span>{t("edit")}</span>
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                className="cursor-pointer text-xs"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(chatAgent);
                }}
              >
                <span className="text-ej-bad">{t("delete")}</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
