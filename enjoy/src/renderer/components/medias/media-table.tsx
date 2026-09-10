import { Link } from "react-router-dom";
import { t } from "i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui";
import {
  CircleAlertIcon,
  MoreVerticalIcon,
  PencilIcon,
  TrashIcon,
} from "lucide-react";
import { GradientCover } from "@renderer/components/enjoy";
import { cn, formatDate, formatDuration } from "@renderer/lib/utils";

/** Anything the table can render: audios and videos share these fields. */
type MediaRow = Partial<AudioType> & Partial<VideoType>;

/**
 * List view of a media library. Laid out as a grid rather than a <table> so the
 * design's fixed column track can grow two extra columns in the fluid layout.
 */
const COLUMNS =
  "minmax(200px, 2.2fr) 80px 90px 80px 130px 110px 40px";
const COLUMNS_FLUID =
  "minmax(200px, 2.2fr) 80px 90px 80px 130px 110px minmax(120px, 1fr) 110px 40px";

const statusOf = (item: MediaRow) => {
  if (item.transcribing)
    return { label: t("media.transcribing"), dot: "bg-ej-warn" };
  if (item.transcribed)
    return { label: t("media.transcribed"), dot: "bg-ej-ok" };
  return { label: t("media.notTranscribed"), dot: "bg-ej-line2" };
};

const Cell = (props: { children: React.ReactNode; className?: string }) => (
  <div
    className={cn(
      "min-w-0 truncate text-[12px] text-ej-ink2 flex items-center",
      props.className
    )}
  >
    {props.children}
  </div>
);

export const MediaTable = (props: {
  items: MediaRow[];
  /** Route prefix, e.g. "audios". */
  kind: "audios" | "videos";
  onEdit?: (item: MediaRow) => void;
  onDelete?: (item: MediaRow) => void;
}) => {
  const { items, kind, onEdit, onDelete } = props;

  return (
    <div className="rounded-[14px] border border-ej-line bg-ej-surface overflow-x-auto">
      <div className="min-w-[820px]">
        <div
          className="grid items-center gap-3 px-4 h-9 border-b border-ej-line ej-label fluid:[grid-template-columns:var(--cols-fluid)]"
          style={
            {
              gridTemplateColumns: COLUMNS,
              "--cols-fluid": COLUMNS_FLUID,
            } as React.CSSProperties
          }
        >
          <div>{t("models.audio.name")}</div>
          <div>{t("language")}</div>
          <div>{t("models.audio.duration")}</div>
          <div>{t("models.audio.recordingsCount")}</div>
          <div>{t("models.audio.isTranscribed")}</div>
          <div>{t("models.audio.updatedAt")}</div>
          <div className="hidden fluid:block">{t("source")}</div>
          <div className="hidden fluid:block">{t("models.audio.createdAt")}</div>
          <div />
        </div>

        {items.map((item) => {
          const status = statusOf(item);
          return (
            <div
              key={item.id}
              className="grid items-center gap-3 px-4 h-[58px] border-b border-ej-line last:border-b-0 hover:bg-ej-surface2/60 transition-colors duration-ej fluid:[grid-template-columns:var(--cols-fluid)]"
              style={
                {
                  gridTemplateColumns: COLUMNS,
                  "--cols-fluid": COLUMNS_FLUID,
                } as React.CSSProperties
              }
            >
              <div className="min-w-0 flex items-center gap-2.5">
                <GradientCover
                  id={item.id}
                  src={item.coverUrl}
                  alt={item.name}
                  className="size-[42px] shrink-0"
                  rounded="rounded-lg"
                />
                <div className="min-w-0">
                  <Link
                    to={`/${kind}/${item.id}`}
                    className="block text-[12.5px] font-semibold text-ej-ink truncate hover:text-ej-accent transition-colors duration-ej"
                  >
                    {item.name}
                  </Link>
                  <div className="text-[11px] text-ej-muted truncate flex items-center gap-1">
                    {!item.src && (
                      <CircleAlertIcon className="size-3 text-ej-bad shrink-0" />
                    )}
                    {item.src ? formatDate(item.createdAt) : t("cannotFindSourceFile")}
                  </div>
                </div>
              </div>

              <Cell className="uppercase">{item.language || "-"}</Cell>
              <Cell className="ej-tabular">
                {item.duration ? formatDuration(item.duration) : "-"}
              </Cell>
              <Cell className="ej-tabular">{item.recordingsCount ?? 0}</Cell>
              <Cell>
                <span className={cn("size-1.5 rounded-full mr-1.5", status.dot)} />
                <span className="truncate">{status.label}</span>
              </Cell>
              <Cell className="ej-tabular">{formatDate(item.updatedAt)}</Cell>
              <Cell className="hidden fluid:flex">{item.source || "-"}</Cell>
              <Cell className="hidden fluid:flex ej-tabular">
                {formatDate(item.createdAt)}
              </Cell>

              <div className="flex justify-end">
                {(onEdit || onDelete) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        title={t("actions")}
                        className="size-7 rounded-lg text-ej-muted hover:bg-ej-surface2 hover:text-ej-ink flex items-center justify-center transition-colors duration-ej"
                      >
                        <MoreVerticalIcon className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {onEdit && (
                        <DropdownMenuItem
                          onClick={() => onEdit(Object.assign({}, item))}
                        >
                          <PencilIcon className="size-3.5 mr-2" />
                          {t("edit")}
                        </DropdownMenuItem>
                      )}
                      {onDelete && (
                        <DropdownMenuItem
                          className="text-ej-bad focus:text-ej-bad"
                          onClick={() => onDelete(Object.assign({}, item))}
                        >
                          <TrashIcon className="size-3.5 mr-2" />
                          {t("delete")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
