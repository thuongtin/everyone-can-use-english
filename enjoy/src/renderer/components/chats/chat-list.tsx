import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  toast,
} from "@renderer/components/ui";
import { t } from "i18next";
import { useContext, useEffect, useState } from "react";
import {
  AISettingsProviderContext,
  AppSettingsProviderContext,
  CopilotProviderContext,
} from "@renderer/context";
import { ChatCard } from "@renderer/components";
import { PlusIcon } from "lucide-react";
import { DEFAULT_GPT_CONFIG } from "@/constants";
import { isSameTimeRange } from "@renderer/lib/utils";
import { ChatAgentTypeEnum } from "@/types/enums";

export const ChatList = (props: {
  chats: ChatType[];
  chatAgent: ChatAgentType;
  currentChat: ChatType;
  setCurrentChat: (chat: ChatType) => void;
}) => {
  const { chats, chatAgent, currentChat, setCurrentChat } = props;
  const { sttEngine, currentGptEngine, ttsConfig } = useContext(
    AISettingsProviderContext
  );
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { currentChat: copilotCurrentChat } = useContext(
    CopilotProviderContext
  );
  const [deletingChat, setDeletingChat] = useState<ChatType>(null);

  const handleCreateChat = () => {
    if (!chatAgent) {
      return;
    }

    EnjoyApp.chats
      .create({
        name: t("newChat"),
        config: {
          sttEngine: sttEngine,
        },
        members: [buildAgentMember(chatAgent)],
      })
      .then((chat) => {
        setCurrentChat(chat);
      })
      .catch((error) => {
        toast.error(error.message);
      });
  };

  const handleDeleteChat = async () => {
    if (!deletingChat) return;

    EnjoyApp.chats
      .destroy(deletingChat.id)
      .catch((error) => {
        toast.error(error.message);
      })
      .finally(() => {
        setDeletingChat(null);
      });
  };

  const buildAgentMember = (agent: ChatAgentType): ChatMemberDtoType => {
    const config =
      agent.type === ChatAgentTypeEnum.TTS
        ? {
            tts: {
              engine: ttsConfig.engine,
              model: ttsConfig.model,
              voice: ttsConfig.voice,
              language: ttsConfig.language,
              ...agent.config.tts,
            },
          }
        : {
            gpt: {
              ...DEFAULT_GPT_CONFIG,
              engine: currentGptEngine.name,
              model: currentGptEngine.models.default,
            },
            tts: {
              engine: ttsConfig.engine,
              model: ttsConfig.model,
              voice: ttsConfig.voice,
              language: ttsConfig.language,
            },
          };
    return {
      userId: agent.id,
      userType: "ChatAgent",
      config,
    };
  };

  useEffect(() => {
    if (!chatAgent) {
      setCurrentChat(null);
      return;
    }

    const currentAgentNotInvolved =
      currentChat?.members?.findIndex(
        (member) => member.userId === chatAgent?.id
      ) === -1;
    const currentChatIsNotFound =
      chats?.findIndex((chat) => chat.id === currentChat?.id) === -1;

    if (!currentChat || currentAgentNotInvolved || currentChatIsNotFound) {
      const chat = chats.find((chat) => chat.id !== copilotCurrentChat?.id);
      if (chat) {
        setCurrentChat(chat);
      } else {
        setCurrentChat(null);
      }
    }
  }, [chats, chatAgent]);

  return (
    <>
      <div className="h-full flex flex-col min-h-0">
        <div className="shrink-0 px-3 pt-3 pb-2">
          <button
            type="button"
            disabled={!chatAgent}
            onClick={handleCreateChat}
            className="w-full h-8 rounded-full bg-ej-ink text-ej-bg text-xs font-semibold flex items-center justify-center gap-1.5 transition-opacity duration-ej hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none"
          >
            <PlusIcon className="size-3.5" />
            {t("newChat")}
          </button>
        </div>

        <div className="shrink-0 px-4 pb-1">
          <div className="ej-label">{t("recentChats")}</div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scroll px-2 pb-3">
          {chats.length === 0 ? (
            <div className="py-8 text-center text-xxs text-ej-muted">
              {t("noData")}
            </div>
          ) : (
            <div className="grid gap-0.5">
              {chats.map((chat, index) => (
                <ChatCard
                  key={chat.id}
                  chat={chat}
                  displayDate={
                    index === 0 ||
                    !isSameTimeRange(chat.updatedAt, chats[index - 1].updatedAt)
                  }
                  selected={currentChat?.id === chat.id}
                  onSelect={setCurrentChat}
                  onDelete={setDeletingChat}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={!!deletingChat}
        onOpenChange={() => setDeletingChat(null)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{t("deleteChat")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteChatConfirmation")}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingChat(null)}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-ej-bad hover:opacity-90"
              onClick={handleDeleteChat}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
