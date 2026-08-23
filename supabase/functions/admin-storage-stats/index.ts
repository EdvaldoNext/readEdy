import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_FREE_BYTES = 1073741824;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    if (userData.user.app_metadata?.role !== "admin") {
      return json({ error: "Forbidden" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: docs, error: docsErr } = await admin
      .from("documents")
      .select("user_id, bytes");

    if (docsErr) throw docsErr;

    const perUserMap = new Map<string, { user_id: string; bytes_used: number; pdf_count: number }>();
    let totalBytes = 0;

    for (const doc of docs || []) {
      const bytes = Number(doc.bytes) || 0;
      totalBytes += bytes;
      const uid = doc.user_id as string;
      if (!uid) continue;
      const existing = perUserMap.get(uid) || { user_id: uid, bytes_used: 0, pdf_count: 0 };
      existing.bytes_used += bytes;
      existing.pdf_count += 1;
      perUserMap.set(uid, existing);
    }

    const perUser = Array.from(perUserMap.values()).sort(
      (a, b) => b.bytes_used - a.bytes_used,
    );

    return json({
      used_bytes: totalBytes,
      limit_bytes: SUPABASE_FREE_BYTES,
      remaining_bytes: Math.max(0, SUPABASE_FREE_BYTES - totalBytes),
      total_documents: (docs || []).length,
      per_user: perUser,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin-storage-stats]", msg);
    return json({ error: msg }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
