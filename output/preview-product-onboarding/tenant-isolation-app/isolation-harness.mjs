import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.env.ISOLATION_ROOT;
const appRoot = process.cwd();
const cert = fs.readFileSync(path.join(root, 'tls-cert.pem'));
const tlsKey = fs.readFileSync(path.join(root, 'tls-key.pem'));
const dataDirs = [path.join(root, 'team-a-data'), path.join(root, 'team-b-data')];
const chosenPorts = new Set();
const internalPorts = [await freePort(), await freePort()];
const frontPorts = [await freePort(), await freePort()];
const issuerPort = await freePort();
const origins = frontPorts.map((port) => `https://127.0.0.1:${port}`);
const orgNames = ['虚构团队甲', '虚构团队乙'];
const issuer = `https://127.0.0.1:${issuerPort}/`;
let issuerServer;
const proxies = [];
const children = [];
const childErrors = ['', ''];
const clientId = 'synthetic-isolation-client';
const clientSecret = 'synthetic-isolation-secret';
let failure = null;

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function freePort() {
  while (true) {
    const probe = net.createServer();
    const port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));
    if (!chosenPorts.has(port)) {
      chosenPorts.add(port);
      return port;
    }
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function makeProxy(appPort) {
  return https.createServer({ key: tlsKey, cert }, (req, res) => {
    const headers = { ...req.headers, 'x-forwarded-proto': 'https' };
    delete headers.connection;
    const upstream = http.request({ hostname: '127.0.0.1', port: appPort, method: req.method, path: req.url, headers }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502).end('Synthetic isolation proxy could not reach the app');
    });
    req.pipe(upstream);
  });
}

