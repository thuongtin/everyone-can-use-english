import { ChatSession, ChatAgents, ChatList } from "@renderer/components";
import { useState, useContext, useEffect } from "react";
import { CopilotProviderContext, useLayout } from "@renderer/context";
import { useChat, useChatAgent } from "@renderer/hooks";

export default function Chats() {
  const [currentChat, setCurrentChat] = useState<ChatType | null>(null);
  const [currentChatAgent, setCurrentChatAgent] =
    useState<ChatAgentType | null>(null);
  const { currentChat: copilotCurrentChat, setOccupiedChat } = useContext(
    CopilotProviderContext
  );
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  const { fluid } = useLayout();

  const { chats } = useChat(currentChatAgent?.id);
  const { chatAgents, fetchChatAgents } = useChatAgent();

  // Do not open the same chat in copilot and main window
  const handleSelectChat = (chat: ChatType) => {
    if (chat && copilotCurrentChat?.id === chat.id) return;
    setCurrentChat(chat);
  };

  // set occupied chat when current chat changes
  useEffect(() => {
    if (currentChat) {
      setOccupiedChat(currentChat);
    }

    return () => {
      setOccupiedChat(null);
    };
  }, [currentChat]);

  const asideColumn = fluid && currentChat ? " 300px" : "";
  const gridTemplateColumns = sidePanelCollapsed
    ? `minmax(0, 1fr)${asideColumn}`
    : fluid
      ? `260px 260px minmax(0, 1fr)${asideColumn}`
      : `280px minmax(0, 1fr)`;

  const agents = (
    <ChatAgents
      chatAgents={chatAgents}
      fetchChatAgents={fetchChatAgents}
      currentChatAgent={currentChatAgent}
      setCurrentChatAgent={setCurrentChatAgent}
    />
  );

  const list = (
    <ChatList
      chats={chats}
      chatAgent={currentChatAgent}
      currentChat={currentChat}
      setCurrentChat={handleSelectChat}
    />
  );

  return (
    <div className="h-content grid" style={{ gridTemplateColumns }}>
      {!sidePanelCollapsed &&
        (fluid ? (
          <>
            <div className="min-h-0 border-r border-ej-line bg-ej-side">
              {agents}
            </div>
            <div className="min-h-0 border-r border-ej-line bg-ej-side">
              {list}
            </div>
          </>
        ) : (
          <div className="min-h-0 grid grid-rows-[minmax(0,42%)_minmax(0,58%)] border-r border-ej-line bg-ej-side">
            <div className="min-h-0 border-b border-ej-line">{agents}</div>
            <div className="min-h-0">{list}</div>
          </div>
        ))}

      <ChatSession
        chatId={currentChat?.id}
        sidePanelCollapsed={sidePanelCollapsed}
        toggleSidePanel={() => setSidePanelCollapsed(!sidePanelCollapsed)}
      />
    </div>
  );
}
