import type { Database, LlmProviderRecord } from "../../lib/db/interface";
import type { ModelProvider } from "../../core/ai/types";
import { encrypt, decrypt } from "../../lib/security";
import { createOpenAIProvider } from "../../core/ai/providers/openai";
import { createAnthropicProvider } from "../../core/ai/providers/anthropic";
import { createDeepSeekProvider } from "../../core/ai/providers/deepseek";

export interface AddProviderInput {
  externalUserId: string;
  provider: string;
  apiKey: string;
  baseUrl: string | null;
}

export interface EnabledProvider {
  provider: string;
  apiKey: string;
  baseUrl: string | null;
}

export function createLlmConfigService(db: Database) {
  return {
    // ── CRUD ──────────────────────────────────────────────────────────────

    listProviders(externalUserId: string): LlmProviderRecord[] {
      return db.llmProvider.findByUser(externalUserId);
    },

    addProvider(input: AddProviderInput): LlmProviderRecord {
      const apiKeyEncrypted = encrypt(input.apiKey);
      return db.llmProvider.create({
        externalUserId: input.externalUserId,
        provider: input.provider,
        apiKeyEncrypted,
        baseUrl: input.baseUrl,
        enabled: true,
      });
    },

    updateProvider(
      id: string,
      data: Partial<{ apiKeyEncrypted: string; baseUrl: string | null; enabled: boolean }>,
    ): void {
      db.llmProvider.update(id, data);
    },

    deleteProvider(id: string): void {
      db.llmProvider.delete(id);
    },

    // ── Runtime ───────────────────────────────────────────────────────────

    getEnabledProvider(externalUserId: string, provider: string): EnabledProvider | undefined {
      const record = db.llmProvider.findEnabled(externalUserId, provider);
      if (!record) return undefined;
      return {
        provider: record.provider,
        apiKey: decrypt(record.apiKeyEncrypted),
        baseUrl: record.baseUrl,
      };
    },

    buildProviderInstance(externalUserId: string, provider: string): ModelProvider {
      const enabled = this.getEnabledProvider(externalUserId, provider);
      if (!enabled) throw new Error(`No enabled ${provider} provider found for user`);

      switch (provider) {
        case "openai":
          return createOpenAIProvider(enabled.apiKey, undefined, enabled.baseUrl ?? undefined);
        case "anthropic":
          return createAnthropicProvider(enabled.apiKey);
        case "deepseek":
          return createDeepSeekProvider(enabled.apiKey);
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
    },
  };
}
