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
    const mpToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!mpToken) return json({ error: "Mercado Pago não configurado" }, 503);

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const planSlug = String(body.plan_slug || "pro_monthly");

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: plan, error: planErr } = await admin
      .from("plans")
      .select("id, slug, name, price_brl, billing_interval")
      .eq("slug", planSlug)
      .eq("active", true)
      .single();
    if (planErr || !plan) return json({ error: "Plano inválido" }, 400);
    if (plan.slug === "trial") return json({ error: "Trial é automático no cadastro" }, 400);

    const user = userData.user;
    const backUrl = String(body.back_url || Deno.env.get("READEDY_APP_URL") || "https://readedy.vercel.app");
    const frequencyType = plan.billing_interval === "year" ? "months" : "months";
    const frequency = plan.billing_interval === "year" ? 12 : 1;

    const mpResp = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason: `ReadEdy — ${plan.name}`,
        external_reference: user.id,
        payer_email: user.email,
        auto_recurring: {
          frequency,
          frequency_type: frequencyType,
          transaction_amount: Number(plan.price_brl),
          currency_id: "BRL",
        },
        back_url: backUrl,
        status: "pending",
      }),
    });

    const mpData = await mpResp.json();
    if (!mpResp.ok) {
      console.error("[create-subscription]", mpData);
      return json({ error: mpData.message || "Erro Mercado Pago" }, 502);
    }

    const { data: existingSub } = await admin
      .from("subscriptions")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    const subPayload = {
      user_id: user.id,
      plan_id: plan.id,
      status: "pending",
      mp_preapproval_id: String(mpData.id),
      current_period_end: null,
      trial_ends_at: null,
      updated_at: new Date().toISOString(),
    };

    const { error: subErr } = existingSub
      ? await admin.from("subscriptions").update(subPayload).eq("id", existingSub.id)
      : await admin.from("subscriptions").insert(subPayload);

    if (subErr) {
      console.error("[create-subscription] subscriptions", subErr);
      return json({ error: "Erro ao gravar assinatura" }, 500);
    }

    return json({
      init_point: mpData.init_point,
      preapproval_id: mpData.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[create-subscription]", msg);
    return json({ error: msg }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
