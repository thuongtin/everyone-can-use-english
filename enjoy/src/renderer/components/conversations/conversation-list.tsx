import { useContext, useEffect, useReducer, useState } from "react";
import { Link } from "react-router-dom";
import { LoaderIcon } from "lucide-react";
import { t } from "i18next";

import { AppSettingsProviderContext, DbProviderContext } from "@renderer/context";
import { conversationsReducer } from "@renderer/reducers";
import { toast } from "@renderer/components/ui";
import { EjButton, EjEmptyState } from "@renderer/components/enjoy";
import { cn } from "@renderer/lib/utils";
import { ConversationCard } from "./conversation-card";

const PAGE_SIZE = 10;

/**
 * Paginated conversation list shared by the index page and the fluid sidebar
 * of a single conversation.
 */
export const ConversationList = (props: {
  /** Conversation currently open in the reading pane. */
  activeId?: string;
  /** Denser rows, used inside the 360px fluid aside. */
  compact?: boolean;
  /** Called when a new conversation is written by the main process. */
  onCreated?: (conversation: ConversationType) => void;
  /** Rendered instead of the built-in empty state. */
  emptyAction?: React.ReactNode;
  className?: string;
}) => {
  const { activeId, compact, onCreated, emptyAction, className } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { addDblistener, removeDbListener } = useContext(DbProviderContext);
  const [conversations, dispatchConversations] = useReducer(
    conversationsReducer,
    []
  );
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [loaded, setLoaded] = useState<boolean>(false);

  const fetchConversations = async (offset: number) => {
    setLoading(true);
    EnjoyApp.conversations
      .findAll({
        order: [["updatedAt", "DESC"]],
        limit: PAGE_SIZE,
        offset,
      })
      .then((records) => {
        setHasMore(records.length >= PAGE_SIZE);
        if (records.length === 0) return;

        dispatchConversations({
          type: offset === 0 ? "set" : "append",
          records,
        });
      })
      .catch((error) => {
        toast.error(error.message);
      })
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  };

  const onConversationsUpdate = (event: CustomEvent) => {
    const { model, action, record } = event.detail || {};
    if (model !== "Conversation") return;

    if (action === "destroy") {
      dispatchConversations({ type: "destroy", record });
    } else if (action === "create") {
      dispatchConversations({ type: "create", record });
      onCreated?.(record);
    }
  };

  useEffect(() => {
    fetchConversations(0);
    addDblistener(onConversationsUpdate);

    return () => {
      removeDbListener(onConversationsUpdate);
    };
  }, []);

  if (loaded && conversations.length === 0 && !compact) {
    return (
      <EjEmptyState
        kicker={t("conversations")}
        title={t("noConversationsYet")}
        description={t("noConversationsYetDescription")}
        actions={emptyAction}
      />
    );
  }

  return (
    <div className={cn(compact && "space-y-1.5", className)}>
      {conversations.map((conversation) => (
        <Link key={conversation.id} to={`/conversations/${conversation.id}`}>
          <ConversationCard
            conversation={conversation}
            compact={compact}
            active={conversation.id === activeId}
          />
        </Link>
      ))}

      {hasMore && (
        <div className={cn("flex justify-center", compact ? "pt-1.5" : "pt-2")}>
          <EjButton
            variant="ghost"
            size={compact ? "sm" : "md"}
            onClick={() => fetchConversations(conversations.length)}
            disabled={loading}
          >
            {t("loadMore")}
            {loading && <LoaderIcon className="size-3.5 animate-spin" />}
          </EjButton>
        </div>
      )}
    </div>
  );
};
