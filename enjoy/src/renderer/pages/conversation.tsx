import { useState, useEffect, useReducer, useContext, useRef } from "react";
import {
  ScrollArea,
  Textarea,
  Sheet,
  SheetContent,
  SheetTrigger,
  toast,
  SheetHeader,
  SheetTitle,
} from "@renderer/components/ui";
import {
  MessageComponent,
  ConversationForm,
  ConversationList,
} from "@renderer/components";
import {
  EjButton,
  EjIconButton,
  Pill,
} from "@renderer/components/enjoy";
import {
  SendIcon,
  LoaderIcon,
  SettingsIcon,
  ChevronLeftIcon,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { t } from "i18next";
import {
  DbProviderContext,
  AppSettingsProviderContext,
  MediaShadowProvider,
  useLayout,
} from "@renderer/context";
import { messagesReducer } from "@renderer/reducers";
import { v4 as uuidv4 } from "uuid";
import autosize from "autosize";
import { useConversation } from "@renderer/hooks";

export default () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [editting, setEditting] = useState<boolean>(false);
  const [conversation, setConversation] = useState<ConversationType>();
  const { addDblistener, removeDbListener } = useContext(DbProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { fluid } = useLayout();
  const [content, setContent] = useState<string>(
    searchParams.get("text") || ""
  );
  const [submitting, setSubmitting] = useState<boolean>(false);

  const [messages, dispatchMessages] = useReducer(messagesReducer, []);
  const [offset, setOffest] = useState(0);
  const [loading, setLoading] = useState<boolean>(false);
  const { chat } = useConversation();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchConversation = async () => {
    const _conversation = await EnjoyApp.conversations.findOne({ id });
    setConversation(_conversation);
  };

  const fetchMessages = async () => {
    if (offset === -1) return;

    const limit = 10;
    setLoading(true);
    EnjoyApp.messages
      .findAll({
        where: {
          conversationId: conversation.id,
        },
        offset,
        limit,
      })
      .then((_messages) => {
        if (_messages.length === 0) {
          setOffest(-1);
          return;
        }

        if (_messages.length < limit) {
          setOffest(-1);
        } else {
          setOffest(offset + _messages.length);
        }

        if (offset === 0) {
          dispatchMessages({ type: "set", records: _messages });
        } else {
          dispatchMessages({ type: "append", records: _messages });
        }
        scrollToMessage(_messages[0]);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handleSubmit = async (text?: string, file?: string) => {
    if (submitting) {
      toast.warning(t("anotherRequestIsPending"));
    }
    text = text ? text : content;

    const message: MessageType = {
      id: uuidv4(),
      content: text,
      role: "user" as MessageRoleEnum,
      conversationId: id,
      status: "pending",
    };

    if (file) {
      message.speeches = [
        {
          id: uuidv4(),
          filePath: file,
          sourceId: message.id,
          sourceType: "Message",
        },
      ];
    }

    dispatchMessages({ type: "create", record: message });
    setSubmitting(true);

    scrollToMessage(message);

    const timeout = setTimeout(() => {
      message.status = "error";
      dispatchMessages({ type: "update", record: message });
      setSubmitting(false);
    }, 1000 * 60 * 5);

    chat(message, { conversation })
      .catch((err) => {
        message.status = "error";
        dispatchMessages({ type: "update", record: message });
        toast.error(err.message);
      })
      .finally(() => {
        setSubmitting(false);
        clearTimeout(timeout);
      });
    setContent("");
  };

  const onMessagesUpdate = (event: CustomEvent) => {
    const { model, action, record } = event.detail || {};
    if (model != "Message") return;
    if (record.conversationId !== id) return;

    if (action === "create") {
      if (record.role === "user") {
        dispatchMessages({ type: "update", record });
      } else {
        dispatchMessages({ type: "create", record });
      }

      scrollToMessage(record);
    } else if (action === "destroy") {
      dispatchMessages({ type: "destroy", record });
    }
  };

  const scrollToMessage = (message: MessageType) => {
    if (!message) return;

    setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;

      container
        .querySelector(`#message-${message.id} .avatar`)
        ?.scrollIntoView({
          behavior: "smooth",
        });

      inputRef.current.focus();
    }, 500);
  };

  const resizeTextarea = () => {
    if (!inputRef?.current) return;

    inputRef.current.style.height = "auto";
    inputRef.current.style.height = inputRef.current.scrollHeight + "px";
  };

  useEffect(() => {
    resizeTextarea();
  }, [content]);

  useEffect(() => {
    setOffest(0);
    setContent(searchParams.get("text") || "");
    dispatchMessages({ type: "set", records: [] });
    fetchConversation();
    addDblistener(onMessagesUpdate);

    return () => {
      removeDbListener(onMessagesUpdate);
    };
  }, [id]);

  useEffect(() => {
    if (!conversation) return;

    fetchMessages();
  }, [conversation]);

  useEffect(() => {
    if (!inputRef.current) return;

    autosize(inputRef.current);

    inputRef.current.addEventListener("keypress", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitRef.current?.click();
      }
    });

    inputRef.current.focus();

    return () => {
      inputRef.current?.removeEventListener("keypress", () => {});
      autosize.destroy(inputRef.current);
    };
  }, [id, inputRef.current]);

  if (!conversation) {
    return (
      <div className="flex h-content w-full items-center justify-center">
        <LoaderIcon className="size-7 animate-spin text-ej-muted" />
      </div>
    );
  }

  const model =
    conversation.type === "tts"
      ? conversation.configuration?.tts?.model
      : conversation.model;

  return (
    <div data-testid="conversation-page" className="flex h-content">
      {fluid && (
        <aside className="flex w-[360px] shrink-0 flex-col border-r border-ej-line bg-ej-side">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-ej-line px-4">
            <span className="ej-label">{t("conversations")}</span>
            <Link
              to="/conversations"
              className="text-xxs font-semibold text-ej-accent-ink hover:underline"
            >
              {t("newConversation")}
            </Link>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3">
              <ConversationList activeId={id} compact />
            </div>
          </ScrollArea>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ej-line bg-ej-surface px-5">
          {!fluid && (
            <Link to="/conversations" aria-label={t("backToConversations")}>
              <EjIconButton>
                <ChevronLeftIcon className="size-4" />
              </EjIconButton>
            </Link>
          )}

          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold text-ej-ink">
              {conversation.name}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Pill tone="muted">{conversation.engine}</Pill>
            {model && <Pill tone="muted">{model}</Pill>}
          </div>

          <Sheet open={editting} onOpenChange={(value) => setEditting(value)}>
            <SheetTrigger asChild>
              <EjIconButton aria-label={t("conversationSettings")}>
                <SettingsIcon className="size-4" />
              </EjIconButton>
            </SheetTrigger>

            <SheetContent
              className="w-[460px] p-0 pt-8 sm:max-w-[460px]"
              aria-describedby={undefined}
            >
              <SheetHeader>
                <SheetTitle className="sr-only">
                  {t("editConversation")}
                </SheetTitle>
              </SheetHeader>
              <div className="h-content">
                <ConversationForm
                  conversation={conversation}
                  onFinish={() => {
                    setEditting(false);
                    fetchConversation();
                  }}
                />
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <MediaShadowProvider>
          <ScrollArea ref={containerRef} className="min-h-0 flex-1">
            <div className="mx-auto w-full max-w-[760px] px-6">
              <div className="messages my-6 flex flex-col-reverse gap-6">
                {messages.map((message) => (
                  <MessageComponent
                    key={message.id}
                    message={message}
                    configuration={{
                      type: conversation.type,
                      ...conversation.configuration,
                    }}
                    onResend={() => {
                      if (message.status === "error") {
                        dispatchMessages({ type: "destroy", record: message });
                      }

                      handleSubmit(message.content);
                    }}
                    onRemove={() => {
                      if (message.status === "error") {
                        dispatchMessages({ type: "destroy", record: message });
                      } else {
                        EnjoyApp.messages.destroy(message.id).catch((err) => {
                          toast.error(err.message);
                        });
                      }
                    }}
                  />
                ))}
                {offset > -1 && (
                  <div className="flex justify-center">
                    <EjButton
                      variant="ghost"
                      size="sm"
                      onClick={() => fetchMessages()}
                      disabled={loading || offset === -1}
                    >
                      {t("loadMore")}
                      {loading && (
                        <LoaderIcon className="size-3.5 animate-spin" />
                      )}
                    </EjButton>
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </MediaShadowProvider>

        <div className="shrink-0 border-t border-ej-line bg-ej-bg px-6 py-3">
          <div className="mx-auto w-full max-w-[760px]">
            <div className="flex items-end gap-3 rounded-ej-lg border border-ej-line bg-ej-surface py-2 pr-2.5 shadow-ej transition-colors duration-ej focus-within:border-ej-accent">
              <Textarea
                ref={inputRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("typeYourMessage")}
                data-testid="conversation-page-input"
                className="max-h-[40vh] min-h-[1rem] resize-none border-none bg-transparent px-4 py-1.5 text-[13px] leading-6 text-ej-ink shadow-none scrollbar-thin !overflow-x-hidden placeholder:text-ej-muted focus-visible:outline-0 focus-visible:ring-0"
              />
              <EjButton
                ref={submitRef}
                variant="primary"
                disabled={submitting || !content}
                data-testid="conversation-page-submit"
                onClick={() => handleSubmit(content)}
                data-tooltip-id="global-tooltip"
                data-tooltip-content={t("send")}
                className="size-9 shrink-0 px-0"
              >
                {submitting ? (
                  <LoaderIcon className="size-4 animate-spin" />
                ) : (
                  <SendIcon className="size-4" />
                )}
              </EjButton>
            </div>
            <p className="mt-1.5 text-center text-xxs text-ej-muted">
              {t("sendMessageHint")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
