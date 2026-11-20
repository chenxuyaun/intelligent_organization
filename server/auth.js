import { createHash, randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { APP_MODE, OIDC, ORG_NAME, PRODUCT_MODE } from './config.js';
import { nowIso } from './time.js';

const SESSION_COOKIE = '__Host-io_session';
const LOGIN_COOKIE = '__Host-io_login';
const SESSION_HOURS = 8;
const LOGIN_FLOW_MINUTES = 10;
const INVITE_DAYS = 7;
const MEMBER_ROLES = ['admin', 'member', 'viewer'];
const COOKIE_BASE = 'Path=/; HttpOnly; Secure; SameSite=Lax';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const addMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const addHours = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();
const addDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const isFuture = (iso) => Boolean(iso && Date.parse(iso) > Date.now());

function cookieValue(req, name) {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== name) continue;
    return part.slice(at + 1).trim();
  }
  return '';
}

function appendCookie(res, value) {
  const existing = res.getHeader('set-cookie');
  const values = Array.isArray(existing) ? existing : existing ? [existing] : [];
  res.setHeader('set-cookie', [...values, value]);
}

function setCookie(res, name, value, maxAgeSeconds) {
  appendCookie(res, `${name}=${value}; ${COOKIE_BASE}; Max-Age=${maxAgeSeconds}`);
}

function clearCookie(res, name) {
  appendCookie(res, `${name}=; ${COOKIE_BASE}; Max-Age=0`);
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function publicMember(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, status: row.status };
}

