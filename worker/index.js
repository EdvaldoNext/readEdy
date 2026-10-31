import { handleAuth } from "./auth.js";
import { handleAdminStorage, handleBilling, handleVisit } from "./billing.js";
import { CORS, json } from "./http.js";
import { handleQuery } from "./query.js";
import { handleStorage } from "./storage.js";
import { handleTts } from "./tts.js";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);
    try {
      const path = url.pathname;
      if (path === "/health") return json({ ok: true, service: "readedy-api" });
      if (path.startsWith("/auth/")) return await handleAuth(request, env, url);
      if (path === "/v1/query") return await handleQuery(request, env);
      if (path.startsWith("/storage/")) return await handleStorage(request, env, url);
      if (path === "/functions/v1/create-subscription") return await handleBilling(request, env, "create");
      if (path === "/functions/v1/link-subscription") return await handleBilling(request, env, "link");
      if (path === "/functions/v1/mercadopago-webhook") return await handleBilling(request, env, "webhook");
      if (path === "/functions/v1/track-visit") return await handleVisit(request, env);
      if (path === "/functions/v1/admin-storage-stats") return await handleAdminStorage(request, env);
      if (path === "/functions/v1/tts-proxy") return await handleTts(request, env, url);
      return json({ error: "Not found" }, 404);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error("[readedy-api]", error);
      return json({ error: error.message || "Erro interno" }, status);
    }
  },
};