async function ready(baseUrl) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/ready`);
      if (response.status === 200) return await response.json();
    } catch { /* wait for the child listener */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('one product instance did not become ready');
}

async function api(baseUrl, pathname, { cookie, method = 'GET', body, origin = new URL(baseUrl).origin } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers.origin = origin;
  } else if (!['GET', 'HEAD'].includes(method)) headers.origin = origin;
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  });
}

async function json(response) {
  return JSON.parse(await response.text());
}

function installSyntheticAdminSession(index) {
  const db = new DatabaseSync(path.join(dataDirs[index], 'app.db'));
  try {
    const email = 'shared-owner@synthetic.test';
    const member = db.prepare('SELECT id FROM members WHERE lower(email) = ?').get(email);
    assert.ok(member, `bootstrap invitation is missing in team ${index + 1}`);
    const session = `synthetic-team-${index + 1}-${randomBytes(20).toString('base64url')}`;
    const now = new Date().toISOString();
    db.prepare(`UPDATE members SET name = ?, status = 'active', oidc_issuer = ?, oidc_subject = ?, activated_at = ? WHERE id = ?`)
      .run(`虚构管理员${index + 1}`, issuer, 'shared-oidc-subject', now, member.id);
    const tokenHash = createHash('sha256').update(session).digest('hex');
    db.prepare('INSERT INTO auth_sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, member.id, now, new Date(Date.now() + 3_600_000).toISOString());
    return { cookie: `__Host-io_session=${session}`, email };
  } finally {
    db.close();
  }
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (!child.connected) {
    child.kill();
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
    return;
  }
  child.send('shutdown');
  const outcome = await Promise.race([
    once(child, 'exit').then(() => 'exited'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)),
  ]);
  if (outcome === 'timeout') {
    child.kill();
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
}

async function close(server) {
  if (!server?.listening) return;
  server.closeIdleConnections?.();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

try {
  issuerServer = https.createServer({ key: tlsKey, cert }, (req, res) => {
    const url = new URL(req.url, issuer);
    if (url.pathname === '/.well-known/openid-configuration' && req.method === 'GET') {
      return sendJson(res, 200, {
        issuer,
        authorization_endpoint: new URL('/authorize', issuer).href,
        token_endpoint: new URL('/token', issuer).href,
        jwks_uri: new URL('/jwks', issuer).href,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        grant_types_supported: ['authorization_code'],
        scopes_supported: ['openid', 'email', 'profile'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.pathname === '/jwks' && req.method === 'GET') return sendJson(res, 200, { keys: [] });
    res.writeHead(404).end();
  });
  await listen(issuerServer, issuerPort);

  const appEnvs = [];
  for (let index = 0; index < 2; index += 1) {
    const proxy = makeProxy(internalPorts[index]);
    await listen(proxy, frontPorts[index]);
    proxies.push(proxy);
    appEnvs.push({
      ...process.env,
      APP_MODE: 'product',
      DATA_DIR: dataDirs[index],
      HOST: '127.0.0.1',
      PORT: String(internalPorts[index]),
      ORG_NAME: orgNames[index],
      APP_PUBLIC_URL: origins[index],
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: clientId,
      OIDC_CLIENT_SECRET: clientSecret,
      OIDC_BOOTSTRAP_ADMIN_EMAIL: 'shared-owner@synthetic.test',
      MODEL_API_KEY: 'synthetic-not-used',
      MODEL_BASE_URL: 'https://model.invalid/v1',
      MODEL_NAME: 'synthetic-no-call',
    });
    const child = fork(path.join(appRoot, 'isolation-start.mjs'), [], {
      cwd: appRoot,
      env: appEnvs[index],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.stdout.on('data', () => {});
    child.stderr.on('data', (chunk) => { childErrors[index] += chunk.toString(); });
    children.push(child);
  }

  const readiness = await Promise.all(origins.map((origin) => ready(origin)));
  assert.ok(readiness.every((item) => item.mode === 'product' && item.checks.database === 'ok' && item.checks.modelConfiguration === 'configured'));
  const status = await Promise.all(origins.map(async (origin) => json(await api(origin, '/api/auth/status'))));
  assert.deepEqual(status.map((item) => item.organization), orgNames);

  const sessions = [installSyntheticAdminSession(0), installSyntheticAdminSession(1)];
  const ownUsers = await Promise.all(origins.map(async (origin, index) => json(await api(origin, '/api/auth/me', { cookie: sessions[index].cookie }))));
  assert.ok(ownUsers.every((item) => item.authenticated && item.user.email === sessions[0].email));
  const foreignUsers = await Promise.all([
    json(await api(origins[0], '/api/auth/me', { cookie: sessions[1].cookie })),
    json(await api(origins[1], '/api/auth/me', { cookie: sessions[0].cookie })),
  ]);
  assert.ok(foreignUsers.every((item) => item.authenticated === false));
  const foreignTicketLists = await Promise.all([
    api(origins[0], '/api/tickets', { cookie: sessions[1].cookie }),
    api(origins[1], '/api/tickets', { cookie: sessions[0].cookie }),
  ]);
  assert.ok(foreignTicketLists.every((response) => response.status === 401));

  const ticketTitles = ['租户甲独有的虚构工单', '租户乙独有的虚构工单'];
  for (let index = 0; index < 2; index += 1) {
    const response = await api(origins[index], '/api/tickets', {
      cookie: sessions[index].cookie,
      method: 'POST',
      body: {
        title: ticketTitles[index],
        description: `这是${orgNames[index]}的隔离验收工单，只用于验证数据边界。`,
        sourceRef: '隔离验收合成记录',
        authorizedBy: '虚构验收负责人',
        desensitization: 'not_needed',
      },
    });
    assert.equal(response.status, 201);
  }

  const lists = await Promise.all(origins.map(async (origin, index) => {
    const response = await api(origin, '/api/tickets', { cookie: sessions[index].cookie });
    assert.equal(response.status, 200);
    return (await json(response)).tickets;
  }));
  assert.deepEqual(lists.map((items) => items.map((ticket) => ticket.title)), [[ticketTitles[0]], [ticketTitles[1]]]);

  const state = await Promise.all(origins.map(async (origin, index) => json(await api(origin, '/api/state', { cookie: sessions[index].cookie }))));
  assert.deepEqual(state.map((item) => item.org.name), orgNames);
  assert.deepEqual(state.map((item) => item.metrics.tickets.total), [1, 1]);

  const exports = [];
  for (let index = 0; index < 2; index += 1) {
    const response = await api(origins[index], '/api/admin/export', { cookie: sessions[index].cookie, method: 'POST', body: {} });
    assert.equal(response.status, 200);
    const raw = await response.text();
    const bundle = JSON.parse(raw);
    assert.equal(bundle.organization, orgNames[index]);
    assert.deepEqual(bundle.data.tickets.map((ticket) => ticket.title), [ticketTitles[index]]);
    assert.equal(raw.includes(ticketTitles[1 - index]), false);
    assert.equal(raw.includes(sessions[index].cookie.split('=', 2)[1]), false);
    exports.push(bundle);
  }

  for (let index = 0; index < 2; index += 1) {
    const response = await api(origins[index], '/api/auth/logout', { cookie: sessions[index].cookie, method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal((await json(await api(origins[index], '/api/auth/me', { cookie: sessions[index].cookie }))).authenticated, false);
  }

  const summaries = [];
  for (let index = 0; index < 2; index += 1) {
    const db = new DatabaseSync(path.join(dataDirs[index], 'app.db'), { readOnly: true });
    try {
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      summaries.push({
        org: orgNames[index],
        members: db.prepare("SELECT COUNT(*) AS n FROM members WHERE status <> 'sample'").get().n,
        tickets: db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n,
        sessionsAfterLogout: db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,
        oidcFlows: db.prepare('SELECT COUNT(*) AS n FROM oidc_login_flows').get().n,
      });
    } finally {
      db.close();
    }
  }
  assert.deepEqual(summaries.map((item) => [item.members, item.tickets, item.sessionsAfterLogout, item.oidcFlows]), [[1, 1, 0, 0], [1, 1, 0, 0]]);

  await Promise.all(children.map((child) => stop(child)));
  for (let index = 0; index < 2; index += 1) {
    assert.equal(children[index].exitCode, 0);
    assert.equal(fs.existsSync(path.join(dataDirs[index], 'app.lock')), false);
  }
  console.log(JSON.stringify({
    instances: 2,
    organizations: orgNames,
    separateDataDirs: path.resolve(dataDirs[0]) !== path.resolve(dataDirs[1]),
    crossInstanceSessionsRejected: true,
    ticketListsIsolated: true,
    exportsIsolated: true,
    logoutRevokesEachSession: true,
    sqliteIntegrity: summaries.map((item) => item.org + ':ok'),
    lockReleasedOnBoth: true,
    modelCalls: 0,
    syntheticSummary: summaries,
  }, null, 2));
} catch (error) {
  failure = error;
} finally {
  await Promise.all(children.map((child) => stop(child).catch(() => {})));
  await Promise.all(proxies.map((proxy) => close(proxy).catch(() => {})));
  await close(issuerServer).catch(() => {});
}

if (failure) {
  console.error(`Isolation drill stopped: ${failure.name}: ${failure.message}`);
  if (childErrors.some(Boolean)) console.error(`Child startup stderr present: ${childErrors.map((value) => value.length).join(',')}`);
  process.exitCode = 1;
}
