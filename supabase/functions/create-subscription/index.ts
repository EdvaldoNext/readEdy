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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const mpToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!mpToken) return json({ error: "Mercado Pago não configurado" }, 503);

    const body = await req.json().catch(() => ({}));
    const planSlug = String(body.plan_slug || "basic_monthly");
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: plan, error: planErr } = await admin
      .from("plans")
      .select("id, slug, name, price_brl, billing_interval")
      .eq("slug", planSlug)
      .eq("active", true)
      .single();
    if (planErr || !plan) return json({ error: "Plano inválido" }, 400);
    if (plan.slug === "trial") return json({ error: "Plano trial indisponível" }, 400);

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    let userId: string | null = null;
    let payerEmail: string | null = body.payer_email
      ? String(body.payer_email).trim()
      : null;

    if (jwt && jwt !== anonKey) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (!userErr && userData.user) {
        userId = userData.user.id;
        payerEmail = payerEmail || userData.user.email || null;
      }
    }

    if (!payerEmail) {
      return json(
        { error: "Informe o e-mail da sua conta Mercado Pago para assinar." },
        400,
      );
    }

    // O Mercado Pago recusa assinaturas em que o pagador é a própria conta que
    // recebe (collector). Sem esta checagem o checkout abre e o botão
    // "Confirmar" fica desabilitado sem nenhuma mensagem para o usuário.
    const meResp = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${mpToken}` },
    });
    if (meResp.ok) {
      const me = await meResp.json();
      const collectorEmail = String(me.email || "").toLowerCase();
      if (collectorEmail && collectorEmail === payerEmail.toLowerCase()) {
        return json({
          error:
            "O Mercado Pago não permite assinar com a mesma conta que recebe os pagamentos (" +
            payerEmail +
            "). Use outro e-mail/conta Mercado Pago para pagar.",
        }, 409);
      }
    }

    const checkoutToken = crypto.randomUUID();
    const appBase = String(
      body.back_url || Deno.env.get("READEDY_APP_URL") || "https://readedy.vercel.app",
    ).replace(/\/?$/, "");
    const backUrl = `${appBase}/?checkout=${checkoutToken}&tab=conta`;

    const frequency = plan.billing_interval === "year" ? 12 : 1;

    const mpBody: Record<string, unknown> = {
      reason: `ReadEdy — ${plan.name}`,
      external_reference: checkoutToken,
      auto_recurring: {
        frequency,
        frequency_type: "months",
        transaction_amount: Number(plan.price_brl),
        currency_id: "BRL",
      },
      back_url: backUrl,
      status: "pending",
    };
    mpBody.payer_email = payerEmail;

    const mpResp = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mpBody),
    });

    const mpData = await mpResp.json();
    if (!mpResp.ok) {
      console.error("[create-subscription]", mpData);
      return json({ error: mpData.message || "Erro Mercado Pago" }, 502);
    }

    const { data: checkoutRow, error: checkoutErr } = await admin
      .from("checkout_sessions")
      .insert({
        token: checkoutToken,
        plan_id: plan.id,
        payer_email: payerEmail,
        mp_preapproval_id: String(mpData.id),
        status: "pending",
        user_id: userId,
      })
      .select("id")
      .single();

    if (checkoutErr || !checkoutRow) {
      console.error("[create-subscription] checkout_sessions", checkoutErr);
      return json({ error: "Erro ao criar sessão de checkout" }, 500);
    }

    const subPayload = {
      user_id: userId,
      plan_id: plan.id,
      status: "pending",
      mp_preapproval_id: String(mpData.id),
      checkout_session_id: checkoutRow.id,
      current_period_end: null,
      trial_ends_at: null,
      updated_at: new Date().toISOString(),
    };

    if (userId) {
      const { data: existingSub } = await admin
        .from("subscriptions")
        .select("id")
        .eq("user_id", userId)
        .in("status", ["pending", "active", "past_due"])
        .maybeSingle();

      const { error: subErr } = existingSub
        ? await admin.from("subscriptions").update(subPayload).eq("id", existingSub.id)
        : await admin.from("subscriptions").insert(subPayload);

      if (subErr) {
        console.error("[create-subscription] subscriptions", subErr);
        return json({ error: "Erro ao gravar assinatura" }, 500);
      }
    } else {
      const { data: newSub, error: subErr } = await admin
        .from("subscriptions")
        .insert(subPayload)
        .select("id")
        .single();
      if (subErr || !newSub) {
        console.error("[create-subscription] subscriptions", subErr);
        return json({ error: "Erro ao gravar assinatura" }, 500);
      }
      await admin
        .from("checkout_sessions")
        .update({ subscription_id: newSub.id })
        .eq("id", checkoutRow.id);
    }

    return json({
      init_point: mpData.init_point,
      checkout_token: checkoutToken,
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
