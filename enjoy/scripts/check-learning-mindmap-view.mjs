/* global globalThis */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { build } from "esbuild";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(projectRoot, "scripts/.tmp-learning-mindmap-view-"));

const makeNode = (id, overrides = {}) => ({
  id,
  term: id,
  ipa: `aɪ-${id}`,
  sense: `sense for ${id}`,
  definition: `Definition for ${id}.`,
  translationVi: `nghĩa tiếng Việt rất rõ của ${id}`,
  partOfSpeech: "noun",
  example: `I use ${id} in a short sentence.`,
  evidence: { status: "unverified" },
  ...overrides,
});

try {
  const output = path.join(temp, "mindmap-view.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src/renderer/components/learning/mindmap-view.tsx")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: output,
    logLevel: "silent",
    loader: { ".css": "empty" },
    mainFields: ["module", "main"],
    conditions: ["import", "browser"],
    external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
  });

  const view = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const { buildMindmapLayout, buildMindmapStudyLayout, mapMindmapEdges, MINDMAP_EDGE_LABELS, MindmapView } = view;

  const compatibilityGraph = {
    rootNodeId: "cup",
    nodes: [makeNode("cup"), makeNode("tea"), makeNode("drink")],
    edges: [
      { id: "cup-tea", source: "cup", target: "tea", kind: "collocation", evidence: { status: "unverified" } },
      { id: "drink-cup", source: "drink", target: "cup", kind: "related-concept", evidence: { status: "unverified" } },
    ],
  };
  assert.deepEqual(buildMindmapLayout(compatibilityGraph).map(({ id }) => id), ["cup", "tea", "drink"]);
  assert.deepEqual(buildMindmapLayout(compatibilityGraph, [{ id: "tea", x: 777, y: 333 }]).find(({ id }) => id === "tea"), { id: "tea", x: 777, y: 333 });
  const mappedEdges = mapMindmapEdges(compatibilityGraph);
  assert.equal(mappedEdges[0].label, "Kết hợp từ");
  assert.equal(mappedEdges[1].label, "Khái niệm liên quan");
  assert.equal(MINDMAP_EDGE_LABELS["related-concept"], "Khái niệm liên quan");

  const legacyGraph = {
    rootNodeId: "legacy-root",
    nodes: Array.from({ length: 40 }, (_, index) => makeNode(index === 0 ? "legacy-root" : `legacy-${index}`)),
    edges: [],
  };
  const legacyLayout = buildMindmapStudyLayout(legacyGraph);
  assert.equal(legacyLayout.usesLegacyGroups, true);
  assert.equal(legacyLayout.groups.length, 7);
  assert.equal(legacyLayout.pages.length, 4);
  assert.ok(legacyLayout.pages.every((page) => page.groups.length <= 2));
  assert.ok(legacyLayout.groups.every((group) => group.nodes.length <= 6));
  assert.deepEqual(legacyLayout.groups.flatMap((group) => group.nodes.map((node) => node.id)), legacyGraph.nodes.slice(1).map((node) => node.id));

  const longMeaning = "một khu vực yên tĩnh trong thư viện, nơi người học có thể tập trung đọc, ghi chú và trao đổi một cách tôn trọng";
  const groupedGraph = {
    rootNodeId: "library",
    nodes: [
      makeNode("library", { term: "The library", translationVi: "Thư viện cộng đồng" }),
      makeNode("shelf", { ipa: "ʃelf", translationVi: longMeaning }), makeNode("borrow"),
      makeNode("librarian"), makeNode("quiet"), makeNode("return"), makeNode("catalogue"),
    ],
    edges: [
      { id: "library-shelf", source: "library", target: "shelf", kind: "category", evidence: { status: "dictionary" } },
      { id: "borrow-return", source: "borrow", target: "return", kind: "antonym", evidence: { status: "unverified" } },
      { id: "quiet-library", source: "quiet", target: "library", kind: "situation", evidence: { status: "user" } },
    ],
    studyGroups: [
      { id: "places", title: "Places and things", translationVi: "Không gian và đồ vật", nodeIds: ["shelf", "catalogue"], example: "The catalogue is beside the shelf.", exampleTranslationVi: "Danh mục ở bên cạnh kệ sách.", illustration: { prompt: "A library shelf", alt: "Kệ sách và danh mục trong thư viện" } },
      { id: "people", title: "People", translationVi: "Con người", nodeIds: ["librarian", "quiet"], example: "The librarian speaks quietly.", exampleTranslationVi: "Thủ thư nói chuyện nhẹ nhàng." },
      { id: "actions", title: "Actions", translationVi: "Hành động", nodeIds: ["borrow", "return"], example: "I borrow a book and return it.", exampleTranslationVi: "Tôi mượn một cuốn sách rồi trả lại." },
    ],
  };
  const groupedLayout = buildMindmapStudyLayout(groupedGraph);
  assert.equal(groupedLayout.usesLegacyGroups, false);
  assert.deepEqual(groupedLayout.pages.map((page) => page.groups.length), [2, 1]);
  assert.deepEqual(groupedLayout.groups.map((group) => group.nodes.map((node) => node.id)), [["shelf", "catalogue"], ["librarian", "quiet"], ["borrow", "return"]]);

  const invalidGroupsGraph = { ...groupedGraph, studyGroups: [{ ...groupedGraph.studyGroups[0], nodeIds: ["shelf", "missing"] }] };
  assert.equal(buildMindmapStudyLayout(invalidGroupsGraph).usesLegacyGroups, true);
  assert.deepEqual(buildMindmapStudyLayout(invalidGroupsGraph).groups.flatMap((group) => group.nodes.map((node) => node.id)), groupedGraph.nodes.slice(1).map((node) => node.id));

  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement, Element: dom.window.Element, MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: (callback) => setTimeout(callback, 0), cancelAnimationFrame: (handle) => clearTimeout(handle),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = React;
  const selected = [];
  const spoken = [];
  const requestedImages = [];
  const changedPositions = [];
  const container = dom.window.document.getElementById("root");
  const reactRoot = createRoot(container);
  await act(async () => {
    reactRoot.render(React.createElement(MindmapView, {
      graph: groupedGraph,
      positions: [{ id: "shelf", x: 900, y: 800 }],
      onPositionsChange: (positions) => changedPositions.push(positions),
      onSelectNode: (id) => selected.push(id),
      onSpeakNode: (node) => spoken.push(node.id),
      illustrationsRequested: true,
      groupImages: { places: { src: "local-file://places.png", alt: "Ảnh thật của khu vực kệ sách" } },
      onGenerateGroupImage: (id) => requestedImages.push(id),
    }));
  });

  assert.equal(container.querySelectorAll('[data-testid="study-map-page"]').length, 1);
  assert.equal(container.querySelectorAll('[data-testid="study-map-group"]').length, 2);
  assert.deepEqual([...container.querySelectorAll("[data-group-id]")].map((element) => element.getAttribute("data-group-id")), ["places", "people"]);
  assert.equal(container.querySelector('[data-testid="study-map-image-places"] img')?.getAttribute("src"), "local-file://places.png");
  assert.equal(container.querySelector('[data-testid="study-map-image-places"] img')?.getAttribute("alt"), "Ảnh thật của khu vực kệ sách");
  assert.match(container.querySelector('[data-testid="study-map-image-people"]')?.textContent ?? "", /minh họa chưa sẵn sàng/iu);
  assert.match(container.textContent, new RegExp(longMeaning, "u"));
  assert.match(container.textContent, /\/ʃelf\//u);
  assert.match(container.textContent, /Danh mục ở bên cạnh kệ sách/u);
  assert.match(container.textContent, /The library → Nhóm → shelf/u);
  assert.equal(container.querySelector("svg")?.getAttribute("aria-hidden"), "true");

  await act(async () => container.querySelector('[data-testid="mindmap-list-node-library"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await act(async () => container.querySelector('[data-testid="mindmap-list-node-shelf"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await act(async () => container.querySelector('[data-testid="mindmap-speak-node-shelf"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.deepEqual(selected, ["library", "shelf"]);
  assert.deepEqual(spoken, ["shelf"]);
  assert.equal(container.querySelector('[data-testid="mindmap-list-node-shelf"]').getAttribute("aria-pressed"), "true");

  const toggle = container.querySelector('[data-testid="mindmap-toggle-meanings"]');
  assert.equal(toggle.textContent, "Ẩn nghĩa");
  await act(async () => toggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(toggle.textContent, "Hiện nghĩa");
  assert.equal(container.querySelector('[data-testid="mindmap-meaning-shelf"]'), null);
  assert.equal(container.querySelector('[data-testid="mindmap-meaning-library"]'), null);

  const peopleImageAction = container.querySelector('[data-testid="study-map-image-people"] button');
  await act(async () => peopleImageAction.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.deepEqual(requestedImages, ["people"]);
  const firstPageNodeIds = [...container.querySelectorAll("[data-study-node-id]")].map((element) => element.getAttribute("data-study-node-id"));
  assert.deepEqual(firstPageNodeIds, ["library", "shelf", "catalogue", "librarian", "quiet"]);

  await act(async () => container.querySelector('button[aria-label="Trang tiếp"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(container.querySelector('[data-testid="study-map-page"]').getAttribute("data-page-number"), "2");
  assert.deepEqual([...container.querySelectorAll("[data-study-node-id]")].map((element) => element.getAttribute("data-study-node-id")), ["library", "borrow", "return"]);
  assert.match(container.textContent, /borrow → Trái nghĩa → return/u);
  assert.equal(container.querySelectorAll('[data-testid="study-map-group"]').length, 1);
  assert.equal(changedPositions.length, 0);

  await act(async () => {
    reactRoot.render(React.createElement(MindmapView, { graph: { ...groupedGraph }, illustrationsRequested: true }));
  });
  assert.equal(container.querySelector('[data-testid="study-map-page"]').getAttribute("data-page-number"), "2", "equivalent parsed graph objects keep the reader on the current page");
  await act(async () => container.querySelector('button[aria-label="Trang trước"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await act(async () => {
    reactRoot.render(React.createElement(MindmapView, { graph: { ...groupedGraph }, illustrationsRequested: false }));
  });
  assert.ok(container.querySelector('[data-testid="study-map-image-places"]'), "declared illustration metadata keeps an honest empty slot");
  assert.equal(container.querySelector('[data-testid="study-map-image-people"]'), null, "text-only groups stay compact without an empty image frame");

  await act(async () => {
    reactRoot.render(React.createElement(MindmapView, { graph: { rootNodeId: "solo", nodes: [makeNode("solo")], edges: [] }, onPositionsChange: (positions) => changedPositions.push(positions) }));
  });
  assert.match(container.textContent, /chưa có từ nhánh/iu);
  assert.equal(container.querySelectorAll("[data-study-node-id]").length, 1);
  assert.equal(changedPositions.length, 0);
  await act(async () => reactRoot.unmount());

  const source = await readFile(path.join(projectRoot, "src/renderer/components/learning/mindmap-view.tsx"), "utf8");
  const css = await readFile(path.join(projectRoot, "src/renderer/components/learning/mindmap-study.css"), "utf8");
  assert.doesNotMatch(source, /ReactFlow|MiniMap|onNodeDragStop/u);
  assert.match(source, /ResizeObserver/u);
  assert.match(css, /container-type:\s*inline-size/u);
  assert.match(css, /@container study-map/u);
  assert.match(css, /@container study-group/u);
  assert.match(css, /object-fit:\s*contain/u);
  assert.doesNotMatch(css, /object-fit:\s*cover/u);
  assert.match(css, /font-size:\s*clamp\(1\.5rem, 3\.4cqi, 2rem\)/u);
  assert.match(css, /@container study-group \(max-width: 320px\)/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.equal((source + css).includes(String.fromCodePoint(0x2014)), false);

  console.log("PASS: study map partitions 40 legacy nodes, presents semantic groups by page, preserves every node, maps local images, reveals meanings, speaks nodes, and never writes positions.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
