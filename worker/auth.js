import { execute, one, transaction } from "./db.js";
import {
  addMs,
  allowedRedirect,
  b64url,
  bearer,
  fail,
  hmacHex,
  json,
  nowIso,
  parseJson,
  randomToken,
  readJson,
  secret,
  sha256Hex,
  timingSafeEqual,
  unb64url,
} from "./http.js";

const ACCESS_MS = 60 * 60 * 1000;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const LINK_MS = 60 * 60 * 1000;

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    app_metadata: parseJson(row.app_metadata, {}),
    user_metadata: parseJson(row.user_metadata, {}),
    created_at: row.created_at,
  };
}

function sessionPayload(accessToken, refreshToken, user) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Math.floor(ACCESS_MS / 1000),
    expires_at: Math.floor((Date.now() + ACCESS_MS) / 1000),
    token_type: "bearer",
    user: publicUser(user),
  };
}

async function hashPassword(password, pepper) {
  const salt = randomToken(16);
  const hash = await hmacHex(pepper, `${salt}:${password}`);
  return `hmac$${salt}$${hash}`;
}

async function verifyPassword(password, stored, pepper) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "hmac" || !salt || !hash || !pepper) return false;
  const actual = await hmacHex(pepper, `${salt}:${password}`);
  return timingSafeEqual(actual, hash);
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function displayName(email, metadata) {
  const meta = metadata || {};
  return meta.full_name || meta.name || (email ? email.split("@")[0] : "Usuário");
}

async function promoteAdmin(env, user) {
  const emails = secret(env, "READEDY_ADMIN_EMAILS")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const meta = parseJson(user.app_metadata, {});
  if (!emails.includes(cleanEmail(user.email)) || meta.role === "admin") return user;
  meta.role = "admin";
  const encoded = JSON.stringify(meta);
  await execute(env, "UPDATE users SET app_metadata = ? WHERE id = ?", [encoded, user.id]);
  return { ...user, app_metadata: encoded };
}

async function createSession(env, user, request) {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const now = nowIso();
  await execute(
    env,
    `INSERT INTO auth_sessions
      (id, user_id, token_hash, refresh_hash, expires_at, access_expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      user.id,
      await sha256Hex(accessToken),
      await sha256Hex(refreshToken),
      addMs(REFRESH_MS),
      addMs(ACCESS_MS),
      request.headers.get("cf-connecting-ip") || "",
      (request.headers.get("user-agent") || "").slice(0, 512),
    ],
  );
  await execute(env, "UPDATE users SET last_sign_in_at = ? WHERE id = ?", [now, user.id]);
  return sessionPayload(accessToken, refreshToken, user);
}

async function userByAccessToken(env, token) {
  if (!token || token === "readedy-public") return null;
  const row = await one(
    env,
    `SELECT u.id, u.email, u.app_metadata, u.user_metadata, u.created_at
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.access_expires_at > ?`,
    [await sha256Hex(token), nowIso()],
  );
  return row;
}

export async function userFromRequest(request, env) {
  return userByAccessToken(env, bearer(request));
}

async function requireUser(request, env) {
  const user = await userFromRequest(request, env);
  if (!user) throw fail("Unauthorized", 401);
  return user;
}

function redirectWithSession(target, session, type) {
  const url = new URL(target);
  const user = b64url(JSON.stringify(session.user));
  url.hash = `access_token=${encodeURIComponent(session.access_token)}&refresh_token=${encodeURIComponent(session.refresh_token)}&expires_in=${session.expires_in}&token_type=bearer&type=${encodeURIComponent(type || "")}&user=${user}`;
  return Response.redirect(url.toString(), 302);
}

async function sendEmail(env, to, subject, html) {
  const key = secret(env, "RESEND_API_KEY");
  if (!key) {
    throw fail("Envio de e-mail não configurado. Use e-mail e senha, ou peça para configurar o remetente.", 503);
  }
  const from = secret(env, "AUTH_EMAIL_FROM") || "ReadEdy <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[auth email]", response.status, detail.slice(0, 300));
    throw fail("Não foi possível enviar o e-mail", 502);
  }
}

function emailHtml(title, text, link, label) {
  return `<div style="font-family:Arial,sans-serif;background:#0a0b10;padding:32px 16px;color:#fff">
    <div style="max-width:480px;margin:0 auto;background:#161821;border:1px solid #2a2d3a;border-radius:16px;padding:28px 24px">
      <div style="font-size:28px;font-weight:800;margin-bottom:16px">ReadEdy</div>
      <h1 style="font-size:22px;margin:0 0 12px">${title}</h1>
      <p style="color:#c9cdd8;line-height:1.55">${text}</p>
      <p style="text-align:center;margin:24px 0"><a href="${link}" style="display:inline-block;background:#F8991D;color:#111;font-weight:800;text-decoration:none;padding:14px 28px;border-radius:999px">${label}</a></p>
      <p style="color:#8b90a0;font-size:13px">Se você não pediu este acesso, ignore este e-mail.</p>
    </div>
  </div>`;
}

async function issueLink(request, env, email, purpose, redirectTo) {
  const user = await one(env, "SELECT id, email FROM users WHERE email = ?", [email]);
  if (!user && purpose === "recovery") return;
  const token = randomToken(32);
  await execute(
    env,
    `INSERT INTO auth_one_time_tokens (id, user_id, email, token_hash, purpose, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      user ? user.id : null,
      email,
      await sha256Hex(token),
      purpose,
      addMs(LINK_MS),
    ],
  );
  const origin = secret(env, "AUTH_PUBLIC_URL") || new URL(request.url).origin;
  const link = `${origin.replace(/\/$/, "")}/auth/v1/verify?token=${encodeURIComponent(token)}&type=${purpose === "recovery" ? "recovery" : "magiclink"}&redirect_to=${encodeURIComponent(redirectTo)}`;
  const title = purpose === "recovery" ? "Redefinir senha" : "Seu link de acesso";
  const text = purpose === "recovery"
    ? "Use o botão abaixo para escolher uma nova senha. O link expira em breve e só pode ser usado uma vez."
    : "Use o botão abaixo para entrar no ReadEdy. O link expira em breve e só pode ser usado uma vez.";
  await sendEmail(env, email, `ReadEdy — ${title}`, emailHtml(title, text, link, purpose === "recovery" ? "Redefinir senha" : "Entrar no ReadEdy"));
}

