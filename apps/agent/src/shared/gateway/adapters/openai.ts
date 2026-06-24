/**
 * gateway/adapters/openai.ts
 *
 * Wraps the OpenAI SDK behind the same LLMProvider interface.
 * OpenAI accepts the system message inline in the messages array,
 * so this adapter is even simpler.
 */
import OpenAI from "openai";
import type { LLMProvider, LLMMessage, CompleteOptions } from "../provider.js";

export interface OpenAICompatibleConfig {
  apiKey: string;
  name?: string;
  defaultModel?: string;
  baseURL?: string;
}

export class OpenAIAdapter implements LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  private client: OpenAI;

  constructor(cfg: OpenAICompatibleConfig) {
    this.name = cfg.name ?? "openai";
    this.defaultModel = cfg.defaultModel ?? "gpt-4o-mini";
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      // Behind TLS-inspecting corporate proxies the gzip response stream can be
      // truncated ("Premature close" in Gunzip). Requesting an uncompressed
      // response avoids that failure mode.
      defaultHeaders: { "Accept-Encoding": "identity" },
    });
  }

  async complete(messages: LLMMessage[], opts: CompleteOptions = {}): Promise<string> {
    const model = opts.model ?? this.defaultModel;
    // gpt-5 / o-series "reasoning" models: use `max_completion_tokens` (not the
    // deprecated `max_tokens`), only allow the default temperature, and need a
    // generous token budget since reasoning tokens count against the cap.
    const isReasoning = /^(gpt-5|o1|o3|o4)/i.test(model);

    const body: Record<string, unknown> = {
      model,
      max_completion_tokens: isReasoning
        ? Math.max(opts.maxTokens ?? 1024, 4096)
        : opts.maxTokens ?? 1024,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (!isReasoning) body.temperature = opts.temperature ?? 0.2;

    const res = await this.client.chat.completions.create(body as any);
    return res.choices[0]?.message?.content ?? "";
  }
}
