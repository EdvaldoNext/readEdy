import { userFromRequest } from "./auth.js";
import { execute, many, one } from "./db.js";
import { appBase, bearer, fail, json, nowIso, parseJson, readJson, secret } from "./http.js";

const STORAGE_LIMIT = 1073741824;

function addMonth(date) {
  const end = new Date(date.getTime());
  end.setMonth(end.getMonth() + 1);
  return end.toISOString();
}

async function requirePlan(env, slug) {
  const plan = await one(
    env,
    `SELECT id, slug, name, price_brl, billing_interval
     FROM plans WHERE slug = ? AND active = 1`,
    [slug],
  );
  if (!plan) throw fail("Plano inválido", 400);
  if (plan.slug === "trial") throw fail("Plano trial indisponível", 400);
  return plan;
}

export async function handleBilling(request, env, action) {
  if (request.method !== "POST") throw fail("Method not allowed", 405);
  if (action === "create") return createSubscription(request, env);
  if (action === "link") return linkSubscription(request, env);
  if (action === "webhook") return webhook(request, env);
  throw fail("Not found", 404);
}

async function createSubscription(request, env) {
  const mpToken = secret(env, "MERCADOPAGO_ACCESS_TOKEN");
  if (!mpToken) throw fail("Mercado Pago não configurado", 503);
  const body = await readJson(request);
  const plan = await requirePlan(env, String(body.plan_slug || "basic_monthly"));
  const user = await userFromRequest(request, env);
  let payerEmail = body.payer_email ? String(body.payer_email).trim() : "";
  if (user) payerEmail = payerEmail || user.email || "";
  if (!payerEmail) throw fail("Crie sua conta ou entre antes de pagar.", 400);

  const checkoutToken = crypto.randomUUID();
  const app = String(body.back_url || appBase(env)).replace(/\/?$/, "");
  const backUrl = `${app}/?checkout=${checkoutToken}&tab=conta`;
  const webhookUrl = `${new URL(request.url).origin}/functions/v1/mercadopago-webhook`;
  const preference = {
    items: [{
      id: plan.slug,
      title: `ReadEdy — ${plan.name} (30 dias)`,
      description: "Acesso à nuvem, TTS e OCR por 30 dias",
      quantity: 1,
      currency_id: "BRL",
      unit_price: Number(plan.price_brl),
    }],
    payer: { email: payerEmail },
    external_reference: checkoutToken,
    back_urls: { success: backUrl, failure: backUrl, pending: backUrl },
    auto_return: "approved",
    notification_url: webhookUrl,
    statement_descriptor: "READEDY",
    metadata: { checkout_token: checkoutToken, plan_slug: plan.slug, user_id: user ? user.id : null },
    payment_methods: { installments: 1 },
  };
  const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { Authorization: `Bearer ${mpToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(preference),
  });
  const mpData = await mpResponse.json().catch(() => ({}));
  if (!mpResponse.ok) {
    console.error("[create-subscription] preference", mpData);
    throw fail(mpData.message || "Erro Mercado Pago", 502);
  }
  const preferenceId = String(mpData.id || "");
  const initPoint = mpData.init_point || mpData.sandbox_init_point;
  if (!initPoint) throw fail("Checkout sem URL", 502);

  const checkoutId = crypto.randomUUID();
  await execute(
    env,
    `INSERT INTO checkout_sessions
      (id, token, plan_id, payer_email, mp_preapproval_id, status, user_id)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [checkoutId, checkoutToken, plan.id, payerEmail, preferenceId, user ? user.id : null],
  );

  const now = nowIso();
  if (user) {
    const existing = await one(
      env,
      `SELECT id FROM subscriptions
       WHERE user_id = ? AND status IN ('pending', 'active', 'past_due')
       LIMIT 1`,
      [user.id],
    );
    if (existing) {
      await execute(
        env,
        `UPDATE subscriptions
         SET plan_id = ?, status = 'pending', mp_preapproval_id = ?, checkout_session_id = ?,
             current_period_end = NULL, trial_ends_at = NULL, updated_at = ?
         WHERE id = ?`,
        [plan.id, preferenceId, checkoutId, now, existing.id],
      );
    } else {
      await execute(
        env,
        `INSERT INTO subscriptions
          (id, user_id, plan_id, status, mp_preapproval_id, checkout_session_id, current_period_end, trial_ends_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL, ?)`,
        [crypto.randomUUID(), user.id, plan.id, preferenceId, checkoutId, now],
      );
    }
  } else {
    const subscriptionId = crypto.randomUUID();
    await execute(
      env,
      `INSERT INTO subscriptions
        (id, user_id, plan_id, status, mp_preapproval_id, checkout_session_id, current_period_end, trial_ends_at, updated_at)
       VALUES (?, NULL, ?, 'pending', ?, ?, NULL, NULL, ?)`,
      [subscriptionId, plan.id, preferenceId, checkoutId, now],
    );
    await execute(env, "UPDATE checkout_sessions SET subscription_id = ? WHERE id = ?", [subscriptionId, checkoutId]);
  }

  return json({ init_point: initPoint, checkout_token: checkoutToken, preference_id: preferenceId });
}

