/**
 * ReadEra TTS Proxy — Supabase Edge Function (Deno)
 *
 * Recebe POST { text, voice, rate } e retorna MP3 gerado
 * pelo serviço Microsoft Edge TTS via WebSocket.
 * Não requer API key; usa o token público do Edge browser.
 *
 * Vozes pt-BR disponíveis: pt-BR-FranciscaNeural, pt-BR-AntonioNeural
 * Vozes pt-PT disponíveis: pt-PT-RaquelNeural, pt-PT-DuarteNeural
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  /* Preflight CORS */
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  let text = "", voice = "pt-BR-FranciscaNeural", rate = 1.0;

  try {
    if (req.method === "GET") {
      /* Suporte a GET para permitir uso direto em <audio src="...">       */
      /* sem necessidade de headers customizados (compat. Smart TV)        */
      const url = new URL(req.url);
      text  = (url.searchParams.get("text")  || "").trim();
      voice =  url.searchParams.get("voice") || "pt-BR-FranciscaNeural";
      rate  = Math.max(0.25, Math.min(3.0, Number(url.searchParams.get("rate") || "1.0")));
    } else if (req.method === "POST") {
      const body = await req.json();
      text  = String(body.text  ?? "").trim();
      voice = String(body.voice ?? "pt-BR-FranciscaNeural");
      rate  = Math.max(0.25, Math.min(3.0, Number(body.rate) || 1.0));
    } else {
      return new Response("Method Not Allowed", { status: 405, headers: CORS });
    }

    if (!text) {
      return new Response(JSON.stringify({ error: "text is required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    /* Limitar texto para evitar timeout (Edge TTS aceita ~3000 chars bem) */
    const MAX_CHARS = 4000;
    const sendText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

    const audioData = await synthesizeEdgeTTS(sendText, voice, rate);

    return new Response(audioData, {
      headers: {
        ...CORS,
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioData.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[tts-proxy]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

/* ── Helpers ──────────────────────────────────────────────── */

function rateToSSML(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* ── Síntese via WebSocket Microsoft Edge TTS ────────────── */

async function synthesizeEdgeTTS(
  text: string,
  voice: string,
  rate: number,
): Promise<Uint8Array> {
  /* Token público extraído do Edge browser — amplamente usado em projetos OSS */
  const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  const connId = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  const wsUrl =
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${TOKEN}&ConnectionId=${connId}`;

  const reqId = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  const lang = voice.substring(0, 5); /* ex: "pt-BR" */
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${voice}'>` +
    `<prosody rate='${rateToSSML(rate)}'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`;

  return new Promise<Uint8Array>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    const chunks: Uint8Array[] = [];
    let settled = false;

    const settle = (ok: boolean, reason?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (_) { /* ignore */ }

      if (ok) {
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        resolve(out);
      } else {
        reject(new Error(reason ?? "TTS synthesis failed"));
      }
    };

    /* Timeout de segurança: 25 s */
    const timer = setTimeout(
      () => settle(false, "TTS timeout (25 s)"),
      25_000,
    );

    ws.onopen = () => {
      const ts = new Date().toISOString();

      /* 1. Config de saída: MP3 24 kHz 48 kbps */
      ws.send(
        `Path: speech.config\r\n` +
          `X-RequestId: ${reqId}\r\n` +
          `X-Timestamp: ${ts}\r\n` +
          `Content-Type: application/json\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: {
                    sentenceBoundaryEnabled: "false",
                    wordBoundaryEnabled: "false",
                  },
                  outputFormat: "audio-24khz-48kbitrate-mono-mp3",
                },
              },
            },
          }),
      );

      /* 2. SSML com texto e voz */
      ws.send(
        `Path: ssml\r\n` +
          `X-RequestId: ${reqId}\r\n` +
          `X-Timestamp: ${ts}\r\n` +
          `Content-Type: application/ssml+xml\r\n\r\n` +
          ssml,
      );
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        /* Mensagem texto: verificar sinal de fim */
        if (ev.data.includes("Path:turn.end")) {
          settle(true);
        }
      } else {
        /* Mensagem binária: [2 bytes big-endian = tamanho do header][header][áudio MP3] */
        const buf = ev.data as ArrayBuffer;
        if (buf.byteLength < 2) return;
        const view = new DataView(buf);
        const headerLen = view.getUint16(0, false); /* big-endian */
        const audioStart = 2 + headerLen;
        if (buf.byteLength > audioStart) {
          /* Copiar para evitar reutilização do buffer pelo runtime */
          chunks.push(new Uint8Array(buf.slice(audioStart)));
        }
      }
    };

    ws.onerror = () => settle(false, "WebSocket error");

    ws.onclose = () => {
      /* Se fechou sem turn.end mas temos dados, resolver com o que há */
      if (!settled) {
        if (chunks.length > 0) settle(true);
        else settle(false, "WebSocket closed without audio");
      }
    };
  });
}
