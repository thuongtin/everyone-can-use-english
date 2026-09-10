import { EjIconButton } from "@renderer/components/enjoy";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@renderer/components/ui";
import {
  HighlighterIcon,
  ScanTextIcon,
  LoaderIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { t } from "i18next";
import type { LocalMeaning } from "../../../types/local-study-api";

export const StoryToolbar = (props: {
  extracted: boolean;
  starred?: boolean;
  toggleStarred?: () => void;
  vocabulary?: {
    word: string;
    context: string;
    sourceId: string;
    sourceType: string;
  }[];
  scanning?: boolean;
  onScan?: () => void;
  meanings?: LocalMeaning[];
  marked?: boolean;
  toggleMarked?: () => void;
  deleteStory?: () => void;
  storyTitle?: string;
  vocabularyVisible: boolean;
  setVocabularyVisible?: (value: boolean) => void;
}) => {
  const {
    starred,
    toggleStarred,
    scanning,
    onScan,
    marked,
    toggleMarked,
    deleteStory,
    storyTitle,
    vocabularyVisible,
    setVocabularyVisible,
  } = props;

  return (
    <>
      <EjIconButton
        title={t("keyVocabulary")}
        disabled={scanning}
        active={vocabularyVisible}
        onClick={() => {
          onScan?.();
          setVocabularyVisible?.(!vocabularyVisible);
        }}
      >
        {scanning ? (
          <LoaderIcon className="size-4 animate-spin" />
        ) : (
          <ScanTextIcon className="size-4" />
        )}
      </EjIconButton>

      <EjIconButton
        title={t("highlightVocabulary")}
        active={marked}
        onClick={toggleMarked}
      >
        <HighlighterIcon className="size-4" />
      </EjIconButton>

      <EjIconButton
        title={t("toggleStarred")}
        active={starred}
        onClick={toggleStarred}
      >
        <StarIcon className={starred ? "size-4 fill-current" : "size-4"} />
      </EjIconButton>

      {deleteStory && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <EjIconButton title={t("delete")}>
              <Trash2Icon className="size-4" />
            </EjIconButton>
          </AlertDialogTrigger>
          <AlertDialogContent aria-describedby={undefined}>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("delete")}: {storyTitle}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={deleteStory}>
                {t("delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
};
