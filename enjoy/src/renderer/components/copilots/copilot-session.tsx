import { ChatSessionProvider, CopilotProviderContext } from "@renderer/context";
import { useContext, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@renderer/components/ui";
import { t } from "i18next";
import {
  ChatMessages,
  ChatInput,
  CopilotHeader,
  CopilotChatAgents,
} from "@renderer/components";
import { AppSettingsProviderContext } from "@renderer/context";
import { LightbulbIcon, PlusIcon } from "lucide-react";

/** Route prefix to the label shown in the "context" chip, longest match wins. */
const CONTEXT_LABELS: [string, string][] = [
  ["/audios", "sidebar.audios"],
  ["/videos", "sidebar.videos"],
  ["/documents", "sidebar.documents"],
  ["/stories", "sidebar.stories"],
  ["/learning-studio", "sidebar.learningStudio"],
  ["/conversations", "sidebar.aiAssistant"],
  ["/pronunciation_assessments", "sidebar.pronunciationAssessment"],
  ["/vocabulary", "sidebar.vocabulary"],
  ["/notes", "sidebar.notes"],
  ["/dictionary", "sidebar.dictionary"],
  ["/chats", "sidebar.chats"],
  ["/profile", "sidebar.profileStats"],
];

const contextLabel = (pathname: string) => {
  const match = CONTEXT_LABELS.filter(([prefix]) =>
    pathname.startsWith(prefix)
  ).sort((a, b) => b[0].length - a[0].length)[0];

  return t(match ? match[1] : "sidebar.home");
};

export const CopilotSession = () => {
  const { currentChat } = useContext(CopilotProviderContext);
  const location = useLocation();

  return (
    <div className="h-content flex flex-col bg-ej-surface">
      {currentChat?.id ? (
        <ChatSessionProvider chatId={currentChat.id}>
          <CopilotHeader />
          <div className="px-3 pt-2.5 shrink-0">
            <span className="inline-flex items-center max-w-full gap-1.5 h-6 px-2.5 rounded-full bg-ej-surface2 text-[11px] text-ej-ink2">
              <span className="size-1.5 rounded-full bg-ej-accent shrink-0" />
              <span className="truncate">
                {t("copilot.context")}: {contextLabel(location.pathname)}
              </span>
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-1">
            <ChatMessages />
          </div>
          <div className="shrink-0 border-t border-ej-line px-2 py-2">
            <ChatInput />
          </div>
        </ChatSessionProvider>
      ) : (
        <CopilotEmptyState />
      )}
    </div>
  );
};

const CopilotEmptyState = () => {
  const { setCurrentChat, buildAgentMember } = useContext(
    CopilotProviderContext
  );
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [displayChatAgents, setDisplayChatAgents] = useState(false);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="size-11 rounded-xl bg-ej-accent-soft flex items-center justify-center">
        <LightbulbIcon className="size-5 text-ej-accent-ink" />
      </span>
      <div>
        <div className="text-[15px] font-bold text-ej-ink">
          {t("copilot.title")}
        </div>
        <p className="mt-1 text-xs text-ej-muted max-w-[240px]">
          {t("copilot.emptyHint")}
        </p>
      </div>
      <Popover open={displayChatAgents} onOpenChange={setDisplayChatAgents}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-9 px-4 rounded-xl bg-ej-ink text-ej-bg text-[13px] font-semibold inline-flex items-center gap-1.5 transition-opacity duration-ej hover:opacity-85"
          >
            <PlusIcon className="size-4" />
            {t("newChat")}
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="overflow-y-auto max-h-96">
          <CopilotChatAgents
            onSelect={(agent) => {
              EnjoyApp.chats
                .create({
                  name: t("newChat"),
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
    </div>
  );
};