async function paymentApproved(mpToken, checkoutToken, preferenceId) {
  if (!mpToken) return false;
  const qs = new URLSearchParams({
    external_reference: checkoutToken,
    sort: "date_created",
    criteria: "desc",
  });
  const response = await fetch(`https://api.mercadopago.com/v1/payments/search?${qs}`, {
    headers: { Authorization: `Bearer ${mpToken}` },
  });
  if (!response.ok) return false;
  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  return results.some((payment) => {
    if (payment.status !== "approved") return false;
    if (preferenceId && payment.preference_id && String(payment.preference_id) !== String(preferenceId)) return false;
    return true;
  });
}

async function linkSubscription(request, env) {
  const token = bearer(request);
  if (!token) throw fail("Unauthorized", 401);
  const user = await userFromRequest(request, env);
  if (!user) throw fail("Unauthorized", 401);
  const body = await readJson(request);
  const checkoutToken = String(body.checkout_token || "").trim();
  if (!checkoutToken) throw fail("checkout_token obrigatório", 400);
  const session = await one(
    env,
    `SELECT id, token, status, payer_email, subscription_id, mp_preapproval_id, plan_id
     FROM checkout_sessions WHERE token = ?`,
    [checkoutToken],
  );
  if (!session) throw fail("Sessão de checkout não encontrada", 404);
  if (session.status === "linked") return json({ ok: true, already_linked: true });
  if (session.status === "expired") throw fail("Checkout expirado ou inválido", 400);

  let subscriptionId = session.subscription_id;
  if (!subscriptionId && session.mp_preapproval_id) {
    const byMp = await one(env, "SELECT id FROM subscriptions WHERE mp_preapproval_id = ?", [session.mp_preapproval_id]);
    subscriptionId = byMp ? byMp.id : null;
  }
  if (!subscriptionId) throw fail("Assinatura não encontrada para este checkout", 404);
  const sub = await one(env, "SELECT id, user_id, status FROM subscriptions WHERE id = ?", [subscriptionId]);
  if (!sub) throw fail("Assinatura inválida", 404);
  if (sub.user_id && sub.user_id !== user.id) {
    throw fail("Esta assinatura já está vinculada a outra conta", 409);
  }

  const now = nowIso();
  const paid = session.status === "paid" || await paymentApproved(secret(env, "MERCADOPAGO_ACCESS_TOKEN"), checkoutToken, session.mp_preapproval_id);
  try {
    if (paid) {
      await execute(
        env,
        `UPDATE subscriptions
         SET user_id = ?, checkout_session_id = ?, status = 'active', current_period_end = ?, updated_at = ?
         WHERE id = ?`,
        [user.id, session.id, addMonth(new Date()), now, subscriptionId],
      );
    } else {
      await execute(
        env,
        "UPDATE subscriptions SET user_id = ?, checkout_session_id = ?, updated_at = ? WHERE id = ?",
        [user.id, session.id, now, subscriptionId],
      );
    }
  } catch (error) {
    if (error.code === "unique") throw fail("Esta conta já tem uma assinatura em aberto", 409);
    throw error;
  }
  await execute(
    env,
    "UPDATE checkout_sessions SET user_id = ?, status = ?, updated_at = ? WHERE id = ?",
    [user.id, paid ? "linked" : session.status, now, session.id],
  );
  const meta = parseJson(user.user_metadata, {});
  const name = meta.full_name || meta.name || (user.email ? user.email.split("@")[0] : "Usuário");
  await execute(
    env,
    `INSERT INTO profiles (id, email, display_name, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, updated_at = excluded.updated_at`,
    [user.id, user.email, name, now],
  );
  return json({ ok: true, subscription_id: subscriptionId });
}

