import { useEffect, useState, useContext } from "react";
import { AppSettingsProviderContext, useLayout } from "@renderer/context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  ScrollArea,
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  toast,
} from "@renderer/components/ui";
import {
  EjButton,
  EjEmptyState,
  EjIconButton,
  EjPage,
  EjPageHeader,
  Segmented,
} from "@renderer/components/enjoy";
import { ChevronDownIcon, MicIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { t } from "i18next";
import {
  PronunciationAssessmentCard,
  RecordingDetail,
} from "@renderer/components";

type OrderBy = "createdAtDesc" | "createdAtAsc" | "scoreDesc" | "scoreAsc";

export default () => {
  const navigate = useNavigate();
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { fluid } = useLayout();
  const [assessments, setAssessments] = useState<PronunciationAssessmentType[]>(
    []
  );
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [orderBy, setOrderBy] = useState<OrderBy>("createdAtDesc");
  const [selecting, setSelecting] =
    useState<PronunciationAssessmentType | null>(null);
  const [deleting, setDeleting] = useState<PronunciationAssessmentType | null>(
    null
  );

  const handleDelete = async (assessment: PronunciationAssessmentType) => {
    try {
      await EnjoyApp.pronunciationAssessments.destroy(assessment.id);
      setAssessments(assessments.filter((a) => a.id !== assessment.id));
      setDeleting(null);
      if (selecting?.id === assessment.id) setSelecting(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const fetchAssessments = (params?: { offset: number; limit?: number }) => {
    const { offset = 0, limit = 10 } = params || {};
    if (offset > 0 && !hasMore) return;

    let order = ["createdAt", "DESC"];
    switch (orderBy) {
      case "createdAtDesc":
        order = ["createdAt", "DESC"];
        break;
      case "createdAtAsc":
        order = ["createdAt", "ASC"];
        break;
      case "scoreDesc":
        order = ["pronunciationScore", "DESC"];
        break;
      case "scoreAsc":
        order = ["pronunciationScore", "ASC"];
        break;
    }

    EnjoyApp.pronunciationAssessments
      .findAll({
        limit,
        offset,
        order: [order],
      })
      .then((fetchedAssessments) => {
        if (offset === 0) {
          setAssessments(fetchedAssessments);
        } else {
          setAssessments([...assessments, ...fetchedAssessments]);
        }
        setHasMore(fetchedAssessments.length === limit);
      })
      .catch((err) => {
        toast.error(err.message);
      });
  };

  useEffect(() => {
    fetchAssessments();
  }, [orderBy]);

  const newAssessmentButton = (
    <EjButton
      variant="primary"
      data-testid="pronunciation-assessment-new-button"
      onClick={() => navigate("/pronunciation_assessments/new")}
    >
      <MicIcon className="size-3.5" />
      {t("newAssessment")}
    </EjButton>
  );

  const sorter = (
    <Segmented<OrderBy>
      size="sm"
      value={orderBy}
      onChange={setOrderBy}
      options={[
        { value: "createdAtDesc", label: t("createdAtDesc") },
        { value: "createdAtAsc", label: t("createdAtAsc") },
        { value: "scoreDesc", label: t("scoreDesc") },
        { value: "scoreAsc", label: t("scoreAsc") },
      ]}
    />
  );

  const loadMoreButton = hasMore && (
    <div className="flex justify-center pt-2">
      <EjButton
        variant="ghost"
        size="sm"
        onClick={() => fetchAssessments({ offset: assessments.length })}
      >
        {t("loadMore")}
      </EjButton>
    </div>
  );

  const emptyState = (
    <EjEmptyState
      kicker={t("sidebar.pronunciationAssessment")}
      title={t("noAssessmentYet")}
      description={t("noAssessmentYetDescription")}
      actions={newAssessmentButton}
    />
  );

  if (fluid) {
    return (
      <div
        data-testid="pronunciation-assessments-page"
        className="flex h-content"
      >
        <aside className="flex w-[400px] shrink-0 flex-col border-r border-ej-line bg-ej-side">
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-ej-line px-4">
            <span className="ej-label">
              {t("sidebar.pronunciationAssessment")}
            </span>
            <EjButton
              variant="primary"
              size="sm"
              data-testid="pronunciation-assessment-new-button"
              onClick={() => navigate("/pronunciation_assessments/new")}
            >
              <MicIcon className="size-3" />
              {t("newAssessment")}
            </EjButton>
          </div>
          <div className="shrink-0 border-b border-ej-line px-4 py-2.5">
            {sorter}
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-2 p-3">
              {assessments.length === 0 && emptyState}
              {assessments.map((assessment) => (
                <PronunciationAssessmentCard
                  key={assessment.id}
                  pronunciationAssessment={assessment}
                  onSelect={setSelecting}
                  onDelete={setDeleting}
                  active={selecting?.id === assessment.id}
                  compact
                />
              ))}
              {loadMoreButton}
            </div>
          </ScrollArea>
        </aside>

        <ScrollArea className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[860px] px-7 py-6">
            {selecting ? (
              <RecordingDetail
                recording={selecting.target}
                pronunciationAssessment={selecting}
              />
            ) : (
              <EjEmptyState
                kicker={t("sidebar.pronunciationAssessment")}
                title={t("selectAnAssessment")}
                description={t("selectAnAssessmentDescription")}
              />
            )}
          </div>
        </ScrollArea>

        <DeleteAssessmentDialog
          deleting={deleting}
          setDeleting={setDeleting}
          onConfirm={handleDelete}
        />
      </div>
    );
  }

  return (
    <>
      <EjPage className="max-w-[800px]">
        <div data-testid="pronunciation-assessments-page">
          <EjPageHeader
            kicker={t("sidebar.pronunciationAssessment")}
            title={t("sidebar.pronunciationAssessment")}
            description={t("pronunciationAssessmentDescription")}
            actions={newAssessmentButton}
          />

          <div className="mb-5 flex items-center gap-3">
            <span className="ej-label">{t("sortBy")}</span>
            {sorter}
          </div>

          <div className="grid grid-cols-1 gap-4">
            {assessments.length === 0 && emptyState}
            {assessments.map((assessment) => (
              <PronunciationAssessmentCard
                key={assessment.id}
                pronunciationAssessment={assessment}
                onSelect={setSelecting}
                onDelete={setDeleting}
              />
            ))}
          </div>

          {loadMoreButton}
        </div>
      </EjPage>

      <Sheet
        open={Boolean(selecting)}
        onOpenChange={(value) => {
          if (!value) setSelecting(null);
        }}
      >
        <SheetContent
          aria-describedby={undefined}
          side="bottom"
          className="h-[88vh] max-h-content overflow-y-auto rounded-t-[18px] border-ej-line bg-ej-bg shadow-ej"
          displayClose={false}
        >
          <SheetHeader className="-mt-4 mb-2 flex items-center justify-center">
            <SheetTitle className="sr-only">
              {t("sidebar.pronunciationAssessment")}
            </SheetTitle>
            <SheetClose asChild>
              <EjIconButton aria-label={t("close")}>
                <ChevronDownIcon className="size-4" />
              </EjIconButton>
            </SheetClose>
          </SheetHeader>
          <div className="mx-auto w-full max-w-[860px]">
            {selecting && (
              <RecordingDetail
                recording={selecting.target}
                pronunciationAssessment={selecting}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <DeleteAssessmentDialog
        deleting={deleting}
        setDeleting={setDeleting}
        onConfirm={handleDelete}
      />
    </>
  );
};

const DeleteAssessmentDialog = (props: {
  deleting: PronunciationAssessmentType | null;
  setDeleting: (assessment: PronunciationAssessmentType | null) => void;
  onConfirm: (assessment: PronunciationAssessmentType) => void;
}) => {
  const { deleting, setDeleting, onConfirm } = props;

  return (
    <AlertDialog
      open={Boolean(deleting)}
      onOpenChange={(value) => {
        if (!value) setDeleting(null);
      }}
    >
      <AlertDialogContent aria-describedby={undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-bold text-ej-ink">
            {t("delete")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs text-ej-muted">
            {t("areYouSureToDeleteThisAssessment")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-ej-bad hover:opacity-90"
            onClick={() => onConfirm(deleting)}
          >
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
