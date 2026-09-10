import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Form,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Switch,
  Textarea,
  toast,
} from "@renderer/components/ui";
import { t } from "i18next";
import { useContext } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import Mustache from "mustache";
import { GPTForm, TTSForm } from "@renderer/components";
import { EjButton } from "@renderer/components/enjoy";

export const ChatMemberForm = (props: {
  chat: ChatType;
  member: Partial<ChatMemberType>;
  onFinish?: () => void;
  onDelete?: () => void;
}) => {
  const { member, onFinish, chat, onDelete } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const buildFullPrompt = (prompt: string) => {
    return Mustache.render(
      `{{{agent_prompt}}}

{{{chat_prompt}}}

{{{member_prompt}}}`,
      {
        agent_prompt: member.agent.prompt,
        chat_prompt: chat.config.prompt,
        member_prompt: prompt,
      }
    ).trim();
  };

  const chatMemberFormSchema = z.object({
    chatId: z.string(),
    userId: z.string(),
    userType: z.enum(["User", "ChatAgent"]).default("ChatAgent"),
    config: z.object({
      prompt: z.string().optional(),
      replyOnlyWhenMentioned: z.boolean().default(false),
      gpt: z.object({
        engine: z.string(),
        model: z.string(),
        temperature: z.number(),
        maxCompletionTokens: z.number().optional(),
        frequencyPenalty: z.number().optional(),
        presencePenalty: z.number().optional(),
        numberOfChoices: z.number().optional(),
        historyBufferSize: z.number().optional(),
      }),
      tts: z.object({
        engine: z.string(),
        model: z.string(),
        voice: z.string(),
        language: z.string(),
      }),
    }),
  });

  const form = useForm<z.infer<typeof chatMemberFormSchema>>({
    resolver: zodResolver(chatMemberFormSchema),
    values: {
      chatId: chat.id,
      ...member,
    },
  });

  const onSubmit = form.handleSubmit(
    (data: z.infer<typeof chatMemberFormSchema>) => {
      if (member?.id) {
        EnjoyApp.chatMembers
          .update(member.id, data)
          .then(() => {
            toast.success(t("chatMemberUpdated"));
            onFinish?.();
          })
          .catch((error) => {
            toast.error(error.message);
          });
      } else {
        EnjoyApp.chatMembers
          .create(data)
          .then(() => {
            toast.success(t("chatMemberAdded"));
            onFinish?.();
          })
          .catch((error) => {
            toast.error(error.message);
          });
      }
    }
  );

  const handleRemove = () => {
    if (!member.id) return;

    EnjoyApp.chatMembers
      .destroy(member.id)
      .then(() => {
        toast.success(t("chatMemberRemoved"));
        onDelete?.();
      })
      .catch((error) => {
        toast.error(error.message);
      });
  };

  if (!member) return null;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit}>
        <FormField
          control={form.control}
          name="config.replyOnlyWhenMentioned"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center space-x-2">
                <FormLabel>{t("replyOnlyWhenMentioned")}</FormLabel>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </div>
              <FormDescription>
                {t("replyOnlyWhenMentionedDescription")}
              </FormDescription>
            </FormItem>
          )}
        />
        <Accordion
          defaultValue="gpt"
          type="single"
          collapsible
          className="mb-6"
        >
          <AccordionItem value="gpt">
            <AccordionTrigger className="text-xs font-semibold text-ej-ink2">
              {t("models.chatMember.gptSettings")}
            </AccordionTrigger>
            <AccordionContent className="space-y-4 px-2">
              <GPTForm form={form} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="tts">
            <AccordionTrigger className="text-xs font-semibold text-ej-ink2">
              {t("models.chatMember.ttsSettings")}
            </AccordionTrigger>
            <AccordionContent className="space-y-4 px-2">
              <TTSForm form={form} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="more">
            <AccordionTrigger className="text-xs font-semibold text-ej-ink2">
              {t("models.chatMember.moreSettings")}
            </AccordionTrigger>
            <AccordionContent className="space-y-4 px-2">
              <FormField
                control={form.control}
                name="config.prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("models.chatMember.prompt")}</FormLabel>
                    <Textarea
                      placeholder={t("models.chatMember.promptPlaceholder")}
                      className="max-h-48"
                      {...field}
                    />
                    <FormDescription>
                      {t("models.chatMember.promptDescription")}
                    </FormDescription>
                    <FormMessage />
                    <div className="mb-2 ej-label">
                      {t("promptPreview")}
                    </div>
                    <div className="rounded-ej border border-ej-line bg-ej-surface2 px-3.5 py-2.5 text-ej-ink2">
                      <div className="select-text whitespace-pre-line font-sans text-xs leading-relaxed">
                        {buildFullPrompt(form.watch("config.prompt"))}
                      </div>
                    </div>
                  </FormItem>
                )}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex items-center justify-end space-x-4 w-full">
          {member?.id && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <EjButton variant="danger">{t("remove")}</EjButton>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-base font-bold text-ej-ink">
                    {t("removeChatMember")}
                  </AlertDialogTitle>
                </AlertDialogHeader>
                <AlertDialogDescription className="text-xs text-ej-muted">
                  {t("removeChatMemberConfirmation")}
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-ej-bad hover:opacity-90"
                    onClick={handleRemove}
                  >
                    {t("remove")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <EjButton
            type="button"
            variant="secondary"
            onClick={() => onFinish?.()}
          >
            {t("cancel")}
          </EjButton>
          <EjButton type="submit" variant="primary">
            {t("save")}
          </EjButton>
        </div>
      </form>
    </Form>
  );
};
