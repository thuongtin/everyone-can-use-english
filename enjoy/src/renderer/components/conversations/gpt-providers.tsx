import {
  createGptProviders,
  type GptProviderCatalog,
} from "@/lib/ai-providers";

export type { GptProviderCatalog } from "@/lib/ai-providers";

export const GPT_PROVIDERS: GptProviderCatalog = createGptProviders();
