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
import { md5 as md5Hash } from "js-md5";
import type { ChatModelOptions } from "@/lib/chat-model";

type RuntimeAISettings = {
  currentGptEngine?: GptEngineSettingType;
  getProviderConfig?: (name: string) => LlmProviderType;
};

export const useAiCommand = () => {
  const {
    EnjoyApp,
    webApi,
    nativeLanguage,
    learningLanguage,
    apiUrl,
  } = useContext(AppSettingsProviderContext);
  const { currentGptEngine, getProviderConfig } = useContext(
    AISettingsProviderContext
  ) as RuntimeAISettings;

  const providerName = currentGptEngine?.name || "enjoyai";
  const providerConfig = getProviderConfig?.(providerName);
  const engineModels: GptEngineSettingType["models"] =
    currentGptEngine?.models || { default: "gpt-4o" };
  const providerOptions = (modelName?: string): ChatModelOptions => ({
    provider: providerName,
    key: providerConfig?.key ?? currentGptEngine?.key,
    baseUrl:
      providerName === "enjoyai"
        ? apiUrl
          ? `${apiUrl}/api/ai`
          : undefined
        : providerConfig?.baseUrl ?? currentGptEngine?.baseUrl,
    modelName,
  });
  const modelFor = (
    task: "lookup" | "translate" | "analyze" | "extractStory" | "default"
  ) => engineModels[task] || engineModels.default;

  const lookupWord = async (params: {
    word: string;
    context: string;
    sourceId?: string;
    sourceType?: string;
    cacheKey?: string;
    force?: boolean;
  }) => {
    const { context, sourceId, sourceType, cacheKey, force = false } = params;
    let { word } = params;
    word = word.trim();
    if (!word) return;

    const lookup = await webApi.lookup({
      word,
      context,
      sourceId,
      sourceType,
      nativeLanguage,
    });

    if (lookup.meaning && !force) {
      return lookup;
    }

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

    webApi.updateLookup(lookup.id, {
      meaning: res,
      sourceId,
      sourceType,
    });

    const result = Object.assign(lookup, {
      meaning: res,
    });

    if (cacheKey) {
      EnjoyApp.cacheObjects.set(cacheKey, result);
    }

    return result;
  };

  const extractStory = async (story: StoryType) => {
    const res = await extractStoryCommand(
      story.content,
      learningLanguage,
      providerOptions(modelFor("extractStory"))
    );
    const { words = [], idioms = [] } = res;

    return webApi.extractVocabularyFromStory(story.id, {
      words,
      idioms,
    });
  };

  const translate = async (
    text: string,
    cacheKey?: string
  ): Promise<string> => {
    let translatedContent = "";
    const md5 = md5Hash(text.trim());
    const modelName = modelFor("translate");

    try {
      const res = await webApi.translations({
        md5,
        translatedLanguage: nativeLanguage,
        engine: modelName,
      });

      if (res.translations.length > 0) {
        translatedContent = res.translations[0].translatedContent;
      }
    } catch (error) {
      console.error(error);
    }

    if (!translatedContent) {
      translatedContent = await translateCommand(
        text,
        nativeLanguage,
        providerOptions(modelName)
      );

      webApi.createTranslation({
        md5,
        content: text,
        translatedContent,
        language: learningLanguage,
        translatedLanguage: nativeLanguage,
        engine: modelName,
      });
    }

    if (cacheKey) {
      EnjoyApp.cacheObjects.set(cacheKey, translatedContent);
    }

    return translatedContent;
  };

  const analyzeText = async (text: string, cacheKey?: string) => {
    const res = await analyzeCommand(
      text,
      {
        learningLanguage,
        nativeLanguage,
      },
      providerOptions(modelFor("analyze"))
    );

    if (cacheKey) {
      EnjoyApp.cacheObjects.set(cacheKey, res);
    }
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

    if (options?.cacheKey) {
      EnjoyApp.cacheObjects.set(options.cacheKey, result);
    }

    return result;
  };

  return {
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
