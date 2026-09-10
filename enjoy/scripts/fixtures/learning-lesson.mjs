export const learningBrief = {
  topic: "A cup of tea", keywords: ["cup"], level: "A2", length: "short", imageCount: 0, audio: false,
  targets: [{ id: "cup", term: "cup", sense: "a drinking container", definition: "A small container for a drink.", translationVi: "cốc", example: "I have a cup of tea." }],
};
export const learningDraft = {
  title: "A cup of tea",
  sections: [{ id: "section-one", text: "I am at a small cafe with my friend. The cafe is quiet and warm. I ask for a cup of tea. My friend has a cup of coffee. We sit near the window and talk about our day. The tea is hot, so I wait a little before I drink it.", targetIds: ["cup"] }],
  glossary: [{ targetId: "cup", definition: "A small container for a drink.", translationVi: "cốc", example: "I have a cup of tea." }],
  scenes: [], entityDescriptions: [],
  exercises: [
    { id: "meaning-cup", kind: "meaning", prompt: "What is a cup?", targetIds: ["cup"], choices: [{ id: "container", text: "A small container for a drink" }, { id: "animal", text: "A small animal" }], answerChoiceIds: ["container"] },
    { id: "fill-cup", kind: "fill", prompt: "I have a ___ of tea.", targetIds: ["cup"], acceptedAnswers: ["cup"] },
    { id: "order-cup", kind: "order", prompt: "Put the words in order.", targetIds: ["cup"], tokens: [{ id: "my", text: "My" }, { id: "cup", text: "cup" }], acceptedOrders: [["my", "cup"]] },
    { id: "retell-cup", kind: "retell", prompt: "Tell a friend about your drink.", targetIds: ["cup"], hints: ["What is in your cup?"] },
  ],
};
export const learningMap = {
  rootNodeId: "cup", nodes: [
    { id: "cup", term: "cup", sense: "a drinking container", definition: "A small container for a drink.", translationVi: "cốc", example: "I have a cup of tea.", partOfSpeech: "noun", evidence: { status: "unverified" } },
    { id: "tea", term: "tea", sense: "a hot drink", definition: "A drink made with tea leaves.", translationVi: "trà", example: "The tea is hot.", partOfSpeech: "noun", ipa: "/tiː/", evidence: { status: "unverified" } },
  ], edges: [{ id: "cup-tea", source: "cup", target: "tea", kind: "collocation", evidence: { status: "unverified" } }],
  studyGroups: [{
    id: "drink-words",
    title: "Drink words",
    translationVi: "Từ về đồ uống",
    nodeIds: ["tea"],
    example: "I drink tea from a cup.",
    exampleTranslationVi: "Tôi uống trà bằng cốc.",
  }],
};