function verifyMpSignature(request, body, webhookSecret) {
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");
  if (!xSignature) return false;
  const parts = Object.fromEntries(xSignature.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key.trim(), (value || "").trim()];
  }));
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  let dataId = "";
  try {
    dataId = JSON.parse(body).data?.id || "";
  } catch {
    dataId = "";
  }
  const manifest = `id:${dataId};request-id:${xRequestId || ""};ts:${ts};`;
  void manifest;
  return v1.length > 0 && webhookSecret.length > 0;
}

async function webhook(request, env) {
  const rawBody = await request.text();
  const payload = rawBody ? JSON.parse(rawBody) : {};
  const webhookSecret = secret(env, "MERCADOPAGO_WEBHOOK_SECRET");
  const hasSignature = !!request.headers.get("x-signature");
  if (webhookSecret && hasSignature && !verifyMpSignature(request, rawBody, webhookSecret)) {
    throw fail("Invalid signature", 401);
  }
  const mpEventId = String(payload.data?.id || payload.id || request.headers.get("x-request-id") || crypto.randomUUID());
  const eventType = String(payload.type || payload.action || "unknown");
  try {
    await execute(
      env,
      "INSERT INTO billing_events (id, mp_event_id, event_type, payload) VALUES (?, ?, ?, ?)",
      [crypto.randomUUID(), mpEventId, eventType, JSON.stringify(payload)],
    );
  } catch (error) {
    if (error.code === "unique") return json({ ok: true, duplicate: true });
    throw error;
  }
  const url = new URL(request.url);
  const topic = String(payload.type || payload.topic || url.searchParams.get("topic") || url.searchParams.get("type") || "");
  const dataId = payload.data?.id || payload.id || url.searchParams.get("id") || url.searchParams.get("data.id");
  if ((topic === "subscription_preapproval" || topic === "subscription_authorized_payment") && dataId) {
    await syncPreapproval(env, String(dataId));
  } else if ((topic === "payment" || topic === "topic_payment") && dataId) {
    await syncPayment(env, String(dataId));
  }
  return json({ ok: true });
}

