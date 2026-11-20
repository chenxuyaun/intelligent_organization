import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DEFAULT_DATA_DIR = path.join(ROOT, 'data');

/** 极简 .env 读取：已存在的环境变量优先，不覆盖。 */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

// Resolve path-valued configuration only after the project .env has been loaded.
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;
export const DB_PATH = path.join(DATA_DIR, 'app.db');

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (
    !path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
  );
}

function canonicalPath(target) {
  let existing = path.resolve(target);
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fs.realpathSync(existing), ...suffix);
}

export const PORT = Number(process.env.PORT || 4173);
export const HOST = process.env.HOST || '127.0.0.1';
export const APP_MODE = process.env.APP_MODE === 'product' ? 'product' : 'demo';
export const PRODUCT_MODE = APP_MODE === 'product';
export const ORG_NAME = process.env.ORG_NAME || '示例团队 · IT 支持组';

export const OIDC = {
  issuer: process.env.OIDC_ISSUER || '',
  clientId: process.env.OIDC_CLIENT_ID || '',
  clientSecret: process.env.OIDC_CLIENT_SECRET || '',
  bootstrapAdminEmail: (process.env.OIDC_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase(),
  publicUrl: process.env.APP_PUBLIC_URL || '',
};

export function validateProductConfig() {
  if (!PRODUCT_MODE) return;
  if (!MODEL.apiKey) throw new Error('产品模式必须配置 MODEL_API_KEY，防止真实任务意外使用演示生成器');
  if (!process.env.DATA_DIR || path.resolve(DATA_DIR) === path.resolve(DEFAULT_DATA_DIR)) {
    throw new Error('产品模式必须明确配置独立 DATA_DIR，不能使用项目默认演示数据目录');
  }
  const canonicalRoot = canonicalPath(ROOT);
  const configuredDataDir = path.resolve(DATA_DIR);
  const canonicalDataDir = canonicalPath(DATA_DIR);
  if (
    isWithin(canonicalRoot, configuredDataDir) || isWithin(configuredDataDir, canonicalRoot)
    || isWithin(canonicalRoot, canonicalDataDir) || isWithin(canonicalDataDir, canonicalRoot)
  ) {
    throw new Error('产品模式的 DATA_DIR 必须位于项目目录之外，避免把团队数据混入代码目录');
  }
  for (const [key, value] of Object.entries({
    OIDC_ISSUER: OIDC.issuer,
    OIDC_CLIENT_ID: OIDC.clientId,
    OIDC_CLIENT_SECRET: OIDC.clientSecret,
    OIDC_BOOTSTRAP_ADMIN_EMAIL: OIDC.bootstrapAdminEmail,
    APP_PUBLIC_URL: OIDC.publicUrl,
  })) {
    if (!value) throw new Error(`产品模式缺少必需配置 ${key}`);
  }
  const issuer = new URL(OIDC.issuer);
  const publicUrl = new URL(OIDC.publicUrl);
  if (issuer.protocol !== 'https:' || publicUrl.protocol !== 'https:') {
    throw new Error('产品模式要求 OIDC 与应用使用 HTTPS 地址');
  }
  if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) {
    throw new Error('APP_PUBLIC_URL 只填写站点来源，例如 https://team.example.com');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(OIDC.bootstrapAdminEmail)) {
    throw new Error('OIDC_BOOTSTRAP_ADMIN_EMAIL 必须是有效邮箱地址');
  }
}

export const MODEL = {
  /** 任何 OpenAI 兼容端点：DeepSeek / Qwen / OpenAI / 本地 vLLM 均可 */
  baseUrl: (process.env.MODEL_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
  apiKey: process.env.MODEL_API_KEY || '',
  name: process.env.MODEL_NAME || 'deepseek-chat',
  timeoutMs: Number(process.env.MODEL_TIMEOUT_MS || 45000),
  temperature: Number(process.env.MODEL_TEMPERATURE || 0.2),
};

// TypeSafe is an optional structured-decision sidecar. It is disabled by default
// and the first experiment runs in shadow mode on synthetic sample tickets only.
export const TYPESAFE = {
  apiKey: process.env.TYPESAFE_API_KEY || '',
  model: process.env.TYPESAFE_MODEL || 'jev-latest',
  memoryGateMode: process.env.TYPESAFE_MEMORY_GATE === 'shadow' ? 'shadow' : 'off',
};

export function modelStatus() {
  return {
    configured: Boolean(MODEL.apiKey),
    mode: MODEL.apiKey ? 'live' : 'demo',
    baseUrl: MODEL.baseUrl,
    model: MODEL.name,
    modeLabel: MODEL.apiKey ? (PRODUCT_MODE ? '已配置模型' : '已连接模型') : '演示模式',
    note: PRODUCT_MODE
      ? '产品模式只生成组织建议。模型配置错误或服务不可用时，请求会明确失败，不会改用演示生成器。'
      : MODEL.apiKey
        ? '个人模式与组织模式共用同一系统提示词和回答规则；组织模式额外获得检索到的团队记忆。'
        : '未读取到 MODEL_API_KEY，智能体用本地规则生成结果，仅供走通流程，不代表模型真实能力。',
  };
}
