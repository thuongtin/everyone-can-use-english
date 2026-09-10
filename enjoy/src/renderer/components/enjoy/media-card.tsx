import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { gradientFor } from "@renderer/lib/design";
import { LoaderIcon } from "lucide-react";

export type MediaCardRatio = "square" | "video" | "book";

export type MediaCardStatus = "done" | "pending" | "processing";

const RATIO_CLASS: Record<MediaCardRatio, string> = {
  square: "aspect-square",
  video: "aspect-video",
  book: "aspect-[3/4]",
};

const STATUS_CLASS: Record<MediaCardStatus, string> = {
  done: "text-ej-ok",
  pending: "text-ej-muted",
  processing: "text-ej-warn",
};

const STATUS_DOT: Record<MediaCardStatus, string> = {
  done: "bg-ej-ok",
  pending: "bg-ej-line2",
  processing: "bg-ej-warn",
};

/**
 * The library/home media tile: cover with badges, title and meta.
 * One component for audio (1:1), video (16:9) and documents (3:4).
 */
export const MediaCard = (props: {
  to: string;
  id: string;
  title: string;
  ratio?: MediaCardRatio;
  coverUrl?: string;
  /** Rendered on the gradient fallback, e.g. a type icon. */
  coverFallback?: React.ReactNode;
  language?: string;
  /** Bottom-right badge, already formatted. */
  duration?: string;
  /** 0..1, drawn as a 3px bar along the cover's bottom edge. */
  progress?: number;
  meta?: React.ReactNode;
  status?: MediaCardStatus;
  statusLabel?: string;
  processing?: boolean;
  processingLabel?: string;
  /** Book-spine label, documents only. */
  spineLabel?: string;
  /** The ⋯ menu, rendered in the cover's top-right corner. */
  actions?: React.ReactNode;
  className?: string;
  onError?: () => void;
}) => {
  const {
    to,
    id,
    title,
    ratio = "square",
    coverUrl,
    coverFallback,
    language,
    duration,
    progress,
    meta,
    status,
    statusLabel,
    processing,
    processingLabel,
    spineLabel,
    actions,
    className,
    onError,
  } = props;

  return (
    <div className={cn("group relative min-w-0", className)}>
      <Link to={to} className="block">
        <div
          className={cn(
            "relative overflow-hidden rounded-xl bg-ej-surface2 border border-ej-line",
            "transition-transform duration-ej group-hover:-translate-y-[3px] group-hover:shadow-ej",
            RATIO_CLASS[ratio]
          )}
          style={coverUrl ? undefined : { backgroundImage: gradientFor(id) }}
        >
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={title}
              crossOrigin="anonymous"
              loading="lazy"
              onError={onError}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/80">
              {coverFallback}
            </div>
          )}

          {ratio === "book" && (
            <div className="absolute left-0 inset-y-0 w-1.5 bg-black/35" />
          )}

          {language && (
            <span className="absolute left-2 top-2 h-[18px] px-1.5 rounded-md bg-white/90 text-[10px] font-bold uppercase text-ej-ink flex items-center">
              {language}
            </span>
          )}

          {spineLabel && (
            <span className="absolute right-2 top-2 h-[18px] px-1.5 rounded-md bg-black/55 text-[10px] font-bold uppercase text-white flex items-center">
              {spineLabel}
            </span>
          )}

          {duration && (
            <span className="absolute right-2 bottom-2 h-[18px] px-1.5 rounded-md bg-black/55 text-[10px] font-semibold text-white flex items-center ej-tabular">
              {duration}
            </span>
          )}

          {progress !== undefined && progress > 0 && (
            <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-black/25">
              <div
                className="h-full bg-white"
                style={{ width: `${Math.min(100, progress * 100)}%` }}
              />
            </div>
          )}

          {processing && (
            <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-1.5 text-white">
              <LoaderIcon className="size-5 animate-spin" />
              {processingLabel && (
                <span className="text-[11px]">{processingLabel}</span>
              )}
            </div>
          )}
        </div>
      </Link>

      {actions && (
        <div className="absolute right-1.5 top-1.5 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-ej">
          {actions}
        </div>
      )}

      <div className="mt-2 min-w-0">
        <Link
          to={to}
          className="block text-[13px] font-semibold text-ej-ink leading-snug line-clamp-2"
        >
          {title}
        </Link>
        {meta && (
          <div className="mt-0.5 text-[11.5px] text-ej-muted truncate">
            {meta}
          </div>
        )}
        {status && statusLabel && (
          <div
            className={cn(
              "mt-1 flex items-center gap-1.5 text-[11.5px]",
              STATUS_CLASS[status]
            )}
          >
            <span
              className={cn("size-1.5 rounded-full shrink-0", STATUS_DOT[status])}
            />
            <span className="truncate">{statusLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
};
