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
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${MODEL.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL.name,
        temperature: MODEL.temperature,
        max_tokens: MODEL.maxOutputTokens,
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
      throw new ModelUnavailableError(`模型服务返回 HTTP ${res.status}`);
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ModelUnavailableError('模型响应不是合法 JSON');
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new ModelUnavailableError('模型响应缺少 content');
    // 用量快照（④§7）：可选用量字段缺失时保持 null，不伪造数字。
    return {
      content,
      model: payload.model || MODEL.name,
      latencyMs: Date.now() - started,
      promptTokens: Number.isFinite(payload?.usage?.prompt_tokens) ? payload.usage.prompt_tokens : null,
      completionTokens: Number.isFinite(payload?.usage?.completion_tokens) ? payload.usage.completion_tokens : null,
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new ModelUnavailableError(`模型超时（>${MODEL.timeoutMs}ms）`);
    throw err instanceof ModelUnavailableError
      ? err
      : new ModelUnavailableError('无法连接模型服务；请检查服务端网络、端点和密钥配置');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Explicit product-admin connectivity check. Sends only a fixed synthetic
 * request, never ticket or memory data, and returns no model-generated text.
 */
export async function checkModelConnection() {
  if (!MODEL.apiKey) throw new ModelUnavailableError('未配置模型密钥');

  const configuredTimeoutMs = Number.isFinite(MODEL.timeoutMs) && MODEL.timeoutMs > 0
    ? MODEL.timeoutMs
    : 15000;
  const timeoutMs = Math.min(configuredTimeoutMs, 15000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${MODEL.baseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${MODEL.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL.name,
        temperature: 0,
        max_tokens: 32,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '这是连通性检查，不处理工单。只返回 JSON：{"ok":true}' },
          { role: 'user', content: '请返回 JSON：{"ok":true}' },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new ModelUnavailableError(`模型服务返回 HTTP ${res.status}`);

    let payload;
    try {
      payload = await res.json();
    } catch {
      throw new ModelUnavailableError('模型服务已响应，但响应不是合法 JSON');
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new ModelUnavailableError('模型服务已响应，但没有返回模型内容');
    }
    let result;
    try {
      result = JSON.parse(content);
    } catch {
      throw new ModelUnavailableError('模型服务已响应，但没有返回预期的 JSON 结果');
    }
    if (result?.ok !== true) {
      throw new ModelUnavailableError('模型服务已响应，但连通性检查未通过');
    }

    return { model: String(payload.model || MODEL.name), latencyMs: Date.now() - started };
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ModelUnavailableError(`连接检查超时（>${timeoutMs}ms）`);
    }
    if (err instanceof ModelUnavailableError) throw err;
    throw new ModelUnavailableError('无法连接模型服务；请检查服务端网络、端点和密钥配置');
  } finally {
    clearTimeout(timer);
  }
}
