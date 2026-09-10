import {
  normalizeModelList,
  type GptEngineSelection,
  type ProviderConfig,
} from "./ai-providers";

/** Keeps Learning Studio aligned with the Azure deployment selected in AI Services. */
export function resolveAzureLearningModel(
  config: Pick<ProviderConfig, "model" | "models">,
  engine: GptEngineSelection | null | undefined,
): string | undefined {
  const configured = normalizeModelList([config.model, config.models]);
  const selected = engine?.name === "azure-openai" && typeof engine.models?.default === "string"
    ? engine.models.default.trim()
    : "";
  return selected && configured.includes(selected) ? selected : configured[0];
}
