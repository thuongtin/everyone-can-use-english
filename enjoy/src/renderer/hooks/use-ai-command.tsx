import {
  AppSettingsProviderContext,
  AISettingsProviderContext,
} from "@renderer/context";
import { useContext } from "react";
import {
  lookupCommand,
  extractStoryCommand,
  translateCommand,
  analyzeCommand,
  punctuateCommand,
  summarizeTopicCommand,
  refineCommand,
  chatSuggestionCommand,
} from "@commands";
import type { ChatModelOptions } from "@/lib/chat-model";
import {
  createLocalLookupRecord,
  createLookupCacheKey,
  createAICacheKey,
} from "@/lib/local-ai-services";

type RuntimeAISettings = {
  currentGptEngine?: GptEngineSettingType;
  getProviderConfig?: (name: string) => LlmProviderType;
};

export const useAiCommand = () => {
  const {
    EnjoyApp,
    nativeLanguage,
    learningLanguage,
  } = useContext(AppSettingsProviderContext);
  const { currentGptEngine, getProviderConfig } = useContext(
    AISettingsProviderContext
  ) as RuntimeAISettings;

  const providerName = currentGptEngine?.name || "needs-selection";
  const providerConfig = getProviderConfig?.(providerName);
  const engineModels: GptEngineSettingType["models"] =
    currentGptEngine?.models || { default: "" };
  const providerOptions = (modelName?: string): ChatModelOptions => ({
    provider: providerName,
    key: providerConfig?.key ?? currentGptEngine?.key,
    baseUrl: providerConfig?.baseUrl ?? currentGptEngine?.baseUrl,
    modelName,
  });
  const modelFor = (
    task: "lookup" | "translate" | "analyze" | "extractStory" | "default"
  ) => engineModels[task] || engineModels.default;

  const cacheScope = (model: string) => ({ nativeLanguage, learningLanguage, provider: providerName, model });
  const lookupCacheKey = (word: string, context: string) =>
    createLookupCacheKey(word, context, cacheScope(modelFor("lookup")));

  const analysisCacheKey = (text: string) =>
    createAICacheKey("analyze", text, cacheScope(modelFor("analyze")));
  const suggestionCacheKey = (context: string, options?: {
    learningLanguage?: string;
    nativeLanguage?: string;
  }) => createAICacheKey("chat-suggestion", context, {
    ...cacheScope(modelFor("default")),
    learningLanguage: options?.learningLanguage || learningLanguage,
    nativeLanguage: options?.nativeLanguage || nativeLanguage,
  });

  const lookupWord = async (params: {
    word: string;
    context: string;
    sourceId?: string;
    sourceType?: string;
    cacheKey?: string;
    force?: boolean;
  }) => {
    const { context, force = false } = params;
    let { word } = params;
    word = word.trim();
    if (!word) return;
    const resolvedCacheKey = lookupCacheKey(word, context);

    if (!force) {
      const cached = await EnjoyApp.cacheObjects.get(resolvedCacheKey);
      if (cached?.meaning) return cached as LookupType;
    }

    const lookup = createLocalLookupRecord({ word, context, nativeLanguage });

    const modelName = modelFor("lookup");

    const res = await lookupCommand(
      {
        word,
        context,
        meaningOptions: lookup.meaningOptions,
        nativeLanguage,
        learningLanguage,
      },
      providerOptions(modelName)
    );

    const result = Object.assign(lookup, {
      meaning: res,
    });

    await EnjoyApp.cacheObjects.set(resolvedCacheKey, result);

    return result;
  };

  const extractStory = async (story: StoryType) => {
    const res = await extractStoryCommand(
      story.content,
      learningLanguage,
      providerOptions(modelFor("extractStory"))
    );
    const { words = [], idioms = [] } = res;

    return { words, idioms };
  };

  const translate = async (
    text: string,
    cacheKey?: string
  ): Promise<string> => {
    void cacheKey;
    const modelName = modelFor("translate");
    const resolvedCacheKey = createAICacheKey("translate", text.trim(), cacheScope(modelName));
    const cached = await EnjoyApp.cacheObjects.get(resolvedCacheKey);
    if (typeof cached === "string" && cached) return cached;
    const translatedContent = await translateCommand(text, nativeLanguage, providerOptions(modelName));
    await EnjoyApp.cacheObjects.set(resolvedCacheKey, translatedContent);

    return translatedContent;
  };

  const analyzeText = async (text: string, cacheKey?: string) => {
    void cacheKey;
    const res = await analyzeCommand(
      text,
      {
        learningLanguage,
        nativeLanguage,
      },
      providerOptions(modelFor("analyze"))
    );

    await EnjoyApp.cacheObjects.set(analysisCacheKey(text), res);
    return res;
  };

  const punctuateText = async (text: string) => {
    return punctuateCommand(text, providerOptions(modelFor("default")));
  };

  const summarizeTopic = async (text: string) => {
    return summarizeTopicCommand(
      text,
      learningLanguage,
      providerOptions(modelFor("default"))
    );
  };

  const refine = async (
    text: string,
    options: {
      learningLanguage?: string;
      nativeLanguage?: string;
      context: string;
    }
  ) => {
    const { context } = options;
    return refineCommand(
      text,
      {
        learningLanguage: options.learningLanguage || learningLanguage,
        nativeLanguage: options.nativeLanguage || nativeLanguage,
        context,
      },
      providerOptions(modelFor("default"))
    );
  };

  const chatSuggestion = async (
    context: string,
    options?: {
      learningLanguage?: string;
      nativeLanguage?: string;
      cacheKey?: string;
    }
  ) => {
    const result = await chatSuggestionCommand(
      {
        context,
        learningLanguage: options?.learningLanguage || learningLanguage,
        nativeLanguage: options?.nativeLanguage || nativeLanguage,
      },
      providerOptions(modelFor("default"))
    );

    await EnjoyApp.cacheObjects.set(suggestionCacheKey(context, options), result);

    return result;
  };

  return {
    lookupCacheKey,
    analysisCacheKey,
    suggestionCacheKey,
    lookupWord,
    extractStory,
    translate,
    analyzeText,
    punctuateText,
    summarizeTopic,
    refine,
    chatSuggestion,
  };
};
