import { MODEL, modelStatus } from './config.js';

export class ModelUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

/**
 * OpenAI 兼容的对话补全。
 * 支持 DeepSeek / Qwen(DashScope 兼容模式) / OpenAI / 本地 vLLM。
 * 只从环境变量读密钥，绝不落库、绝不返回给前端。
 */
export async function completeJson({ system, user }) {
  const status = modelStatus();
  if (!status.configured) throw new ModelUnavailableError('未配置 MODEL_API_KEY');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL.timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${MODEL.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${MODEL.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL.name,
        temperature: MODEL.temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new ModelUnavailableError(`模型返回 ${res.status}：${text.slice(0, 300)}`);
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ModelUnavailableError('模型响应不是合法 JSON');
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new ModelUnavailableError('模型响应缺少 content');
    return { content, model: payload.model || MODEL.name, latencyMs: Date.now() - started };
  } catch (err) {
    if (err.name === 'AbortError') throw new ModelUnavailableError(`模型超时（>${MODEL.timeoutMs}ms）`);
    throw err instanceof ModelUnavailableError ? err : new ModelUnavailableError(err.message);
  } finally {
    clearTimeout(timer);
  }
}
