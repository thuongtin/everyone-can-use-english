import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui";
import { t } from "i18next";
import { CheckCircleIcon } from "lucide-react";

export const TranscriptionsList = (props: {
  media: AudioType | VideoType;
  transcription?: TranscriptionType;
  onFinish?: () => void;
}) => {
  const { transcription } = props;

  if (!transcription?.result?.timeline) {
    return (
      <div className="py-6 text-center text-sm text-ej-muted">
        {t("noData")}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 text-sm text-ej-muted">{t("transcript")}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead className="capitalize">{t("model")}</TableHead>
            <TableHead className="capitalize">{t("language")}</TableHead>
            <TableHead className="capitalize">{t("status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-mono text-xs">
              {transcription.id.split("-")[0]}
            </TableCell>
            <TableCell>
              <div className="text-sm">{transcription.engine}</div>
              <div className="text-xs text-ej-muted">
                {transcription.model}
              </div>
            </TableCell>
            <TableCell>
              <span className="text-sm">{transcription.language || "-"}</span>
            </TableCell>
            <TableCell>
              <CheckCircleIcon className="size-4 text-ej-ok" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
};
