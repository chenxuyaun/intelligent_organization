/**
 * 前后端共享的提示词版本常量（单一事实来源）。
 * 服务端（server/index.js 启动断言）与本文件同读一处；public/app.js 以 ES module 引入。
 * 修改提示词时：只改这里 + server/agent.js PROMPT_VERSION 之一，另一侧引用它。
 */
export const UI_PROMPT_VERSION = 'support-agent-v4.0-matched';
