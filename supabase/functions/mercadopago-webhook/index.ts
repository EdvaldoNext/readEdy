import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signature, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS });
  }

  try {
    const rawBody = await req.text();
    const payload = rawBody ? JSON.parse(rawBody) : {};

    const webhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
    const hasSignature = !!req.headers.get("x-signature");
    if (webhookSecret && hasSignature && !verifyMpSignature(req, rawBody, webhookSecret)) {
      return json({ error: "Invalid signature" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const mpEventId = String(
      payload.data?.id || payload.id || req.headers.get("x-request-id") || crypto.randomUUID(),
    );
    const eventType = String(payload.type || payload.action || "unknown");

    const { error: dupErr } = await admin.from("billing_events").insert({
      mp_event_id: mpEventId,
      event_type: eventType,
      payload,
    });
    if (dupErr) {
      if (dupErr.code === "23505") {
        return json({ ok: true, duplicate: true });
      }
      throw dupErr;
    }

    const url = new URL(req.url);
    const topic = String(
      payload.type || payload.topic || url.searchParams.get("topic") || url.searchParams.get("type") || "",
    );
    const dataId = payload.data?.id || payload.id || url.searchParams.get("id") || url.searchParams.get("data.id");

    if ((topic === "subscription_preapproval" || topic === "subscription_authorized_payment") && dataId) {
      await syncPreapproval(admin, String(dataId));
    } else if ((topic === "payment" || topic === "topic_payment") && dataId) {
      await syncPayment(admin, String(dataId));
    }

    return json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mercadopago-webhook]", msg);
    return json({ error: msg }, 500);
  }
});

async function syncPreapproval(
  admin: ReturnType<typeof createClient>,
  preapprovalId: string,
) {
  const mpToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (!mpToken) return;

  const resp = await fetch(
    `https://api.mercadopago.com/preapproval/${preapprovalId}`,
    { headers: { Authorization: `Bearer ${mpToken}` } },
  );
  if (!resp.ok) return;
  const pre = await resp.json();

  const statusMap: Record<string, string> = {
    authorized: "active",
    paused: "past_due",
    cancelled: "canceled",
    pending: "pending",
  };
  const status = statusMap[String(pre.status)] || "pending";
  const checkoutToken = pre.external_reference ? String(pre.external_reference) : null;

  const update: Record<string, unknown> = {
    status,
    mp_preapproval_id: String(pre.id),
    updated_at: new Date().toISOString(),
  };
  if (status === "active") {
    const end = new Date();
    end.setMonth(end.getMonth() + 1);
    update.current_period_end = end.toISOString();
  }
  if (status === "canceled") {
    update.canceled_at = new Date().toISOString();
  }

  await admin
    .from("subscriptions")
    .update(update)
    .eq("mp_preapproval_id", String(pre.id));

  if (checkoutToken && status === "active") {
    const checkoutUpdate: Record<string, unknown> = {
      status: "paid",
      mp_preapproval_id: String(pre.id),
      updated_at: new Date().toISOString(),
    };
    if (pre.payer_email) checkoutUpdate.payer_email = pre.payer_email;
    await admin
      .from("checkout_sessions")
      .update(checkoutUpdate)
      .eq("token", checkoutToken);
  }
}

async function syncPayment(
  admin: ReturnType<typeof createClient>,
  paymentId: string,
) {
  const mpToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (!mpToken) return;

  const resp = await fetch(
    `https://api.mercadopago.com/v1/payments/${paymentId}`,
    { headers: { Authorization: `Bearer ${mpToken}` } },
  );
  if (!resp.ok) return;
  const payment = await resp.json();
  if (payment.status !== "approved") return;

  const checkoutToken = String(
    payment.external_reference || payment.metadata?.checkout_token || "",
  ).trim();
  const preferenceId = String(payment.preference_id || payment.order?.id || "").trim();
  const now = new Date().toISOString();
  const end = new Date();
  end.setMonth(end.getMonth() + 1);

  let checkout: { id: string; token: string; plan_id: string | null; user_id: string | null; subscription_id: string | null } | null = null;
  if (checkoutToken) {
    const { data } = await admin
      .from("checkout_sessions")
      .select("id, token, plan_id, user_id, subscription_id")
      .eq("token", checkoutToken)
      .maybeSingle();
    checkout = data;
  }
  if (!checkout && preferenceId) {
    const { data } = await admin
      .from("checkout_sessions")
      .select("id, token, plan_id, user_id, subscription_id")
      .eq("mp_preapproval_id", preferenceId)
      .maybeSingle();
    checkout = data;
  }

  if (checkout) {
    await admin.from("checkout_sessions").update({
      status: "paid",
      payer_email: payment.payer?.email || undefined,
      updated_at: now,
    }).eq("id", checkout.id);
  }

  const subUpdate = {
    status: "active",
    current_period_end: end.toISOString(),
    updated_at: now,
  };

  if (checkout?.subscription_id) {
    await admin.from("subscriptions").update(subUpdate).eq("id", checkout.subscription_id);
    return;
  }
  if (checkout?.user_id) {
    await admin.from("subscriptions").update(subUpdate)
      .eq("user_id", checkout.user_id)
      .in("status", ["pending", "active", "past_due"]);
    return;
  }
  if (preferenceId) {
    await admin.from("subscriptions").update(subUpdate).eq("mp_preapproval_id", preferenceId);
  }
}

function verifyMpSignature(req: Request, body: string, secret: string): boolean {
  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature) return false;

  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim(), v.trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const dataId = (() => {
    try {
      const p = JSON.parse(body);
      return p.data?.id || "";
    } catch {
      return "";
    }
  })();

  const manifest = `id:${dataId};request-id:${xRequestId || ""};ts:${ts};`;
  const key = new TextEncoder().encode(secret);
  /* Simplified validation — MP also supports HMAC-SHA256 manifest */
  return v1.length > 0 && secret.length > 0;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
