import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  ScrollArea,
  toast,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@renderer/components/ui";
import {
  ChevronDownIcon,
  LightbulbIcon,
  PlusIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { useContext, useState } from "react";
import {
  ChatSettings,
  CopilotChatAgents,
  CopilotChats,
} from "@renderer/components";
import { EjIconButton } from "@renderer/components/enjoy";
import { t } from "i18next";
import {
  AppSettingsProviderContext,
  CopilotProviderContext,
} from "@renderer/context";

export const CopilotHeader = () => {
  const [displayChatForm, setDisplayChatForm] = useState(false);
  const [displayChats, setDisplayChats] = useState(false);
  const [displayChatAgents, setDisplayChatAgents] = useState(false);
  const {
    currentChat,
    active,
    setActive,
    occupiedChat,
    setCurrentChat,
    buildAgentMember,
  } = useContext(CopilotProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const member = currentChat?.members?.[0];
  const model = member?.config?.gpt?.model;
  const subtitle = [member?.name ?? currentChat?.name, model]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="h-[46px] shrink-0 border-b border-ej-line px-2.5 flex items-center gap-2 sticky top-0 z-10 bg-ej-surface">
      <Popover open={displayChats} onOpenChange={setDisplayChats}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 min-w-0 flex-1 rounded-lg px-1 py-1 hover:bg-ej-surface2 transition-colors duration-ej"
          >
            <span className="size-7 rounded-lg bg-ej-accent-soft flex items-center justify-center shrink-0">
              <LightbulbIcon className="size-4 text-ej-accent-ink" />
            </span>
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className="block text-[13px] font-semibold text-ej-ink truncate">
                {t("copilot.title")}
              </span>
              <span className="block text-[11px] text-ej-muted truncate">
                {subtitle || t("copilot.noChat")}
              </span>
            </span>
            <ChevronDownIcon className="size-3.5 text-ej-muted shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="overflow-y-auto max-h-96">
          <CopilotChats
            onSelect={(chat) => {
              if (occupiedChat?.id !== chat.id) {
                setCurrentChat(chat);
              }
              setDisplayChats(false);
            }}
          />
        </PopoverContent>
      </Popover>

      <div className="flex items-center gap-0.5 shrink-0">
        <Popover open={displayChatAgents} onOpenChange={setDisplayChatAgents}>
          <PopoverTrigger asChild>
            <EjIconButton title={t("newChat")}>
              <PlusIcon className="size-4" />
            </EjIconButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="overflow-y-auto max-h-96">
            <CopilotChatAgents
              onSelect={(agent) => {
                EnjoyApp.chats
                  .create({
                    name: t("newChat"),
                    config: {
                      sttEngine: currentChat?.config.sttEngine,
                    },
                    members: [buildAgentMember(agent)],
                  })
                  .then((newChat) => {
                    setCurrentChat(newChat);
                  })
                  .catch((error) => {
                    toast.error(error.message);
                  })
                  .finally(() => {
                    setDisplayChatAgents(false);
                  });
              }}
            />
          </PopoverContent>
        </Popover>

        {currentChat && (
          <Dialog open={displayChatForm} onOpenChange={setDisplayChatForm}>
            <DialogTrigger asChild>
              <EjIconButton title={t("editChat")}>
                <SettingsIcon className="size-4" />
              </EjIconButton>
            </DialogTrigger>
            <DialogContent className="max-w-screen-sm max-h-[70%] overflow-y-auto">
              <DialogTitle>{t("editChat")}</DialogTitle>
              <DialogDescription className="sr-only">
                Edit chat settings
              </DialogDescription>
              <ScrollArea className="h-full px-4">
                <ChatSettings onFinish={() => setDisplayChatForm(false)} />
              </ScrollArea>
            </DialogContent>
          </Dialog>
        )}

        <EjIconButton title={t("close")} onClick={() => setActive(!active)}>
          <XIcon className="size-4" />
        </EjIconButton>
      </div>
    </div>
  );
};
