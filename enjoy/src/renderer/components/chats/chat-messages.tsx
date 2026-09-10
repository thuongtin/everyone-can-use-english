import { ChatSessionProviderContext } from "@renderer/context";
import { ChatAgentForm, ChatMemberForm, ChatMessage } from "@renderer/components";
import { useContext, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@renderer/components/ui";
import { ChatAgentTypeEnum } from "@/types/enums";
import { GradientAvatar, TypingDots } from "@renderer/components/enjoy";
import { displayableResourceUrl } from "@renderer/lib/retired-resource";

export const ChatMessages = () => {
  const { chatMessages, chat, asking } = useContext(ChatSessionProviderContext);
  const [editingChatMember, setEditingChatMember] =
    useState<ChatMemberType>(null);

  return (
    <>
      <div className="flex-1 px-4 pt-5">
        {chatMessages.map((message) => (
          <ChatMessage
            key={message.id}
            chatMessage={message}
            isLastMessage={
              chatMessages[chatMessages.length - 1]?.id === message.id
            }
            onEditChatMember={setEditingChatMember}
          />
        ))}
        {asking?.chatId === chat.id && (
          <ChatAgentMessageLoading
            chatMember={asking}
            onClick={() => setEditingChatMember(asking)}
          />
        )}
      </div>
      <Dialog
        open={!!editingChatMember}
        onOpenChange={() => setEditingChatMember(null)}
      >
        <DialogContent className="max-w-screen-sm max-h-[70%] overflow-y-auto">
          <DialogTitle>{editingChatMember?.agent?.name}</DialogTitle>
          <DialogDescription className="sr-only">
            Edit chat member
          </DialogDescription>
          {editingChatMember?.agent?.type === ChatAgentTypeEnum.GPT && (
            <ChatMemberForm
              chat={chat}
              member={editingChatMember}
              onFinish={() => setEditingChatMember(null)}
            />
          )}
          {editingChatMember?.agent?.type === ChatAgentTypeEnum.TTS && (
            <ChatAgentForm
              agent={editingChatMember.agent}
              onFinish={() => setEditingChatMember(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

const ChatAgentMessageLoading = (props: {
  chatMember: ChatMemberType;
  onClick: () => void;
}) => {
  const { chatMember, onClick } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [ref]);

  if (!chatMember.agent) return null;

  const model =
    chatMember.agent.type === ChatAgentTypeEnum.TTS
      ? chatMember.config?.tts?.voice
      : chatMember.config?.gpt?.model;

  return (
    <div ref={ref} className="mb-6 flex gap-2.5">
      <button
        type="button"
        onClick={onClick}
        className="shrink-0 rounded-full overflow-hidden"
      >
        {displayableResourceUrl(chatMember.agent.avatarUrl) ? (
          <img
            src={displayableResourceUrl(chatMember.agent.avatarUrl)}
            alt={chatMember.name}
            className="size-[34px] rounded-full object-cover"
          />
        ) : (
          <GradientAvatar
            name={chatMember.name}
            id={chatMember.userId}
            size={34}
          />
        )}
      </button>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-ej-ink truncate">
            {chatMember.name}
          </span>
          {model && (
            <span className="text-xxxs text-ej-muted truncate">{model}</span>
          )}
        </div>
        <div className="mt-1.5 inline-flex items-center h-8 rounded-ej border border-ej-line bg-ej-surface2 px-3">
          <TypingDots />
        </div>
      </div>
    </div>
  );
};
