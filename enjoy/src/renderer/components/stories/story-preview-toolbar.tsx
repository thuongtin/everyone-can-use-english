import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@renderer/components/ui";
import { EjIconButton } from "@renderer/components/enjoy";
import { BookOpenTextIcon, ScanTextIcon, HighlighterIcon } from "lucide-react";
import { t } from "i18next";

export const StoryPreviewToolbar = (props: {
  readable: boolean;
  onToggleReadable: () => void;
  onCreateStory: () => void;
  marked?: boolean;
  toggleMarked?: () => void;
}) => {
  const { readable, onCreateStory, onToggleReadable, marked, toggleMarked } =
    props;

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <EjIconButton title={t("aiExtractVocabulary")}>
            <ScanTextIcon className="size-4" />
          </EjIconButton>
        </AlertDialogTrigger>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("aiExtractVocabulary")}</AlertDialogTitle>

            <AlertDialogFooter>
              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={onCreateStory}>
                {t("continue")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>

      <EjIconButton
        title={t("toggleReadable")}
        active={readable}
        onClick={onToggleReadable}
      >
        <BookOpenTextIcon className="size-4" />
      </EjIconButton>

      <EjIconButton
        title={t("highlightVocabulary")}
        active={marked}
        onClick={toggleMarked}
      >
        <HighlighterIcon className="size-4" />
      </EjIconButton>
    </>
  );
};
