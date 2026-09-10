import { ScrollArea } from "@renderer/components/ui";
import { t } from "i18next";
import { ChatSessionProvider, useLayout } from "@renderer/context";
import {
  ChatAside,
  ChatHeader,
  ChatInput,
  ChatMessages,
} from "@renderer/components";
import { EjEmptyState } from "@renderer/components/enjoy";

export const ChatSession = (props: {
  chatId: string;
  sidePanelCollapsed: boolean;
  toggleSidePanel: () => void;
}) => {
  const { chatId, sidePanelCollapsed, toggleSidePanel } = props;
  const { fluid } = useLayout();

  if (!chatId) {
    return (
      <div className="h-content flex items-center justify-center bg-ej-surface px-6">
        <EjEmptyState
          kicker={t("sidebar.chats")}
          title={t("noChatSelected")}
          description={t("noChatSelectedDescription")}
        />
      </div>
    );
  }

  return (
    <ChatSessionProvider chatId={chatId}>
      <ScrollArea className="h-content relative bg-ej-surface">
        <ChatHeader
          sidePanelCollapsed={sidePanelCollapsed}
          toggleSidePanel={toggleSidePanel}
        />

        <div className="w-full max-w-[760px] fluid:max-w-[860px] mx-auto">
          <ChatMessages />
          <div className="h-64" />
        </div>

        <div className="absolute inset-x-0 bottom-0 px-4 pt-8 pb-4 pointer-events-none bg-gradient-to-t from-ej-surface via-ej-surface to-transparent">
          <div className="w-full max-w-[760px] fluid:max-w-[860px] mx-auto flex pointer-events-auto">
            <ChatInput />
          </div>
        </div>
      </ScrollArea>

      {fluid && <ChatAside />}
    </ChatSessionProvider>
  );
};