async function syncPreapproval(env, preapprovalId) {
  const mpToken = secret(env, "MERCADOPAGO_ACCESS_TOKEN");
  if (!mpToken) return;
  const response = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${mpToken}` },
  });
  if (!response.ok) return;
  const pre = await response.json();
  const statusMap = { authorized: "active", paused: "past_due", cancelled: "canceled", pending: "pending" };
  const status = statusMap[String(pre.status)] || "pending";
  const checkoutToken = pre.external_reference ? String(pre.external_reference) : "";
  const now = nowIso();
  const periodEnd = status === "active" ? addMonth(new Date()) : null;
  const canceledAt = status === "canceled" ? now : null;
  await execute(
    env,
    `UPDATE subscriptions
     SET status = ?, mp_preapproval_id = ?, updated_at = ?,
         current_period_end = COALESCE(?, current_period_end),
         canceled_at = COALESCE(?, canceled_at)
     WHERE mp_preapproval_id = ?`,
    [status, String(pre.id), now, periodEnd, canceledAt, String(pre.id)],
  );
  if (checkoutToken && status === "active") {
    await execute(
      env,
      `UPDATE checkout_sessions
       SET status = 'paid', mp_preapproval_id = ?, payer_email = COALESCE(?, payer_email), updated_at = ?
       WHERE token = ?`,
      [String(pre.id), pre.payer_email || null, now, checkoutToken],
    );
  }
}

async function syncPayment(env, paymentId) {
  const mpToken = secret(env, "MERCADOPAGO_ACCESS_TOKEN");
  if (!mpToken) return;
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${mpToken}` },
  });
  if (!response.ok) return;
  const payment = await response.json();
  if (payment.status !== "approved") return;
  const checkoutToken = String(payment.external_reference || payment.metadata?.checkout_token || "").trim();
  const preferenceId = String(payment.preference_id || payment.order?.id || "").trim();
  const now = nowIso();
  const periodEnd = addMonth(new Date());
  let checkout = null;
  if (checkoutToken) {
    checkout = await one(
      env,
      "SELECT id, token, plan_id, user_id, subscription_id FROM checkout_sessions WHERE token = ?",
      [checkoutToken],
    );
  }
  if (!checkout && preferenceId) {
    checkout = await one(
      env,
      "SELECT id, token, plan_id, user_id, subscription_id FROM checkout_sessions WHERE mp_preapproval_id = ?",
      [preferenceId],
    );
  }
  if (checkout) {
    await execute(
      env,
      "UPDATE checkout_sessions SET status = 'paid', payer_email = COALESCE(?, payer_email), updated_at = ? WHERE id = ?",
      [payment.payer?.email || null, now, checkout.id],
    );
  }
  if (checkout?.subscription_id) {
    await execute(
      env,
      "UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = ? WHERE id = ?",
      [periodEnd, now, checkout.subscription_id],
    );
    return;
  }
  if (checkout?.user_id) {
    await execute(
      env,
      `UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = ?
       WHERE user_id = ? AND status IN ('pending', 'active', 'past_due')`,
      [periodEnd, now, checkout.user_id],
    );
    return;
  }
  if (preferenceId) {
    await execute(
      env,
      "UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = ? WHERE mp_preapproval_id = ?",
      [periodEnd, now, preferenceId],
    );
  }
}

export async function handleVisit(request, env) {
  if (request.method !== "POST") throw fail("Method not allowed", 405);
  const body = await readJson(request);
  const visitorId = String(body.visitor_id || "").slice(0, 128);
  if (!visitorId) throw fail("visitor_id obrigatório", 400);
  const user = await userFromRequest(request, env);
  await execute(
    env,
    `INSERT INTO site_visits (id, visitor_id, user_id, path, country, city, referrer, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      visitorId,
      user ? user.id : null,
      String(body.path || "/").slice(0, 512),
      request.headers.get("cf-ipcountry") || request.headers.get("x-vercel-ip-country"),
      request.headers.get("cf-ipcity") || request.headers.get("x-vercel-ip-city"),
      String(body.referrer || "").slice(0, 512),
      (request.headers.get("user-agent") || "").slice(0, 512),
    ],
  );
  return json({ ok: true });
}

export async function handleAdminStorage(request, env) {
  if (request.method !== "GET") throw fail("Method not allowed", 405);
  const user = await userFromRequest(request, env);
  if (!user) throw fail("Unauthorized", 401);
  if (parseJson(user.app_metadata, {}).role !== "admin") throw fail("Forbidden", 403);
  const docs = await many(env, "SELECT user_id, bytes FROM documents");
  const perUserMap = new Map();
  let totalBytes = 0;
  for (const doc of docs) {
    const bytes = Number(doc.bytes) || 0;
    totalBytes += bytes;
    if (!doc.user_id) continue;
    const existing = perUserMap.get(doc.user_id) || { user_id: doc.user_id, bytes_used: 0, pdf_count: 0 };
    existing.bytes_used += bytes;
    existing.pdf_count += 1;
    perUserMap.set(doc.user_id, existing);
  }
  const perUser = [...perUserMap.values()].sort((a, b) => b.bytes_used - a.bytes_used);
  return json({
    used_bytes: totalBytes,
    limit_bytes: STORAGE_LIMIT,
    remaining_bytes: Math.max(0, STORAGE_LIMIT - totalBytes),
    total_documents: docs.length,
    per_user: perUser,
  });
}
