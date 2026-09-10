import { md5 } from "js-md5";

export type AICacheScope = {
  nativeLanguage?: string;
  learningLanguage?: string;
  provider?: string;
  model?: string;
};

export const createAICacheKey = (kind: string, content: string, scope: AICacheScope): string =>
  `ai-v2-${kind}-${md5(JSON.stringify([content, scope.nativeLanguage || "", scope.learningLanguage || "", scope.provider || "", scope.model || ""]))}`;

export const createLookupCacheKey = (word: string, context: string, scope: AICacheScope = {}): string =>
  createAICacheKey("lookup", JSON.stringify([word.trim(), context || ""]), scope);

export const createLocalLookupRecord = (params: {
  word: string;
  context: string;
  nativeLanguage?: string;
  now?: string;
}): LookupType => {
  const word = params.word.trim();
  const context = params.context || "";
  const timestamp = params.now || new Date().toISOString();
  const identity = md5(JSON.stringify([word, context, params.nativeLanguage || ""]));
  return {
    id: `local-${identity}`,
    word,
    context,
    contextTranslation: "",
    meaningOptions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};
