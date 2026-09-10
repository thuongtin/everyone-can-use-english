import { ArrowUpIcon, WandIcon } from "lucide-react";
import {
  Button,
  Popover,
  PopoverAnchor,
  PopoverArrow,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Separator,
  toast,
} from "@renderer/components/ui";
import { ReactElement, useContext, useEffect, useRef, useState } from "react";
import {
  AppSettingsProviderContext,
  ChatSessionProviderContext,
} from "@renderer/context";
import { t } from "i18next";
import { LoaderSpin } from "@renderer/components";
import { useAiCommand } from "@renderer/hooks";
import dayjs from "@renderer/lib/dayjs";
import { ChatMessageRoleEnum } from "@/types/enums";

export const ChatSuggestionButton = (props: {
  chat: ChatType;
  asChild?: boolean;
  children?: ReactElement;
  anchorRef?: React.RefObject<HTMLDivElement>;
}) => {
  const { chat, anchorRef } = props;
  const { chatMessages, createMessage } = useContext(
    ChatSessionProviderContext
  );
  const [suggestions, setSuggestions] = useState<
    { text: string; explaination: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const { EnjoyApp, user } = useContext(AppSettingsProviderContext);

  const { chatSuggestion, suggestionCacheKey } = useAiCommand();

  const context = `I'm ${user.name}.

  [Chat History]
  ${chatMessages
    .filter(
      (m) =>
        m.role === ChatMessageRoleEnum.AGENT ||
        m.role === ChatMessageRoleEnum.USER
    )
    .slice(-10)
    .map((message) => {
      const timestamp = dayjs(message.createdAt).fromNow();
      switch (message.role) {
        case ChatMessageRoleEnum.AGENT:
          return `${message.member.agent.name}: ${message.content} (${timestamp})`;
        case ChatMessageRoleEnum.USER:
          return `${user.name}: ${message.content} (${timestamp})`;
        case ChatMessageRoleEnum.SYSTEM:
          return `(${message.content}, ${timestamp})`;
        default:
          return "";
      }
    })
    .join("\n")}
  `;

  const contextCacheKey = suggestionCacheKey(context);
  const activeKey = useRef(contextCacheKey);
  activeKey.current = contextCacheKey;

  const suggest = async () => {
    setLoading(true);
    chatSuggestion(context, {
      cacheKey: contextCacheKey,
    })
      .then((res) => {
        if (activeKey.current === contextCacheKey) setSuggestions(res.suggestions);
      })
      .catch((err) => {
        toast.error(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (open && !suggestions?.length) {
      suggest();
    }
  }, [open]);

  useEffect(() => {
    let active = true;
    setSuggestions([]);
    EnjoyApp.cacheObjects.get(contextCacheKey).then((result) => {
      if (!active) return;
      if (result && result?.suggestions) {
        setSuggestions(result.suggestions as typeof suggestions);
      } else {
        setSuggestions([]);
      }
    });
    return () => { active = false; };
  }, [contextCacheKey]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {props.asChild ? (
          { ...props.children }
        ) : (
          <Button
            data-tooltip-id={`${chat.id}-tooltip`}
            data-tooltip-content={t("suggestion")}
            className="rounded-full shadow-lg w-8 h-8"
            variant="secondary"
            size="icon"
          >
            <WandIcon className="w-4 h-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent side="top" className="bg-ej-surface2 w-full max-w-screen-md">
        {loading || suggestions.length === 0 ? (
          <LoaderSpin />
        ) : (
          <ScrollArea className="h-72 px-3">
            <div className="select-text grid gap-6">
              {suggestions.map((suggestion, index) => (
                <div key={index} className="grid gap-4">
                  <div className="text-sm">{suggestion.explaination}</div>
                  <div className="px-4 py-2 rounded bg-background flex items-end justify-between space-x-2">
                    <div className="font-sans">{suggestion.text}</div>
                    <div>
                      <Button
                        data-tooltip-id="global-tooltip"
                        data-tooltip-content={t("send")}
                        variant="default"
                        size="icon"
                        className="rounded-full w-6 h-6"
                        onClick={() =>
                          createMessage(suggestion.text, {
                            onSuccess: () => setOpen(false),
                          })
                        }
                      >
                        <ArrowUpIcon className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <Separator />
                </div>
              ))}
              <div className="flex justify-end">
                <Button
                  disabled={loading}
                  variant="default"
                  size="sm"
                  onClick={() => suggest()}
                >
                  {t("refresh")}
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  );
};