async function signUp(request, env) {
  const body = await readJson(request);
  const email = cleanEmail(body.email);
  const password = String(body.password || "");
  if (!email || !email.includes("@")) throw fail("Informe o e-mail", 400);
  if (password.length < 6) throw fail("A senha precisa ter no mínimo 6 caracteres", 400);
  const pepper = secret(env, "AUTH_SECRET");
  if (!pepper) throw fail("Auth não configurada", 503);
  const existing = await one(env, "SELECT id FROM users WHERE email = ?", [email]);
  if (existing) throw fail("Este e-mail já está cadastrado", 400);
  const id = crypto.randomUUID();
  const now = nowIso();
  const metadata = JSON.stringify({ email });
  const appMetadata = "{}";
  await transaction(env, [
    {
      sql: `INSERT INTO users (id, email, email_confirmed_at, encrypted_password, app_metadata, user_metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, email, now, await hashPassword(password, pepper), appMetadata, metadata, now, now],
    },
    {
      sql: `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, identity_data)
            VALUES (?, ?, 'email', ?, ?)`,
      args: [crypto.randomUUID(), id, email, metadata],
    },
    {
      sql: `INSERT INTO profiles (id, email, display_name) VALUES (?, ?, ?)`,
      args: [id, email, displayName(email)],
    },
  ]);
  let user = await one(env, "SELECT * FROM users WHERE id = ?", [id]);
  user = await promoteAdmin(env, user);
  const session = await createSession(env, user, request);
  return json({ session, user: session.user });
}

async function signIn(request, env) {
  const body = await readJson(request);
  const email = cleanEmail(body.email);
  const password = String(body.password || "");
  if (!email || !password) throw fail("Informe e-mail e senha", 400);
  const pepper = secret(env, "AUTH_SECRET");
  const user = await one(env, "SELECT * FROM users WHERE email = ?", [email]);
  if (!user || !(await verifyPassword(password, user.encrypted_password, pepper))) {
    throw fail("E-mail ou senha inválidos", 400);
  }
  const promoted = await promoteAdmin(env, user);
  const session = await createSession(env, promoted, request);
  return json({ session, user: session.user });
}

async function refresh(request, env) {
  const body = await readJson(request);
  const token = String(body.refresh_token || "");
  if (!token) throw fail("Sessão expirada", 401);
  const row = await one(
    env,
    `SELECT s.id, u.id AS user_id, u.email, u.app_metadata, u.user_metadata, u.created_at
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.refresh_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    [await sha256Hex(token), nowIso()],
  );
  if (!row) throw fail("Sessão expirada", 401);
  await execute(env, "UPDATE auth_sessions SET revoked_at = ? WHERE id = ?", [nowIso(), row.id]);
  const user = {
    id: row.user_id,
    email: row.email,
    app_metadata: row.app_metadata,
    user_metadata: row.user_metadata,
    created_at: row.created_at,
  };
  const session = await createSession(env, await promoteAdmin(env, user), request);
  return json({ session, user: session.user });
}

async function signOut(request, env) {
  const token = bearer(request);
  if (token && token !== "readedy-public") {
    await execute(
      env,
      "UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
      [nowIso(), await sha256Hex(token)],
    );
  }
  return json({ ok: true });
}

async function updatePassword(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const password = String(body.password || "");
  if (password.length < 6) throw fail("A senha precisa ter no mínimo 6 caracteres", 400);
  const pepper = secret(env, "AUTH_SECRET");
  if (!pepper) throw fail("Auth não configurada", 503);
  await execute(env, "UPDATE users SET encrypted_password = ? WHERE id = ?", [
    await hashPassword(password, pepper),
    user.id,
  ]);
  return json({ user: publicUser(user) });
}

async function currentUser(request, env) {
  const user = await requireUser(request, env);
  return json({ user: publicUser(user) });
}

async function magicLink(request, env) {
  const body = await readJson(request);
  const email = cleanEmail(body.email);
  if (!email || !email.includes("@")) throw fail("Informe o e-mail", 400);
  const redirectTo = allowedRedirect(env, body.redirect_to || body.emailRedirectTo);
  let existing = await one(env, "SELECT id FROM users WHERE email = ?", [email]);
  if (!existing) {
    const id = crypto.randomUUID();
    const now = nowIso();
    const metadata = JSON.stringify({ email });
    await transaction(env, [
      {
        sql: `INSERT INTO users (id, email, email_confirmed_at, app_metadata, user_metadata, created_at, updated_at)
              VALUES (?, ?, ?, '{}', ?, ?, ?)`,
        args: [id, email, now, metadata, now, now],
      },
      {
        sql: `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, identity_data)
              VALUES (?, ?, 'email', ?, ?)`,
        args: [crypto.randomUUID(), id, email, metadata],
      },
      {
        sql: "INSERT INTO profiles (id, email, display_name) VALUES (?, ?, ?)",
        args: [id, email, displayName(email)],
      },
    ]);
  }
  await issueLink(request, env, email, "magic_link", redirectTo);
  return json({ ok: true });
}

async function recovery(request, env) {
  const body = await readJson(request);
  const email = cleanEmail(body.email);
  if (!email || !email.includes("@")) throw fail("Informe o e-mail", 400);
  const redirectTo = allowedRedirect(env, body.redirect_to);
  await issueLink(request, env, email, "recovery", redirectTo);
  return json({ ok: true });
}

async function verifyLink(request, env, url) {
  const token = url.searchParams.get("token") || "";
  const type = url.searchParams.get("type") || "magiclink";
  const redirectTo = allowedRedirect(env, url.searchParams.get("redirect_to"));
  if (!token) throw fail("Link inválido", 400);
  const row = await one(
    env,
    `SELECT * FROM auth_one_time_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
    [await sha256Hex(token), nowIso()],
  );
  if (!row) throw fail("Link expirado ou já usado", 400);
  await execute(env, "UPDATE auth_one_time_tokens SET used_at = ? WHERE id = ?", [nowIso(), row.id]);
  let user = row.user_id
    ? await one(env, "SELECT * FROM users WHERE id = ?", [row.user_id])
    : await one(env, "SELECT * FROM users WHERE email = ?", [cleanEmail(row.email)]);
  if (!user) throw fail("Conta não encontrada", 400);
  user = await promoteAdmin(env, user);
  const session = await createSession(env, user, request);
  return redirectWithSession(redirectTo, session, type === "recovery" ? "recovery" : "magiclink");
}

async function googleStart(request, env, url) {
  const clientId = secret(env, "GOOGLE_OAUTH_CLIENT_ID");
  if (!clientId || !secret(env, "GOOGLE_OAUTH_CLIENT_SECRET")) {
    throw fail("Login com Google não configurado", 503);
  }
  const redirectTo = allowedRedirect(env, url.searchParams.get("redirect_to"));
  const state = await signState(env, { redirectTo, exp: Date.now() + 10 * 60 * 1000 });
  const callback = new URL(request.url);
  callback.pathname = "/auth/v1/callback";
  callback.search = "";
  callback.hash = "";
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.searchParams.set("client_id", clientId);
  google.searchParams.set("redirect_uri", callback.toString());
  google.searchParams.set("response_type", "code");
  google.searchParams.set("scope", "openid email profile");
  google.searchParams.set("state", state);
  google.searchParams.set("prompt", "select_account");
  return Response.redirect(google.toString(), 302);
}

async function signState(env, payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = await hmacHex(secret(env, "AUTH_SECRET"), body);
  return `${body}.${sig}`;
}

async function readState(env, state) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) throw fail("Login Google inválido", 400);
  const actual = await hmacHex(secret(env, "AUTH_SECRET"), body);
  if (!timingSafeEqual(actual, sig)) throw fail("Login Google inválido", 400);
  const payload = parseJson(unb64url(body), null);
  if (!payload || !payload.exp || payload.exp < Date.now()) throw fail("Login Google expirado", 400);
  return payload;
}

async function googleCallback(request, env, url) {
  const error = url.searchParams.get("error");
  if (error) throw fail("Login Google cancelado", 400);
  const payload = await readState(env, url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!code) throw fail("Login Google sem código", 400);
  const callback = new URL(request.url);
  callback.pathname = "/auth/v1/callback";
  callback.search = "";
  callback.hash = "";
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: secret(env, "GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: secret(env, "GOOGLE_OAUTH_CLIENT_SECRET"),
      redirect_uri: callback.toString(),
      grant_type: "authorization_code",
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) throw fail("Não foi possível concluir o login com Google", 502);
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok || !profile.sub || !profile.email) {
    throw fail("Google não retornou o e-mail da conta", 502);
  }
  const email = cleanEmail(profile.email);
  const identity = await one(
    env,
    "SELECT user_id FROM auth_identities WHERE provider = 'google' AND provider_user_id = ?",
    [String(profile.sub)],
  );
  let user = identity ? await one(env, "SELECT * FROM users WHERE id = ?", [identity.user_id]) : null;
  if (!user) user = await one(env, "SELECT * FROM users WHERE email = ?", [email]);
  const metadata = JSON.stringify({
    email,
    name: profile.name || "",
    full_name: profile.name || "",
    avatar_url: profile.picture || "",
  });
  if (!user) {
    const id = crypto.randomUUID();
    const now = nowIso();
    await transaction(env, [
      {
        sql: `INSERT INTO users (id, email, email_confirmed_at, app_metadata, user_metadata, created_at, updated_at)
              VALUES (?, ?, ?, '{}', ?, ?, ?)`,
        args: [id, email, now, metadata, now, now],
      },
      {
        sql: `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, identity_data)
              VALUES (?, ?, 'google', ?, ?)`,
        args: [crypto.randomUUID(), id, String(profile.sub), metadata],
      },
      {
        sql: "INSERT INTO profiles (id, email, display_name) VALUES (?, ?, ?)",
        args: [id, email, displayName(email, profile)],
      },
    ]);
    user = await one(env, "SELECT * FROM users WHERE id = ?", [id]);
  } else if (!identity) {
    await execute(
      env,
      `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, identity_data)
       VALUES (?, ?, 'google', ?, ?)`,
      [crypto.randomUUID(), user.id, String(profile.sub), metadata],
    );
    await execute(
      env,
      `INSERT INTO profiles (id, email, display_name) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = COALESCE(profiles.display_name, excluded.display_name)`,
      [user.id, email, displayName(email, profile)],
    );
  }
  user = await promoteAdmin(env, user);
  const session = await createSession(env, user, request);
  return redirectWithSession(payload.redirectTo, session, "");
}

export async function handleAuth(request, env, url) {
  const path = url.pathname;
  if (path === "/auth/v1/signup" && request.method === "POST") return signUp(request, env);
  if (path === "/auth/v1/token" && request.method === "POST") {
    const body = await request.clone().json().catch(() => ({}));
    if (body.grant_type === "refresh_token" || body.refresh_token) return refresh(request, env);
    return signIn(request, env);
  }
  if (path === "/auth/v1/logout" && request.method === "POST") return signOut(request, env);
  if (path === "/auth/v1/user" && request.method === "GET") return currentUser(request, env);
  if (path === "/auth/v1/user" && request.method === "PUT") return updatePassword(request, env);
  if (path === "/auth/v1/otp" && request.method === "POST") return magicLink(request, env);
  if (path === "/auth/v1/recover" && request.method === "POST") return recovery(request, env);
  if (path === "/auth/v1/verify" && request.method === "GET") return verifyLink(request, env, url);
  if (path === "/auth/v1/authorize" && request.method === "GET") return googleStart(request, env, url);
  if (path === "/auth/v1/callback" && request.method === "GET") return googleCallback(request, env, url);
  throw fail("Not found", 404);
}

export async function isSubscriptionActive(env, user) {
  const meta = parseJson(user.app_metadata, {});
  if (meta.role === "admin") return true;
  const row = await one(
    env,
    `SELECT 1 AS ok FROM subscriptions
     WHERE user_id = ?
       AND status IN ('active', 'past_due')
       AND COALESCE(current_period_end, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days')
     LIMIT 1`,
    [user.id],
  );
  return !!row;
}