export async function createAuth(db) {
  if (!PRODUCT_MODE) {
    return {
      mode: APP_MODE,
      enabled: false,
      async handlePublic(_req, res, url) {
        if (url.pathname === '/api/auth/status' && _req.method === 'GET') {
          json(res, 200, { mode: APP_MODE, enabled: false });
          return true;
        }
        if (url.pathname === '/api/auth/me' && _req.method === 'GET') {
          json(res, 200, { authenticated: false, user: null });
          return true;
        }
        return false;
      },
      currentUser() { return null; },
      csrfAllowed() { return true; },
      listMembers() { return []; },
      inviteMember() { return { error: '团队成员管理只在产品模式启用' }; },
      updateMember() { return { error: '团队成员管理只在产品模式启用' }; },
    };
  }

  const issuer = new URL(OIDC.issuer).href;
  const redirectUri = new URL('/api/auth/callback', OIDC.publicUrl).href;
  const profileName = db.prepare('SELECT display_name FROM workspace_profile WHERE id = 1');
  const workspaceName = () => profileName.get()?.display_name || ORG_NAME;
  const oidcConfig = await oidc.discovery(new URL(issuer), OIDC.clientId, OIDC.clientSecret);

  const memberByEmail = db.prepare('SELECT * FROM members WHERE lower(email) = ? LIMIT 1');
  const memberByIdentity = db.prepare('SELECT * FROM members WHERE oidc_issuer = ? AND oidc_subject = ? LIMIT 1');
  const sessionByHash = db.prepare(`SELECT s.token_hash, s.expires_at, m.*
                                    FROM auth_sessions s JOIN members m ON m.id = s.member_id
                                    WHERE s.token_hash = ? AND m.status = 'active'`);

  // Product mode is invite-only. Keep the bootstrap invitation short-lived; an operator restart can renew an expired one.
  const adminCount = db.prepare(`SELECT COUNT(*) AS n FROM members
                                 WHERE role = 'admin' AND (status = 'active'
                                   OR (status = 'invited' AND (invite_expires_at IS NULL OR invite_expires_at > ?)))`)
    .get(nowIso()).n;
  const bootstrapAdmin = memberByEmail.get(OIDC.bootstrapAdminEmail);
  if (adminCount === 0) {
    if (bootstrapAdmin?.status === 'invited' && bootstrapAdmin.role === 'admin') {
      if (!bootstrapAdmin.invite_expires_at || !isFuture(bootstrapAdmin.invite_expires_at)) {
        db.prepare(`UPDATE members SET invited_at = ?, invite_expires_at = ?
                    WHERE id = ? AND status = 'invited' AND role = 'admin'`)
          .run(nowIso(), addDays(INVITE_DAYS), bootstrapAdmin.id);
      }
    } else if (bootstrapAdmin) {
      throw new Error('产品工作区没有可用管理员，且初始管理员邮箱已对应非待邀请记录；请由部署运维人员核对工作区与身份配置。');
    } else {
      const invitedAt = nowIso();
      db.prepare(`INSERT INTO members (name, role, email, status, invited_at, invite_expires_at)
                  VALUES (?, 'admin', ?, 'invited', ?, ?)`)
        .run(OIDC.bootstrapAdminEmail, OIDC.bootstrapAdminEmail, invitedAt, addDays(INVITE_DAYS));
    }
  }

  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(nowIso());
  db.prepare('DELETE FROM oidc_login_flows WHERE expires_at <= ?').run(nowIso());

  function currentUser(req) {
    const raw = cookieValue(req, SESSION_COOKIE);
    if (!raw) return null;
    const row = sessionByHash.get(sha256(raw));
    if (!row || !isFuture(row.expires_at)) {
      if (row) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(row.token_hash);
      return null;
    }
    return publicMember(row);
  }

  function csrfAllowed(req) {
    const origin = String(req.headers.origin || '');
    return origin === new URL(OIDC.publicUrl).origin;
  }

  function activateInvitedMember(claims) {
    const email = normalizeEmail(claims.email);
    const subject = String(claims.sub || '');
    if (!subject || !email || claims.email_verified !== true) return null;

    const existingIdentity = memberByIdentity.get(issuer, subject);
    if (existingIdentity) return existingIdentity.status === 'active' ? existingIdentity : null;

    const invited = memberByEmail.get(email);
    if (!invited || invited.status !== 'invited') return null;
    if (invited.invite_expires_at && !isFuture(invited.invite_expires_at)) return null;
    if (invited.oidc_subject) return null;

    const name = String(claims.name || claims.given_name || email).trim().slice(0, 80) || email;
    const result = db.prepare(`UPDATE members
                               SET name = ?, oidc_issuer = ?, oidc_subject = ?, status = 'active', activated_at = ?
                               WHERE id = ? AND status = 'invited' AND oidc_subject IS NULL`)
      .run(name, issuer, subject, nowIso(), invited.id);
    return result.changes === 1 ? db.prepare('SELECT * FROM members WHERE id = ?').get(invited.id) : null;
  }

  function createSession(member, res) {
    const raw = randomToken();
    db.prepare('INSERT INTO auth_sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(raw), member.id, nowIso(), addHours(SESSION_HOURS));
    setCookie(res, SESSION_COOKIE, raw, SESSION_HOURS * 3600);
  }

  async function beginLogin(req, res) {
    const loggedIn = currentUser(req);
    if (loggedIn) {
      res.writeHead(302, { location: '/#/' }).end();
      return;
    }

    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    const browser = randomToken();
    const created = nowIso();
    db.prepare(`INSERT INTO oidc_login_flows
                (state_hash, browser_hash, nonce, code_verifier, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(sha256(state), sha256(browser), nonce, verifier, created, addMinutes(LOGIN_FLOW_MINUTES));
    const target = oidc.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    setCookie(res, LOGIN_COOKIE, browser, LOGIN_FLOW_MINUTES * 60);
    res.writeHead(302, { location: target.href, 'cache-control': 'no-store' }).end();
  }

  async function finishLogin(req, res, url) {
    const loginRedirect = (reason) => {
      res.writeHead(302, { location: `/#/login?authError=${reason}`, 'cache-control': 'no-store' }).end();
    };
    const state = url.searchParams.get('state') || '';
    const browser = cookieValue(req, LOGIN_COOKIE);
    const flow = state ? db.prepare('SELECT * FROM oidc_login_flows WHERE state_hash = ?').get(sha256(state)) : null;
    clearCookie(res, LOGIN_COOKIE);
    if (!flow || !browser || flow.browser_hash !== sha256(browser) || !isFuture(flow.expires_at)) {
      if (flow) db.prepare('DELETE FROM oidc_login_flows WHERE state_hash = ?').run(flow.state_hash);
      json(res, 400, { error: '登录请求已过期或无法验证，请重新登录' });
      return;
    }
    db.prepare('DELETE FROM oidc_login_flows WHERE state_hash = ?').run(flow.state_hash);
    if (url.searchParams.has('error')) {
      loginRedirect('provider');
      return;
    }

    const callbackUrl = new URL('/api/auth/callback', OIDC.publicUrl);
    callbackUrl.search = url.search;
    const tokens = await oidc.authorizationCodeGrant(oidcConfig, callbackUrl, {
      expectedState: state,
      expectedNonce: flow.nonce,
      pkceCodeVerifier: flow.code_verifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    const member = claims ? activateInvitedMember(claims) : null;
    if (!member) {
      loginRedirect('not-invited');
      return;
    }

    createSession(member, res);
    res.writeHead(302, { location: '/#/', 'cache-control': 'no-store' }).end();
  }

  function inviteMember({ email: rawEmail, role, inviterId }) {
    const email = normalizeEmail(rawEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: '请输入有效邮箱地址' };
    if (!MEMBER_ROLES.includes(role)) return { error: '角色必须是管理员、成员或只读者' };
    const existing = memberByEmail.get(email);
    if (existing?.status === 'active') return { error: '这个邮箱已经是团队成员' };
    if (existing?.status === 'disabled') return { error: '这个邮箱对应已停用成员；请在成员列表中重新启用' };

    const expiresAt = addDays(INVITE_DAYS);
    let memberId;
    if (existing) {
      db.prepare(`UPDATE members SET role = ?, invite_expires_at = ?, invited_at = ?, name = ?
                  WHERE id = ? AND status = 'invited'`)
        .run(role, expiresAt, nowIso(), email, existing.id);
      memberId = existing.id;
    } else {
      const info = db.prepare(`INSERT INTO members (name, role, email, status, invited_at, invite_expires_at)
                               VALUES (?, ?, ?, 'invited', ?, ?)`)
        .run(email, role, email, nowIso(), expiresAt);
      memberId = Number(info.lastInsertRowid);
    }
    const inviter = db.prepare('SELECT name FROM members WHERE id = ?').get(inviterId);
    db.prepare(`INSERT INTO events (ticket_id, kind, actor, actor_member_id, summary, payload, created_at)
                VALUES (NULL, 'member_invited', ?, ?, ?, ?, ?)`)
      .run(inviter?.name || 'team-admin', inviterId, `邀请团队成员 ${email}`, JSON.stringify({ email, role }), nowIso());
    return { member: publicMember(db.prepare('SELECT * FROM members WHERE id = ?').get(memberId)), loginUrl: `${OIDC.publicUrl}/#/login` };
  }

  function listMembers() {
    return db.prepare(`SELECT id, name, role, email, status, invited_at, invite_expires_at, activated_at
                       FROM members WHERE status <> 'sample' ORDER BY id`).all();
  }

  function updateMember(memberId, patch, actor, actorMemberId = null) {
    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
    if (!member || member.status === 'sample') return { error: '没有这个团队成员' };
    const role = patch.role === undefined ? member.role : patch.role;
    const status = patch.status === undefined ? member.status : patch.status;
    if (!MEMBER_ROLES.includes(role)) return { error: '角色必须是管理员、成员或只读者' };
    if (!['active', 'disabled', 'invited'].includes(status)) return { error: '成员状态无效' };
    if (status === 'invited' && member.status !== 'invited') return { error: '已加入或已停用成员不能改回待邀请状态；如需恢复，请重新启用成员' };
    if (member.status === 'invited' && status !== 'invited') return { error: '待接受邀请的成员请通过重新邀请或等待邀请过期管理' };
    if (member.status === 'active' && (status !== 'active' || role !== 'admin') && member.role === 'admin') {
      const admins = db.prepare(`SELECT COUNT(*) AS n FROM members WHERE role = 'admin' AND status = 'active'`).get().n;
      if (admins <= 1) return { error: '团队至少需要保留一位启用中的管理员' };
    }
    db.prepare('UPDATE members SET role = ?, status = ? WHERE id = ?').run(role, status, memberId);
    if (status !== 'active') db.prepare('DELETE FROM auth_sessions WHERE member_id = ?').run(memberId);
    db.prepare(`INSERT INTO events (ticket_id, kind, actor, actor_member_id, summary, payload, created_at)
                VALUES (NULL, 'member_updated', ?, ?, ?, ?, ?)`)
      .run(String(actor), actorMemberId, `更新团队成员 ${member.email}`, JSON.stringify({ memberId, role, status }), nowIso());
    return { member: publicMember(db.prepare('SELECT * FROM members WHERE id = ?').get(memberId)) };
  }

  function logout(req, res) {
    const raw = cookieValue(req, SESSION_COOKIE);
    if (raw) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(raw));
    clearCookie(res, SESSION_COOKIE);
    json(res, 200, { ok: true });
  }

  return {
    mode: APP_MODE,
    enabled: true,
    currentUser,
    csrfAllowed,
    listMembers,
    inviteMember,
    updateMember,
    async handlePublic(req, res, url) {
      if (url.pathname === '/api/auth/status' && req.method === 'GET') {
        json(res, 200, { mode: APP_MODE, enabled: true, organization: workspaceName() });
        return true;
      }
      if (url.pathname === '/api/auth/me' && req.method === 'GET') {
        json(res, 200, { authenticated: Boolean(currentUser(req)), user: currentUser(req) });
        return true;
      }
      if (url.pathname === '/api/auth/login' && req.method === 'GET') {
        await beginLogin(req, res);
        return true;
      }
      if (url.pathname === '/api/auth/callback' && req.method === 'GET') {
        await finishLogin(req, res, url);
        return true;
      }
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        if (!csrfAllowed(req)) {
          json(res, 403, { error: '请求来源无法验证' });
          return true;
        }
        logout(req, res);
        return true;
      }
      return false;
    },
  };
}
