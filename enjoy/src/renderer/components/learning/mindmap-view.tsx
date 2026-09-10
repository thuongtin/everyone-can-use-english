import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { MindmapEdgeKind, MindmapGraph, MindmapNode as MindmapGraphNode } from "../../../types/learning";
import { buildMindmapStudyLayout, type MindmapStudyGroupSection } from "./mindmap-study-layout";
import "./mindmap-study.css";

export { buildMindmapStudyLayout } from "./mindmap-study-layout";

export type MindmapPosition = Readonly<{ id: string; x: number; y: number }>;
export type MindmapGroupImage = Readonly<{ src: string; alt: string }>;
export type MindmapViewProps = {
  graph: MindmapGraph;
  positions?: readonly MindmapPosition[];
  onPositionsChange?: (positions: readonly MindmapPosition[]) => void;
  onSelectNode?: (nodeId: string) => void;
  selectedNodeId?: string;
  onSpeakNode?: (node: MindmapGraphNode) => void;
  groupImages?: Readonly<Record<string, MindmapGroupImage>>;
  illustrationsRequested?: boolean;
  onGenerateGroupImage?: (groupId: string) => void;
  className?: string;
};

export const MINDMAP_EDGE_LABELS: Readonly<Record<MindmapEdgeKind, string>> = {
  category: "Nhóm", synonym: "Đồng nghĩa", antonym: "Trái nghĩa", "word-family": "Họ từ",
  collocation: "Kết hợp từ", situation: "Tình huống", "related-concept": "Khái niệm liên quan",
};
const EDGE_COLORS: Readonly<Record<MindmapEdgeKind, string>> = {
  category: "#3b766b", synonym: "#967044", antonym: "#a94b50", "word-family": "#6c5a9e",
  collocation: "#27758a", situation: "#9b6b33", "related-concept": "#64748b",
};
// Group accents reuse the design tokens so the study map follows the theme.
const GROUP_PALETTE = [
  { color: "var(--ej-accent)", tint: "var(--ej-accent-soft)" },
  { color: "var(--ej-ok)", tint: "var(--ej-ok-soft)" },
  { color: "var(--ej-warn)", tint: "var(--ej-warn-soft)" },
  { color: "var(--ej-accent-ink)", tint: "var(--ej-accent-soft2)" },
] as const;
const EMPTY_POSITIONS: readonly MindmapPosition[] = [];

function isFinitePosition(value: MindmapPosition | undefined): value is MindmapPosition {
  return Boolean(value && Number.isFinite(value.x) && Number.isFinite(value.y));
}
function graphNodeNeighbors(graph: MindmapGraph): Map<string, string[]> {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const neighbors = new Map<string, string[]>(graph.nodes.map((node): [string, string[]] => [node.id, []]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    neighbors.get(edge.source)?.push(edge.target);
    neighbors.get(edge.target)?.push(edge.source);
  }
  return neighbors;
}

/** Compatibility helper for saved revisions. The presenter does not persist these positions. */
export function buildMindmapLayout(graph: MindmapGraph, savedPositions: readonly MindmapPosition[] = EMPTY_POSITIONS): MindmapPosition[] {
  const savedById = new Map(savedPositions.map((position) => [position.id, position]));
  const neighbors = graphNodeNeighbors(graph);
  const rootId = graph.nodes.some((node) => node.id === graph.rootNodeId) ? graph.rootNodeId : graph.nodes[0]?.id;
  const depthById = new Map<string, number>();
  const queue: string[] = [];
  if (rootId) { depthById.set(rootId, 0); queue.push(rootId); }
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;
    for (const neighborId of neighbors.get(currentId) ?? []) {
      if (depthById.has(neighborId)) continue;
      depthById.set(neighborId, (depthById.get(currentId) ?? 0) + 1);
      queue.push(neighborId);
    }
  }
  const fallbackDepth = Math.max(0, ...depthById.values()) + 1;
  const slotByDepth = new Map<number, number>();
  return graph.nodes.map((node) => {
    const saved = savedById.get(node.id);
    if (isFinitePosition(saved)) return { ...saved };
    const depth = depthById.get(node.id) ?? fallbackDepth;
    const slot = slotByDepth.get(depth) ?? 0;
    slotByDepth.set(depth, slot + 1);
    return { id: node.id, x: 64 + depth * 284, y: 72 + slot * 178 };
  });
}

