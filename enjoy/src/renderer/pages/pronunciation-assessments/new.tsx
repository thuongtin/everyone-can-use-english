import { t } from "i18next";
import { Link } from "react-router-dom";
import { ChevronLeftIcon } from "lucide-react";
import { EjPage, EjPageHeader } from "@renderer/components/enjoy";
import { PronunciationAssessmentForm } from "@renderer/components";

export default () => {
  return (
    <EjPage className="max-w-[800px]">
      <Link
        to="/pronunciation_assessments"
        className="mb-4 inline-flex items-center gap-1 text-xxs font-semibold text-ej-accent-ink hover:underline"
      >
        <ChevronLeftIcon className="size-3.5" />
        {t("sidebar.pronunciationAssessment")}
      </Link>
      <EjPageHeader
        kicker={t("sidebar.pronunciationAssessment")}
        title={t("newAssessment")}
        description={t("newAssessmentDescription")}
      />
      <PronunciationAssessmentForm />
    </EjPage>
  );
};
