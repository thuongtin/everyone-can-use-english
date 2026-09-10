import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  toast,
} from "@renderer/components/ui";
import { ChatAgentCard, ChatAgentForm } from "@renderer/components";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { t } from "i18next";
import { useDebounce } from "@uidotdev/usehooks";
import { AppSettingsProviderContext } from "@/renderer/context";
import { EjIconButton } from "@renderer/components/enjoy";

export const ChatAgents = (props: {
  chatAgents: ChatAgentType[];
  fetchChatAgents: (query?: string) => void;
  currentChatAgent: ChatAgentType;
  setCurrentChatAgent: (chatAgent: ChatAgentType) => void;
}) => {
  const { currentChatAgent, setCurrentChatAgent, chatAgents, fetchChatAgents } =
    props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [deletingChatAgent, setDeletingChatAgent] =
    useState<ChatAgentType>(null);
  const [editingChatAgent, setEditingChatAgent] = useState<ChatAgentType>(null);
  const [creatingChatAgent, setCreatingChatAgent] = useState<boolean>(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 500);

  const handleDeleteChatAgent = () => {
    if (!deletingChatAgent) return;

    if (currentChatAgent?.id === deletingChatAgent.id) {
      setCurrentChatAgent(null);
    }

    EnjoyApp.chatAgents
      .destroy(deletingChatAgent.id)
      .then(() => {
        toast.success(t("models.chatAgent.deleted"));
        setDeletingChatAgent(null);
      })
      .catch((error) => {
        toast.error(error.message);
      });
  };

  useEffect(() => {
    if (currentChatAgent) return;

    setCurrentChatAgent(chatAgents[0]);
  }, [chatAgents]);

  useEffect(() => {
    fetchChatAgents(debouncedQuery);
  }, [debouncedQuery]);

  return (
    <>
      <div className="h-full flex flex-col min-h-0">
        <div className="shrink-0 px-3 pt-3 pb-2 flex items-center gap-2">
          <div className="flex-1 min-w-0 relative">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ej-muted pointer-events-none" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search")}
              className="w-full h-8 pl-8 pr-3 rounded-full border border-ej-line bg-ej-surface text-xs text-ej-ink placeholder:text-ej-muted outline-none focus:border-ej-accent transition-colors duration-ej"
            />
          </div>
          <EjIconButton
            title={t("newAgent")}
            onClick={() => setCreatingChatAgent(true)}
            className="border border-ej-line bg-ej-surface"
          >
            <PlusIcon className="size-4" />
          </EjIconButton>
        </div>

        <div className="shrink-0 px-4 pb-1.5">
          <div className="ej-label">{t("chatAgents")}</div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scroll px-2 pb-3">
          {chatAgents.length === 0 ? (
            <div className="py-8 text-center text-xxs text-ej-muted">
              {t("noData")}
            </div>
          ) : (
            <div className="grid gap-0.5">
              {chatAgents.map((chatAgent) => (
                <ChatAgentCard
                  key={chatAgent.id}
                  chatAgent={chatAgent}
                  selected={currentChatAgent?.id === chatAgent.id}
                  onSelect={setCurrentChatAgent}
                  onEdit={setEditingChatAgent}
                  onDelete={setDeletingChatAgent}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={!!deletingChatAgent}
        onOpenChange={() => setDeletingChatAgent(null)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{t("deleteChatAgent")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteChatAgentConfirmation")}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingChatAgent(null)}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-ej-bad hover:opacity-90"
              onClick={handleDeleteChatAgent}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!editingChatAgent}
        onOpenChange={() => setEditingChatAgent(null)}
      >
        <DialogContent className="max-w-screen-md max-h-full overflow-auto">
          <DialogTitle className="sr-only">Edit Chat Agent</DialogTitle>
          <DialogDescription className="sr-only">
            Edit chat agent configuration
          </DialogDescription>
          <ChatAgentForm
            agent={editingChatAgent}
            onFinish={() => setEditingChatAgent(null)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={creatingChatAgent} onOpenChange={setCreatingChatAgent}>
        <DialogContent className="max-w-screen-md max-h-full overflow-auto">
          <DialogTitle className="sr-only">Create Chat Agent</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new chat agent
          </DialogDescription>
          <ChatAgentForm
            agent={null}
            onFinish={() => setCreatingChatAgent(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};
