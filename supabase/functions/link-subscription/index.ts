import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    const user = userData.user;
    const body = await req.json().catch(() => ({}));
    const checkoutToken = String(body.checkout_token || "").trim();
    if (!checkoutToken) return json({ error: "checkout_token obrigatório" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: session, error: sessErr } = await admin
      .from("checkout_sessions")
      .select("id, token, status, payer_email, subscription_id, mp_preapproval_id, plan_id")
      .eq("token", checkoutToken)
      .maybeSingle();

    if (sessErr || !session) {
      return json({ error: "Sessão de checkout não encontrada" }, 404);
    }
    if (session.status === "linked") {
      return json({ ok: true, already_linked: true });
    }
    if (session.status === "expired") {
      return json({ error: "Checkout expirado ou inválido" }, 400);
    }

    let subscriptionId = session.subscription_id;

    if (!subscriptionId) {
      const { data: subByMp } = await admin
        .from("subscriptions")
        .select("id, status")
        .eq("mp_preapproval_id", session.mp_preapproval_id || "")
        .maybeSingle();
      subscriptionId = subByMp?.id || null;
    }

    if (!subscriptionId) {
      return json({ error: "Assinatura não encontrada para este checkout" }, 404);
    }

    const { data: sub, error: subErr } = await admin
      .from("subscriptions")
      .select("id, user_id, status")
      .eq("id", subscriptionId)
      .single();

    if (subErr || !sub) return json({ error: "Assinatura inválida" }, 404);

    if (sub.user_id && sub.user_id !== user.id) {
      return json({ error: "Esta assinatura já está vinculada a outra conta" }, 409);
    }

    const now = new Date().toISOString();
    await admin.from("subscriptions").update({
      user_id: user.id,
      checkout_session_id: session.id,
      updated_at: now,
    }).eq("id", subscriptionId);

    await admin.from("checkout_sessions").update({
      user_id: user.id,
      status: "linked",
      updated_at: now,
    }).eq("id", session.id);

    await admin.from("profiles").upsert({
      id: user.id,
      email: user.email,
      display_name: user.user_metadata?.full_name || user.user_metadata?.name ||
        (user.email ? user.email.split("@")[0] : "Usuário"),
      updated_at: now,
    }, { onConflict: "id" });

    return json({ ok: true, subscription_id: subscriptionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[link-subscription]", msg);
    return json({ error: msg }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
