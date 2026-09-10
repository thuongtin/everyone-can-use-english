import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookMarkedIcon,
  BookOpenIcon,
  BotIcon,
  HeadphonesIcon,
  HomeIcon,
  LanguagesIcon,
  LucideIcon,
  MessagesSquareIcon,
  NewspaperIcon,
  NotebookPenIcon,
  SearchIcon,
  SpeechIcon,
  UserIcon,
  VideoIcon,
} from "lucide-react";
import { AppSettingsProviderContext } from "@renderer/context";
import { Dialog, DialogContent, DialogTitle } from "@renderer/components/ui";
import { GradientCover } from "@renderer/components/enjoy";
import { cn } from "@renderer/lib/utils";

type PaletteEntry = {
  id: string;
  title: string;
  meta?: string;
  kind: string;
  href: string;
  Icon?: LucideIcon;
  coverId?: string;
  coverUrl?: string;
};

const ROUTES: PaletteEntry[] = [
  { id: "r-home", title: "Trang chủ", kind: "Màn hình", href: "/", Icon: HomeIcon },
  { id: "r-chats", title: "Trò chuyện", kind: "Màn hình", href: "/chats", Icon: MessagesSquareIcon },
  { id: "r-audios", title: "Âm thanh", kind: "Màn hình", href: "/audios", Icon: HeadphonesIcon },
  { id: "r-videos", title: "Video", kind: "Màn hình", href: "/videos", Icon: VideoIcon },
  { id: "r-documents", title: "Tài liệu", kind: "Màn hình", href: "/documents", Icon: NewspaperIcon },
  { id: "r-stories", title: "Bài đọc", kind: "Màn hình", href: "/stories", Icon: BookOpenIcon },
  { id: "r-studio", title: "Xưởng bài học", kind: "Màn hình", href: "/learning-studio", Icon: BookMarkedIcon },
  { id: "r-conversations", title: "Trợ lý AI", kind: "Màn hình", href: "/conversations", Icon: BotIcon },
  { id: "r-assess", title: "Đánh giá phát âm", kind: "Màn hình", href: "/pronunciation_assessments", Icon: SpeechIcon },
  { id: "r-vocabulary", title: "Từ vựng", kind: "Màn hình", href: "/vocabulary", Icon: BookMarkedIcon },
  { id: "r-notes", title: "Ghi chú", kind: "Màn hình", href: "/notes", Icon: NotebookPenIcon },
  { id: "r-dictionary", title: "Từ điển", kind: "Màn hình", href: "/dictionary", Icon: LanguagesIcon },
  { id: "r-profile", title: "Hồ sơ & thống kê", kind: "Màn hình", href: "/profile", Icon: UserIcon },
];

const MAX_RESULTS = 12;

export const CommandPalette = (props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { open, onOpenChange } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [media, setMedia] = useState<PaletteEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);

    Promise.all([
      EnjoyApp.audios.findAll({ offset: 0, limit: 8 }).catch((): any[] => []),
      EnjoyApp.videos.findAll({ offset: 0, limit: 8 }).catch((): any[] => []),
      EnjoyApp.documents.findAll({ offset: 0, limit: 8 }).catch((): any[] => []),
    ]).then(([audios, videos, documents]) => {
      setMedia([
        ...(audios || []).map((item: AudioType) => ({
          id: `audio-${item.id}`,
          title: item.name,
          meta: "Âm thanh",
          kind: "Âm thanh",
          href: `/audios/${item.id}`,
          coverId: item.id,
          coverUrl: item.coverUrl,
        })),
        ...(videos || []).map((item: VideoType) => ({
          id: `video-${item.id}`,
          title: item.name,
          meta: "Video",
          kind: "Video",
          href: `/videos/${item.id}`,
          coverId: item.id,
          coverUrl: item.coverUrl,
        })),
        ...(documents || []).map((item: DocumentEType) => ({
          id: `document-${item.id}`,
          title: item.title,
          meta: "Tài liệu",
          kind: "Tài liệu",
          href: `/documents/${item.id}`,
          coverId: item.id,
        })),
      ]);
    });
  }, [open]);

  const results = useMemo(() => {
    const all = [...ROUTES, ...media];
    const keyword = query.trim().toLowerCase();
    if (!keyword) return all.slice(0, MAX_RESULTS);
    return all
      .filter((entry) =>
        `${entry.title} ${entry.meta ?? ""} ${entry.kind}`
          .toLowerCase()
          .includes(keyword)
      )
      .slice(0, MAX_RESULTS);
  }, [query, media]);

  useEffect(() => setActiveIndex(0), [query]);

  const select = (entry?: PaletteEntry) => {
    if (!entry) return;
    onOpenChange(false);
    navigate(entry.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % Math.max(1, results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (index) => (index - 1 + results.length) % Math.max(1, results.length)
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(results[activeIndex]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        container={document.body}
        className="max-w-[620px] p-0 gap-0 overflow-hidden rounded-2xl border-ej-line bg-ej-surface [&>button]:hidden"
      >
        <DialogTitle className="sr-only">Tìm kiếm hoặc nhảy tới…</DialogTitle>
        <div className="flex items-center gap-3 px-4 h-14 border-b border-ej-line">
          <SearchIcon className="size-4 text-ej-muted shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Tìm kiếm hoặc nhảy tới…"
            className="flex-1 bg-transparent outline-none text-[15px] text-ej-ink placeholder:text-ej-muted"
          />
          <kbd className="text-xxs text-ej-muted border border-ej-line rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>

        <div className="max-h-[380px] overflow-y-auto py-2">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-ej-muted">
              Không tìm thấy kết quả nào.
            </div>
          )}
          {results.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(entry)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 text-left",
                index === activeIndex ? "bg-ej-surface2" : ""
              )}
            >
              {entry.Icon ? (
                <span className="size-7 rounded-lg bg-ej-surface2 flex items-center justify-center shrink-0">
                  <entry.Icon className="size-4 text-ej-ink2" />
                </span>
              ) : (
                <GradientCover
                  id={entry.coverId}
                  src={entry.coverUrl}
                  className="size-7"
                  rounded="rounded-lg"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ej-ink truncate">
                  {entry.title}
                </div>
                {entry.meta && (
                  <div className="text-[11.5px] text-ej-muted truncate">
                    {entry.meta}
                  </div>
                )}
              </div>
              <span className="ej-label shrink-0">{entry.kind}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
