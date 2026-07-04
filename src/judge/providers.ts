/** Judge providers: OpenAI-compatible chat clients.
 *
 * Selection via environment:
 *   CITEGUARD_JUDGE_URL    - base URL of an OpenAI-compatible endpoint
 *   CITEGUARD_JUDGE_KEY    - API key
 *   CITEGUARD_JUDGE_MODEL  - model name
 *
 * Presets:
 *   qwen        -> DashScope international compatible-mode (qwen-max)
 *   openai      -> api.openai.com (gpt-4o-mini)
 *   anthropic   -> api.anthropic.com OpenAI-compat endpoint (claude haiku)
 */

import type { JudgeClient } from "../types.js";

interface ProviderConfig {
  baseUrl: string;
  model: string;
}

const PRESETS: Record<string, ProviderConfig> = {
  qwen: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen-max",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-4-5-20251001",
  },
};

export class OpenAICompatibleJudge implements JudgeClient {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: { baseUrl: string; apiKey: string; model: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.model = opts.model;
  }

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`judge request failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  }
}

/** Build a judge from environment variables. Throws with a helpful message
 * when no provider is configured. */
export function judgeFromEnv(env: Record<string, string | undefined> = process.env): JudgeClient {
  const preset = env.CITEGUARD_JUDGE_PRESET;
  const key = env.CITEGUARD_JUDGE_KEY;
  if (!key) {
    throw new Error(
      "No judge configured. Set CITEGUARD_JUDGE_KEY (+ CITEGUARD_JUDGE_PRESET=qwen|openai|anthropic, or CITEGUARD_JUDGE_URL + CITEGUARD_JUDGE_MODEL).",
    );
  }
  if (preset && PRESETS[preset]) {
    const cfg = PRESETS[preset];
    return new OpenAICompatibleJudge({
      baseUrl: cfg.baseUrl,
      apiKey: key,
      model: env.CITEGUARD_JUDGE_MODEL ?? cfg.model,
    });
  }
  const baseUrl = env.CITEGUARD_JUDGE_URL;
  const model = env.CITEGUARD_JUDGE_MODEL;
  if (!baseUrl || !model) {
    throw new Error(
      "Set CITEGUARD_JUDGE_PRESET to qwen|openai|anthropic, or provide CITEGUARD_JUDGE_URL and CITEGUARD_JUDGE_MODEL.",
    );
  }
  return new OpenAICompatibleJudge({ baseUrl, apiKey: key, model });
}
