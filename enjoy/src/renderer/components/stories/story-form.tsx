import { Button } from "@renderer/components/ui";
import { FileTextIcon, LinkIcon } from "lucide-react";
import { t } from "i18next";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export const StoryForm = () => {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");

  const submit = () => {
    if (!url) return;
    navigate(`/stories/preview/${encodeURIComponent(url)}`);
  };

  const importFile = async () => {
    const [filePath] = await window.__ENJOY_APP__.dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "Documents", extensions: ["html", "htm", "txt", "md", "markdown"] },
      ],
    }) || [];
    if (!filePath) return;
    const normalized = filePath.replaceAll("\\", "/");
    const fileUrl = `file://${normalized.startsWith("/") ? "" : "/"}${encodeURI(normalized)}`;
    navigate(`/stories/preview/${encodeURIComponent(fileUrl)}`);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0 relative">
        <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-ej-muted pointer-events-none" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={t("inputUrlToStartReading")}
          className="w-full h-9 pl-9 pr-3 rounded-full border border-ej-line bg-ej-surface text-xs text-ej-ink placeholder:text-ej-muted outline-none focus:border-ej-accent transition-colors duration-ej"
        />
      </div>

      <Button
        disabled={!url}
        onClick={submit}
        className="shrink-0 h-9 px-5 rounded-full text-xs"
      >
        {t("read")}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => void importFile()}
        className="shrink-0 h-9 px-4 rounded-full text-xs gap-1.5"
      >
        <FileTextIcon className="size-3.5" />
        {t("selectFile")}
      </Button>
    </div>
  );
};
