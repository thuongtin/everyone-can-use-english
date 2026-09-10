import {
  Button,
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetContent,
} from "@renderer/components/ui";
import { MeaningCard, NoRecordsFound, LoaderSpin } from "@renderer/components";
import { LoaderIcon, LanguagesIcon } from "lucide-react";
import { t } from "i18next";
import type { LocalMeaning, LocalStudyLookup } from "../../../types/local-study-api";

export const StoryVocabularySheet = (props: {
  extracted: boolean;
  scanning?: boolean;
  extractionFailed?: boolean;
  onExtract?: () => void;
  meanings?: LocalMeaning[];
  pendingLookups?: Partial<LocalStudyLookup>[];
  vocabularyVisible?: boolean;
  setVocabularyVisible?: (value: boolean) => void;
  lookingUpInBatch?: boolean;
  setLookupInBatch?: (value: boolean) => void;
  processLookup?: (lookup: Partial<LocalStudyLookup>) => void;
  lookingUp?: boolean;
}) => {
  const {
    extracted,
    scanning,
    extractionFailed,
    onExtract,
    meanings = [],
    pendingLookups = [],
    vocabularyVisible,
    setVocabularyVisible,
    lookingUpInBatch,
    setLookupInBatch,
    processLookup,
    lookingUp,
  } = props;

  return (
    <Sheet
      open={!!vocabularyVisible}
      onOpenChange={(value) => {
        if (!value) setVocabularyVisible(null);
      }}
    >
      <SheetContent
        side="bottom"
        className="h-[88%] p-0 rounded-t-ej-lg border-t border-ej-line bg-ej-bg shadow-ej flex flex-col"
        aria-describedby={undefined}
      >
        <SheetHeader className="shrink-0 h-12 px-5 flex flex-row items-center justify-center gap-2 border-b border-ej-line bg-ej-surface space-y-0">
          <SheetTitle className="text-[13px] font-bold text-ej-ink">
            {t("keyVocabulary")}
          </SheetTitle>
          <span className="text-xxs text-ej-muted">({meanings.length})</span>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto scroll">
          <div className="mx-auto w-full max-w-[720px] px-5 py-4 space-y-3">
            {extracted ? (
              <>
                {pendingLookups.length > 0 && (
                  <div className="rounded-ej border border-ej-line bg-ej-surface p-3.5 flex items-start gap-3">
                    {lookingUpInBatch ? (
                      <LoaderIcon className="size-4 shrink-0 mt-0.5 text-ej-muted animate-spin" />
                    ) : (
                      <LanguagesIcon className="size-4 shrink-0 mt-0.5 text-ej-accent" />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-ej-ink mb-0.5">
                        {lookingUpInBatch ? t("lookingUp") : t("pending")}
                      </div>
                      <div className="text-xxs text-ej-muted">
                        {t("thereAreLookupsPending", {
                          count: pendingLookups.length,
                        })}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant={lookingUpInBatch ? "secondary" : "outline"}
                      className="shrink-0 h-7 text-xxs"
                      onClick={() => setLookupInBatch(!lookingUpInBatch)}
                    >
                      {lookingUpInBatch ? t("cancel") : t("lookupAll")}
                    </Button>
                  </div>
                )}

                {meanings.map((meaning) => (
                  <div
                    key={meaning.id}
                    className="rounded-ej border border-ej-line bg-ej-surface p-4"
                  >
                    <MeaningCard meaning={meaning} />
                  </div>
                ))}

                {pendingLookups.map((lookup) => (
                  <div
                    key={lookup.id}
                    className="rounded-ej border border-dashed border-ej-line2 bg-ej-surface2 p-4"
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="font-literata text-[17px] font-bold text-ej-ink truncate">
                        {lookup.word}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="shrink-0 h-7 text-xxs"
                        disabled={lookingUp}
                        onClick={() => processLookup(lookup)}
                      >
                        {t("lookup")}
                      </Button>
                    </div>

                    <div className="ej-label mb-1">{t("context")}</div>
                    <div className="font-literata text-[13px] leading-[1.7] text-ej-ink2">
                      {lookup.context}
                    </div>
                  </div>
                ))}

                {meanings.length === 0 && pendingLookups.length === 0 && (
                  <NoRecordsFound />
                )}
              </>
            ) : scanning ? (
              <div data-testid="story-extraction-busy">
                <LoaderSpin />
              </div>
            ) : extractionFailed ? (
              <div
                className="flex flex-col items-center justify-center gap-3 py-10 text-center"
                data-testid="story-extraction-failure"
              >
                <div className="text-sm text-ej-muted">{t("extractionFailed")}</div>
                <Button onClick={onExtract}>{t("retry")}</Button>
              </div>
            ) : (
              <div
                className="flex items-center justify-center py-10"
                data-testid="story-extraction-idle"
              >
                <Button onClick={onExtract}>{t("aiExtractVocabulary")}</Button>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
