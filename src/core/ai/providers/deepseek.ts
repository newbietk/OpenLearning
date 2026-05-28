// src/core/ai/providers/deepseek.ts
import { createOpenAIProvider } from "./openai";
import type { ModelProvider } from "../types";

export function createDeepSeekProvider(
  apiKey: string,
  model: string = "deepseek-chat",
): ModelProvider {
  const provider = createOpenAIProvider(apiKey, model, "https://api.deepseek.com");
  return { ...provider, name: "deepseek" };
}
