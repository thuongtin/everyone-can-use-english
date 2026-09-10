import type { MindmapGraph, MindmapNode } from "../../../types/learning";

export const MAX_STUDY_WORDS_PER_GROUP = 6;
export const MAX_STUDY_GROUPS_PER_PAGE = 2;

export type MindmapStudyGroup = Readonly<{
  id: string;
  title: string;
  translationVi: string;
  nodeIds: readonly string[];
  example: string;
  exampleTranslationVi: string;
  illustration?: Readonly<{ prompt: string; alt: string }>;
}>;

export type MindmapStudyGroupSection = Readonly<{
  id: string;
  sourceGroupId: string;
  title: string;
  translationVi: string;
  nodes: readonly MindmapNode[];
  example: string;
  exampleTranslationVi: string;
  illustration?: MindmapStudyGroup["illustration"];
  continuation: boolean;
}>;

export type MindmapStudyPage = Readonly<{
  number: number;
  groups: readonly MindmapStudyGroupSection[];
}>;

export type MindmapStudyLayout = Readonly<{
  root?: MindmapNode;
  pages: readonly MindmapStudyPage[];
  groups: readonly MindmapStudyGroupSection[];
  usesLegacyGroups: boolean;
}>;

type GraphWithStudyGroups = MindmapGraph & Readonly<{
  studyGroups?: readonly MindmapStudyGroup[];
}>;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function hasExactPartition(
  groups: readonly MindmapStudyGroup[] | undefined,
  nonRootNodes: readonly MindmapNode[],
): groups is readonly MindmapStudyGroup[] {
  if (!groups || (groups.length === 0 && nonRootNodes.length > 0)) return false;
  const expectedIds = new Set(nonRootNodes.map((node) => node.id));
  const seenIds = new Set<string>();
  for (const group of groups) {
    if (!group.id || !group.title || group.nodeIds.length === 0) return false;
    for (const nodeId of group.nodeIds) {
      if (!expectedIds.has(nodeId) || seenIds.has(nodeId)) return false;
      seenIds.add(nodeId);
    }
  }
  return seenIds.size === expectedIds.size;
}

function buildLegacyGroups(nodes: readonly MindmapNode[]): MindmapStudyGroup[] {
  return chunks(nodes, MAX_STUDY_WORDS_PER_GROUP).map((groupNodes, index) => ({
    id: `legacy-related-${index + 1}`,
    title: index === 0 ? "Từ liên quan" : "Từ liên quan (tiếp theo)",
    translationVi: "Các từ theo thứ tự của sơ đồ đã lưu",
    nodeIds: groupNodes.map((node) => node.id),
    example: "",
    exampleTranslationVi: "",
  }));
}

/** Build a stable reading order without deriving semantics from graph edges. */
export function buildMindmapStudyLayout(graph: MindmapGraph): MindmapStudyLayout {
  const root = graph.nodes.find((node) => node.id === graph.rootNodeId) ?? graph.nodes[0];
  const nonRootNodes = graph.nodes.filter((node) => node.id !== root?.id);
  const nodesById = new Map(nonRootNodes.map((node) => [node.id, node]));
  const declaredGroups = (graph as GraphWithStudyGroups).studyGroups;
  const usesLegacyGroups = !hasExactPartition(declaredGroups, nonRootNodes);
  const sourceGroups = usesLegacyGroups ? buildLegacyGroups(nonRootNodes) : declaredGroups;

  const groups = sourceGroups.flatMap((group) => {
    const groupNodes = group.nodeIds
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is MindmapNode => Boolean(node));
    return chunks(groupNodes, MAX_STUDY_WORDS_PER_GROUP).map((nodes, chunkIndex): MindmapStudyGroupSection => ({
      id: chunkIndex === 0 ? group.id : `${group.id}-part-${chunkIndex + 1}`,
      sourceGroupId: group.id,
      title: chunkIndex === 0 ? group.title : `${group.title} (tiếp theo)`,
      translationVi: group.translationVi,
      nodes,
      example: group.example,
      exampleTranslationVi: group.exampleTranslationVi,
      illustration: group.illustration,
      continuation: chunkIndex > 0,
    }));
  });
  const pages = chunks(groups, MAX_STUDY_GROUPS_PER_PAGE).map((pageGroups, index) => ({
    number: index + 1,
    groups: pageGroups,
  }));
  return {
    root,
    pages: pages.length > 0 ? pages : [{ number: 1, groups: [] }],
    groups,
    usesLegacyGroups,
  };
}
