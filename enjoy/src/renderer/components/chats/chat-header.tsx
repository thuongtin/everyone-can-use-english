import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Switch,
  toast,
} from "@renderer/components/ui";
import {
  ChevronsLeftIcon,
  ChevronsRightIcon,
  SettingsIcon,
} from "lucide-react";
import { useContext, useState } from "react";
import { ChatSettings } from "@renderer/components";
import { t } from "i18next";
import { displayableResourceUrl } from "@renderer/lib/retired-resource";
import { ChatTypeEnum } from "@/types/enums";
import {
  AppSettingsProviderContext,
  ChatSessionProviderContext,
} from "@/renderer/context";
import { EjIconButton, GradientAvatar } from "@renderer/components/enjoy";

export const ChatHeader = (props: {
  sidePanelCollapsed: boolean;
  toggleSidePanel: () => void;
}) => {
  const { sidePanelCollapsed, toggleSidePanel } = props;
  const [displayChatForm, setDisplayChatForm] = useState(false);
  const { chat, chatMembers, chatMessages } = useContext(
    ChatSessionProviderContext
  );
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const primaryMember = chatMembers?.find(
    (member) => member.userType === "ChatAgent"
  );
  const model =
    primaryMember?.config?.gpt?.model || primaryMember?.config?.tts?.model;

  const toggleAutoTts = (value: boolean) => {
    EnjoyApp.chats
      .update(chat.id, {
        name: chat.name,
        config: { ...chat.config, enableAutoTts: value },
      })
      .catch((error) => {
        toast.error(error.message);
      });
  };

  const meta = [
    primaryMember?.agent?.name,
    model,
    t("messagesCount", { count: chatMessages?.length || 0 }),
  ].filter(Boolean);

  return (
    <div className="shrink-0 h-14 px-4 flex items-center gap-3 border-b border-ej-line bg-ej-surface sticky top-0 z-20">
      <EjIconButton
        title={sidePanelCollapsed ? t("expand") : t("collapse")}
        onClick={toggleSidePanel}
      >
        {sidePanelCollapsed ? (
          <ChevronsRightIcon className="size-4" />
        ) : (
          <ChevronsLeftIcon className="size-4" />
        )}
      </EjIconButton>

      {displayableResourceUrl(primaryMember?.agent?.avatarUrl) ? (
        <img
          src={displayableResourceUrl(primaryMember.agent.avatarUrl)}
          alt={primaryMember.agent.name}
          className="size-[30px] shrink-0 rounded-full object-cover"
        />
      ) : (
        <GradientAvatar
          name={primaryMember?.agent?.name || chat.name}
          id={chat.id}
          size={30}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ej-ink truncate">
          {chat.name}
        </div>
        <div className="text-xxs text-ej-muted truncate">
          {meta.join(" · ")}
        </div>
      </div>

      {chat.type !== ChatTypeEnum.TTS && (
        <label className="shrink-0 flex items-center gap-2 cursor-pointer">
          <span className="text-xxs text-ej-muted">{t("autoPlay")}</span>
          <Switch
            checked={Boolean(chat.config?.enableAutoTts)}
            onCheckedChange={toggleAutoTts}
          />
        </label>
      )}

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
          <ChatSettings onFinish={() => setDisplayChatForm(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
};