export function mapMindmapEdges(graph: MindmapGraph) {
  return graph.edges.map((edge) => {
    const color = EDGE_COLORS[edge.kind];
    return {
      id: edge.id, source: edge.source, target: edge.target, type: "smoothstep",
      label: MINDMAP_EDGE_LABELS[edge.kind], markerEnd: { type: "arrowclosed", color },
      style: { stroke: color, strokeWidth: 1.6 }, labelStyle: { fill: "#334155", fontSize: 11, fontWeight: 600 },
      labelBgStyle: { fill: "#fbf8f1", fillOpacity: 0.96 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 6,
    };
  });
}

function evidenceLabel(status: MindmapGraphNode["evidence"]["status"]): string {
  if (status === "dictionary") return "Từ điển";
  if (status === "user") return "Người học";
  return "Chưa xác minh";
}

type BranchPath = Readonly<{ id: string; d: string }>;
function useBranchPaths(nodeIds: readonly string[]) {
  const fanRef = useRef<HTMLDivElement | null>(null);
  const hubRef = useRef<HTMLSpanElement | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<readonly BranchPath[]>([]);
  const setNodeRef = useCallback((nodeId: string, element: HTMLElement | null) => {
    if (element) nodeRefs.current.set(nodeId, element); else nodeRefs.current.delete(nodeId);
  }, []);
  useLayoutEffect(() => {
    const fan = fanRef.current;
    const hub = hubRef.current;
    if (!fan || !hub) return;
    const measure = () => {
      const fanRect = fan.getBoundingClientRect();
      const hubRect = hub.getBoundingClientRect();
      const startX = hubRect.left + hubRect.width / 2 - fanRect.left;
      const startY = hubRect.top + hubRect.height / 2 - fanRect.top;
      setPaths(nodeIds.flatMap((nodeId) => {
        const node = nodeRefs.current.get(nodeId);
        if (!node) return [];
        const rect = node.getBoundingClientRect();
        const endX = rect.left + rect.width / 2 - fanRect.left;
        const endY = rect.top + rect.height / 2 - fanRect.top;
        const bend = Math.max(24, Math.abs(endX - startX) * 0.48);
        const direction = endX >= startX ? 1 : -1;
        return [{ id: nodeId, d: `M ${startX} ${startY} C ${startX + bend * direction} ${startY}, ${endX - bend * direction} ${endY}, ${endX} ${endY}` }];
      }));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(fan);
    observer?.observe(hub);
    nodeRefs.current.forEach((node) => observer?.observe(node));
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [nodeIds]);
  return { fanRef, hubRef, setNodeRef, paths };
}

function GroupIllustration({ group, image, requested, onGenerate }: {
  group: MindmapStudyGroupSection; image?: MindmapGroupImage; requested: boolean; onGenerate?: () => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  useEffect(() => setFailedSrc(undefined), [image?.src]);
  const available = image && failedSrc !== image.src;
  if (!image && !requested && !group.illustration) return null;
  return (
    <div className="mindmap-study__illustration" data-testid={`study-map-image-${group.sourceGroupId}`} data-has-image={available || undefined}>
      {available ? <img src={image.src} alt={image.alt} onError={() => setFailedSrc(image.src)} /> : (
        <div className="mindmap-study__image-empty" role="status">
          <span className="mindmap-study__image-empty-mark" aria-hidden="true">✦</span>
          <p>{failedSrc ? "Không mở được minh họa đã lưu. Nội dung học vẫn đầy đủ." : requested ? "Minh họa chưa sẵn sàng. Bạn vẫn có thể học toàn bộ nội dung chữ." : "Nhóm từ này chưa có minh họa."}</p>
          {onGenerate && <button type="button" className="mindmap-study__image-action" onClick={onGenerate}>{failedSrc ? "Tạo lại minh họa" : "Tạo minh họa"}</button>}
        </div>
      )}
    </div>
  );
}

function WordCard({ node, selected, meaningsVisible, relations, onSelect, onSpeak, setNodeRef }: {
  node: MindmapGraphNode; selected: boolean; meaningsVisible: boolean; relations: readonly string[];
  onSelect: () => void; onSpeak?: () => void; setNodeRef: (id: string, element: HTMLElement | null) => void;
}) {
  const ipa = (node as MindmapGraphNode & { ipa?: string }).ipa;
  return (
    <article ref={(element) => setNodeRef(node.id, element)} className="mindmap-study__word" data-testid={`mindmap-study-node-${node.id}`} data-study-node-id={node.id} data-selected={selected || undefined}>
      <div className="mindmap-study__term-row">
        <button type="button" className="mindmap-study__term-button" data-testid={`mindmap-list-node-${node.id}`} aria-pressed={selected} onClick={onSelect}>
          <span className="mindmap-study__term">{node.term}</span>
          {ipa && <span className="mindmap-study__ipa">/{ipa.replace(/^\/+|\/+$/g, "")}/</span>}
        </button>
        {onSpeak && <button type="button" className="mindmap-study__speak" data-testid={`mindmap-speak-node-${node.id}`} aria-label={`Nghe từ ${node.term}`} onClick={onSpeak}><span aria-hidden="true">♪</span></button>}
      </div>
      {meaningsVisible ? <p className="mindmap-study__meaning" data-testid={`mindmap-meaning-${node.id}`}>{node.translationVi}</p> : <p className="mindmap-study__meaning mindmap-study__meaning--hidden">Nghĩa đang được che</p>}
      <details className="mindmap-study__details">
        <summary>Chi tiết và ví dụ</summary>
        <div className="mindmap-study__detail-body">
          <p><span className="mindmap-study__detail-label">Nghĩa:</span> {node.sense}</p>
          <p><span className="mindmap-study__detail-label">Định nghĩa:</span> {node.definition}</p>
          <p><span className="mindmap-study__detail-label">Ví dụ:</span> <q lang="en">{node.example}</q></p>
          <p><span className="mindmap-study__detail-label">Nguồn:</span> {evidenceLabel(node.evidence.status)}</p>
          {relations.length > 0 && <div><p className="mindmap-study__detail-label">Quan hệ:</p><ul className="mindmap-study__relations">{relations.map((relation) => <li key={relation}>{relation}</li>)}</ul></div>}
        </div>
      </details>
    </article>
  );
}

function StudyGroup({ group, groupNumber, graph, selectedNodeId, meaningsVisible, image, illustrationsRequested, onGenerateGroupImage, onSelectNode, onSpeakNode }: {
  group: MindmapStudyGroupSection; groupNumber: number; graph: MindmapGraph; selectedNodeId?: string; meaningsVisible: boolean;
  image?: MindmapGroupImage; illustrationsRequested: boolean; onGenerateGroupImage?: (groupId: string) => void;
  onSelectNode: (nodeId: string) => void; onSpeakNode?: (node: MindmapGraphNode) => void;
}) {
  const nodeIds = useMemo(() => group.nodes.map((node) => node.id), [group.nodes]);
  const { fanRef, hubRef, setNodeRef, paths } = useBranchPaths(nodeIds);
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const relationsByNode = useMemo(() => {
    const result = new Map(group.nodes.map((node): [string, string[]] => [node.id, []]));
    for (const edge of graph.edges) {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);
      const label = MINDMAP_EDGE_LABELS[edge.kind];
      const relation = source && target ? `${source.term} → ${label} → ${target.term}` : undefined;
      if (relation && result.has(source!.id)) result.get(source!.id)?.push(relation);
      if (relation && result.has(target!.id)) result.get(target!.id)?.push(relation);
    }
    return result;
  }, [graph.edges, group.nodes, nodesById]);
  const palette = GROUP_PALETTE[(groupNumber - 1) % GROUP_PALETTE.length];
  const style = { "--group-color": palette.color, "--group-tint": palette.tint } as CSSProperties;
  return (
    <section className="mindmap-study__group" style={style} aria-labelledby={`mindmap-group-title-${group.id}`} data-testid="study-map-group" data-group-id={group.id}>
      <header className="mindmap-study__group-header">
        <span className="mindmap-study__group-index" aria-hidden="true">{groupNumber}</span>
        <div><h3 className="mindmap-study__group-title" id={`mindmap-group-title-${group.id}`}>{group.title}</h3><p className="mindmap-study__group-translation">{group.translationVi}</p></div>
      </header>
      <GroupIllustration group={group} image={image} requested={illustrationsRequested} onGenerate={onGenerateGroupImage ? () => onGenerateGroupImage(group.sourceGroupId) : undefined} />
      <div className="mindmap-study__fan" ref={fanRef}>
        <svg className="mindmap-study__branches" aria-hidden="true" focusable="false">{paths.map((path) => <path key={path.id} className="mindmap-study__branch" d={path.d} />)}</svg>
        <span className="mindmap-study__hub" ref={hubRef} aria-hidden="true" />
        {group.nodes.map((node) => <WordCard key={node.id} node={node} selected={node.id === selectedNodeId} meaningsVisible={meaningsVisible} relations={relationsByNode.get(node.id) ?? []} onSelect={() => onSelectNode(node.id)} onSpeak={onSpeakNode ? () => onSpeakNode(node) : undefined} setNodeRef={setNodeRef} />)}
      </div>
      {(group.example || group.exampleTranslationVi) && <blockquote className="mindmap-study__group-example">{group.example && <p lang="en">{group.example}</p>}{group.exampleTranslationVi && <p lang="vi">{group.exampleTranslationVi}</p>}</blockquote>}
    </section>
  );
}

export function MindmapView({ graph, onSelectNode, selectedNodeId, onSpeakNode, groupImages, illustrationsRequested = false, onGenerateGroupImage, className }: MindmapViewProps) {
  const layout = useMemo(() => buildMindmapStudyLayout(graph), [graph]);
  const [localSelectedNodeId, setLocalSelectedNodeId] = useState(selectedNodeId);
  const [meaningsVisible, setMeaningsVisible] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const activeSelectedNodeId = selectedNodeId ?? localSelectedNodeId;
  const page = layout.pages[Math.min(pageIndex, layout.pages.length - 1)];
  const graphContentKey = useMemo(() => JSON.stringify(graph), [graph]);
  const rootRelations = useMemo(() => {
    if (!layout.root) return [];
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    return graph.edges.flatMap((edge) => {
      if (edge.source === layout.root?.id) {
        const other = nodesById.get(edge.target);
        return other ? [`${layout.root.term} → ${MINDMAP_EDGE_LABELS[edge.kind]} → ${other.term}`] : [];
      }
      if (edge.target === layout.root?.id) {
        const other = nodesById.get(edge.source);
        return other ? [`${other.term} → ${MINDMAP_EDGE_LABELS[edge.kind]} → ${layout.root.term}`] : [];
      }
      return [];
    });
  }, [graph.edges, graph.nodes, layout.root]);
  useEffect(() => setLocalSelectedNodeId(selectedNodeId), [selectedNodeId]);
  useEffect(() => {
    setPageIndex((index) => Math.min(index, layout.pages.length - 1));
  }, [graphContentKey, layout.pages.length]);
  const selectNode = useCallback((nodeId: string) => { setLocalSelectedNodeId(nodeId); onSelectNode?.(nodeId); }, [onSelectNode]);
  return (
    <section className={`mindmap-study ${className ?? ""}`} data-testid="mindmap-view">
      <header className="mindmap-study__cover">
        <p className="mindmap-study__eyebrow">Sổ từ vựng minh họa</p>
        <button type="button" className="mindmap-study__topic-button" data-testid={`mindmap-list-node-${layout.root?.id ?? "root"}`} data-study-node-id={layout.root?.id} aria-pressed={layout.root?.id === activeSelectedNodeId} onClick={() => layout.root && selectNode(layout.root.id)}>
          <span className="mindmap-study__topic">{layout.root?.term ?? "Sơ đồ học"}</span>
        </button>
        {layout.root && (meaningsVisible ? <p className="mindmap-study__topic-translation" data-testid={`mindmap-meaning-${layout.root.id}`}>{layout.root.translationVi}</p> : <p className="mindmap-study__topic-translation">Nghĩa đang được che</p>)}
        {layout.root && <div className="mindmap-study__root-actions">
          {onSpeakNode && <button type="button" className="mindmap-study__speak" data-testid={`mindmap-speak-node-${layout.root.id}`} aria-label={`Nghe từ ${layout.root.term}`} onClick={() => onSpeakNode(layout.root!)}><span aria-hidden="true">♪</span></button>}
          <details className="mindmap-study__root-details mindmap-study__details">
            <summary>Chi tiết chủ đề</summary>
            <div className="mindmap-study__detail-body">
              <p><span className="mindmap-study__detail-label">Nghĩa:</span> {layout.root.sense}</p>
              <p><span className="mindmap-study__detail-label">Định nghĩa:</span> {layout.root.definition}</p>
              <p><span className="mindmap-study__detail-label">Ví dụ:</span> <q lang="en">{layout.root.example}</q></p>
              <p><span className="mindmap-study__detail-label">Nguồn:</span> {evidenceLabel(layout.root.evidence.status)}</p>
              {rootRelations.length > 0 && <div><p className="mindmap-study__detail-label">Quan hệ:</p><ul className="mindmap-study__relations">{rootRelations.map((relation) => <li key={relation}>{relation}</li>)}</ul></div>}
            </div>
          </details>
        </div>}
        <div className="mindmap-study__toolbar">
          <span className="mindmap-study__count">{layout.groups.length} nhóm · {Math.max(0, graph.nodes.length - (layout.root ? 1 : 0))} từ</span>
          <button type="button" className="mindmap-study__reveal" aria-pressed={!meaningsVisible} data-testid="mindmap-toggle-meanings" onClick={() => setMeaningsVisible((visible) => !visible)}>{meaningsVisible ? "Ẩn nghĩa" : "Hiện nghĩa"}</button>
        </div>
      </header>
      <div className="mindmap-study__book">
        <article className="mindmap-study__page" data-testid="study-map-page" data-page-number={page.number}>
          <div className="mindmap-study__page-heading">Trang {page.number}</div>
          {page.groups.length > 0 ? <div className="mindmap-study__groups">{page.groups.map((group) => {
            const groupNumber = layout.groups.indexOf(group) + 1;
            return <StudyGroup key={group.id} group={group} groupNumber={groupNumber} graph={graph} selectedNodeId={activeSelectedNodeId} meaningsVisible={meaningsVisible} image={groupImages?.[group.sourceGroupId]} illustrationsRequested={illustrationsRequested} onGenerateGroupImage={onGenerateGroupImage} onSelectNode={selectNode} onSpeakNode={onSpeakNode} />;
          })}</div> : <p className="mindmap-study__empty">Chủ đề này chưa có từ nhánh để trình bày.</p>}
        </article>
        {layout.pages.length > 1 && <nav className="mindmap-study__pagination" aria-label="Phân trang sơ đồ học">
          <button type="button" className="mindmap-study__page-button" aria-label="Trang trước" disabled={pageIndex === 0} onClick={() => setPageIndex((index) => Math.max(0, index - 1))}>← Trang trước</button>
          <span className="mindmap-study__page-status" aria-live="polite">{page.number} / {layout.pages.length}</span>
          <button type="button" className="mindmap-study__page-button" aria-label="Trang tiếp" disabled={pageIndex === layout.pages.length - 1} onClick={() => setPageIndex((index) => Math.min(layout.pages.length - 1, index + 1))}>Trang tiếp →</button>
        </nav>}
      </div>
    </section>
  );
}

export default MindmapView;
