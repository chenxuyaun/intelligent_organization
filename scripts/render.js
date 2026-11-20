/**
 * 真实渲染采集：用本机 Chrome 的无头模式截图 + 量几何。
 * 产出 .design/shot-*.png 与 .design/metrics.json（供视觉门禁和人工看图）。
 *
 *   node --no-warnings scripts/render.js [baseUrl]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const OUT = path.join(ROOT, '.design');
const PORT = 9334;

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const BIN = CANDIDATES.find((p) => fs.existsSync(p));
if (!BIN) {
  console.error('找不到 Chrome / Edge，跳过渲染');
  process.exit(3);
}
fs.mkdirSync(OUT, { recursive: true });

const MEASURE = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const main = document.querySelector('main') || document.body;
  const mr = main.getBoundingClientRect();
  // 应用外壳带侧栏，左右边距相对侧栏右沿计算
  const rail = document.querySelector('.rail');
  const railRight = rail ? rail.getBoundingClientRect().right : 0;
  const de = document.documentElement;
  const secs = [...document.querySelectorAll('section')];
  const gaps = [];
  for (let i = 1; i < secs.length; i++) {
    const a = secs[i - 1].getBoundingClientRect(), b = secs[i].getBoundingClientRect();
    const g = Math.round(b.top - a.bottom);
    if (g > 120) gaps.push(g);
  }
  const h1 = document.querySelector('h1');
  let headlineLines = null;
  if (h1) {
    const cs = getComputedStyle(h1);
    headlineLines = Math.round(h1.getBoundingClientRect().height / parseFloat(cs.lineHeight || '20'));
  }
  const untitled = [...document.querySelectorAll('section')].filter(s => !s.querySelector('h1,h2,h3') && !s.getAttribute('aria-label')).length;
  // 首屏横向覆盖：首屏内所有可见元素的左右边界
  let minL = vw, maxR = 0;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > vh) continue;
    if (r.width > vw - 4) continue;
    minL = Math.min(minL, r.left); maxR = Math.max(maxR, r.right);
  }
  const textLens = [...document.querySelectorAll('section')].map(s => (s.innerText || '').trim().length);
  const emptyScreens = textLens.filter(n => n < 40).length;
  const overflows = [...document.querySelectorAll('body *')].filter(el => el.scrollWidth > el.clientWidth + 4 && getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 80).length;
  return {
    margins: { left: Math.round(mr.left - railRight), right: Math.round(vw - mr.right) },
    blankGaps: gaps,
    emptyScreens,
    headlineLines,
    untitledSections: untitled,
    lopsided: Math.abs(minL - (vw - maxR)) > 80 ? 1 : 0,
    firstScreenCoverage: Math.round(((maxR - minL) / vw) * 100),
    docWidth: de.scrollWidth,
    viewport: vw,
    horizontalOverflow: de.scrollWidth > vw + 2 ? 1 : 0,
    overflowNodes: overflows,
    sectionCount: secs.length,
  };
})()`;

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = new Map();
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          id += 1;
          const msgId = id;
          pending.set(msgId, { res, rej });
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      },
      on(name, fn) { events.set(name, fn); },
      close() { ws.close(); },
    }));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method && events.has(msg.method)) {
        events.get(msg.method)(msg.params);
      }
    });
    ws.addEventListener('error', (e) => reject(new Error(`WS 错误：${e.message || 'unknown'}`)));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pages = [
    ['home', `${BASE}/#/`],
    ['ticket', `${BASE}/#/t/5`],
    ['memory', `${BASE}/#/memory`],
    ['settings', `${BASE}/#/settings`],
  ];

  const results = [];
  for (const [name, url] of pages) {
    const tmp = fs.mkdtempSync(path.join(OUT, 'tmp-'));
    const chrome = spawn(BIN, [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${tmp}`,
      '--hide-scrollbars',
      '--window-size=1440,1000',
      '--no-first-run',
      '--disable-gpu',
      url,
    ], { stdio: 'ignore' });

    let cdp = null;
    try {
      let list = null;
      for (let i = 0; i < 40; i += 1) {
        try {
          const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
          const data = await res.json();
          if (data.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) {
            list = data;
            break;
          }
        } catch { /* 等端口起来 */ }
        await sleep(250);
      }
      if (!list) throw new Error('Chrome 调试端口没起来');
      const page = list.find((t) => t.type === 'page');
      cdp = await connect(page.webSocketDebuggerUrl);
      await cdp.send('Page.enable');
      await sleep(1400); // 等前端路由渲染完
      const measured = await cdp.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const file = path.join(OUT, `shot-${name}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      results.push({ page: name, url, ...measured.result.value, shot: path.relative(ROOT, file) });
      console.log(`  ${name.padEnd(9)} 覆盖 ${measured.result.value.firstScreenCoverage}%  溢出 ${measured.result.value.horizontalOverflow}  截图 ${path.relative(ROOT, file)}`);
    } catch (err) {
      console.error(`  ${name} 渲染失败：${err.message}`);
      results.push({ page: name, error: err.message });
    } finally {
      cdp?.close();
      chrome.kill();
      await sleep(300);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const home = results.find((r) => r.page === 'home') || {};
  const dom = {
    margins: home.margins || { left: 0, right: 0 },
    blankGaps: home.blankGaps || [],
    emptyScreens: home.emptyScreens ?? 0,
    headlineLines: home.headlineLines ?? null,
    untitledSections: home.untitledSections ?? 0,
    lopsided: home.lopsided ?? 0,
  };
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(dom, null, 2));
  fs.writeFileSync(path.join(OUT, 'render-report.json'), JSON.stringify(results, null, 2));
  console.log(`\n  写入 .design/metrics.json 与 .design/render-report.json`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
