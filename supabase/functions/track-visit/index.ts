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
    const body = await req.json().catch(() => ({}));
    const visitorId = String(body.visitor_id || "").slice(0, 128);
    if (!visitorId) return json({ error: "visitor_id obrigatório" }, 400);

    const path = String(body.path || "/").slice(0, 512);
    const referrer = String(body.referrer || "").slice(0, 512);
    const userAgent = (req.headers.get("user-agent") || "").slice(0, 512);
    const country = req.headers.get("x-vercel-ip-country") ||
      req.headers.get("cf-ipcountry") || null;
    const city = req.headers.get("x-vercel-ip-city") ||
      req.headers.get("cf-ipcity") || null;

    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    if (jwt && jwt !== anonKey) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (userData?.user) userId = userData.user.id;
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    await admin.from("site_visits").insert({
      visitor_id: visitorId,
      user_id: userId,
      path,
      country,
      city,
      referrer,
      user_agent: userAgent,
    });

    return json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[track-visit]", msg);
    return json({ error: msg }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
