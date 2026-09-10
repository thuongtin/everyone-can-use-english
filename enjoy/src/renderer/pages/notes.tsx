import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { t } from "i18next";
import { SearchIcon } from "lucide-react";
import { AppSettingsProviderContext, useLayout } from "@renderer/context";
import { toast } from "@renderer/components/ui";
import {
  EjButton,
  EjEmptyState,
  EjPage,
  EjPageHeader,
  Segmented,
} from "@renderer/components/enjoy";
import { NoteSegmentGroup } from "@renderer/components";

type NoteGroupType = {
  targetId: string;
  targetType: string;
  count: number;
  segment?: SegmentType;
};

/** "all" plus whichever segment target types the library actually holds. */
type KindFilter = string;

export default function Notes() {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { fluid } = useLayout();

  const [groups, setGroups] = useState<NoteGroupType[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [query, setQuery] = useState<string>("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [matches, setMatches] = useState<Record<string, boolean>>({});

  const findNotesGroup = (params?: { offset: number; limit?: number }) => {
    const { offset = 0, limit = 10 } = params || {};
    if (offset > 0 && !hasMore) return;

    EnjoyApp.notes
      .groupByTarget({ limit, offset })
      .then((noteGroups: NoteGroupType[]) => {
        if (offset === 0) {
          setGroups(noteGroups);
        } else {
          setGroups([...groups, ...noteGroups]);
        }
        setHasMore(noteGroups.length === limit);
      })
      .catch((err) => {
        toast.error(err.message);
      });
  };

  useEffect(() => {
    findNotesGroup({ offset: 0 });
  }, []);

  const handleMatchChange = useCallback((segmentId: string, value: boolean) => {
    setMatches((previous) =>
      previous[segmentId] === value
        ? previous
        : { ...previous, [segmentId]: value }
    );
  }, []);

  const withSegment = useMemo(
    () => groups.filter((group) => Boolean(group.segment)),
    [groups]
  );

  // Notes can only be attached to Audio and Video segments today, so the filter
  // offers exactly the kinds present instead of dead options.
  const kindOptions = useMemo(() => {
    const kinds = Array.from(
      new Set(withSegment.map((group) => group.segment.targetType))
    );
    if (kinds.length < 2) return [];

    return [
      { value: "all", label: t("all") },
      ...kinds.map((value) => ({ value, label: t(value.toLowerCase()) })),
    ];
  }, [withSegment]);

  const filteredGroups = useMemo(
    () =>
      withSegment.filter(
        (group) => kind === "all" || group.segment.targetType === kind
      ),
    [withSegment, kind]
  );

  const normalizedQuery = query.trim().toLowerCase();
  const visibleCount = filteredGroups.filter(
    (group) => matches[group.segment.id] !== false
  ).length;

  const totalNotes = withSegment.reduce(
    (sum, group) => sum + Number(group.count || 0),
    0
  );

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-[34px] w-[260px] items-center gap-2 rounded-[9px] border border-ej-line bg-ej-surface px-2.5">
        <SearchIcon className="size-3.5 shrink-0 text-ej-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchInNotes")}
          className="min-w-0 flex-1 border-0 bg-transparent text-xs text-ej-ink outline-none placeholder:text-ej-muted"
        />
      </label>
      {kindOptions.length > 0 && (
        <Segmented value={kind} onChange={setKind} options={kindOptions} />
      )}
    </div>
  );

  return (
    <EjPage>
      <EjPageHeader
        kicker={t("sidebar.notes")}
        title={
          <span className="flex items-baseline gap-2.5">
            {t("sidebar.notes")}
            <span className="whitespace-nowrap text-[13px] font-medium text-ej-muted">
              {t("notesCount", { count: totalNotes })} ·{" "}
              {t("sourcesCount", { count: withSegment.length })}
            </span>
          </span>
        }
        description={t("notesPageDescription")}
        actions={controls}
      />

      {withSegment.length === 0 ? (
        <EjEmptyState
          kicker={t("sidebar.notes")}
          title={t("noNotesYet")}
          description={t("noNotesYetDescription")}
        />
      ) : (
        <div
          className="grid items-start gap-4"
          style={{
            gridTemplateColumns: fluid
              ? "repeat(auto-fill, minmax(460px, 1fr))"
              : "1fr",
          }}
        >
          {filteredGroups.map((group) => (
            <NoteSegmentGroup
              key={group.segment.id}
              count={group.count}
              segment={group.segment}
              query={normalizedQuery}
              onMatchChange={handleMatchChange}
            />
          ))}
        </div>
      )}

      {withSegment.length > 0 && visibleCount === 0 && (
        <div className="py-12 text-center text-xs text-ej-muted">
          {t("noNotesMatched", { query })}
        </div>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <EjButton
            variant="ghost"
            size="sm"
            onClick={() => findNotesGroup({ offset: groups.length })}
          >
            {t("loadMore")}
          </EjButton>
        </div>
      )}
    </EjPage>
  );
}
