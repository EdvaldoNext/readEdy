/**
 * ReadEra TTS Proxy — Supabase Edge Function (Deno)
 *
 * Tenta Microsoft Edge TTS (WebSocket + Sec-MS-GEC DRM).
 * Em caso de falha usa Google Translate TTS como fallback (sem API key).
 *
 * Aceita GET ?text=&voice=&rate= e POST { text, voice, rate }.
 * Retorna audio/mpeg com status 200.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  let text = "", voice = "pt-BR-FranciscaNeural", rate = 1.0;

  try {
    if (req.method === "GET") {
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

    const MAX_CHARS = 4000;
    const sendText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

    /* 1ª tentativa: Microsoft Edge TTS (WebSocket + DRM) */
    let audioData: Uint8Array | null = null;
    try {
      audioData = await synthesizeEdgeTTS(sendText, voice, rate);
    } catch (edgeErr) {
      console.warn("[tts-proxy] Edge TTS falhou, usando Google TTS:", edgeErr);
    }

    /* Fallback: Google Translate TTS (sem API key, HTTP simples) */
    if (!audioData || audioData.length === 0) {
      const lang = voice.substring(0, 5).toLowerCase().replace("_", "-");
      audioData = await synthesizeGoogleTTS(sendText, lang, rate);
    }

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

/* ════════════════════════════════════════════════════════════
   MOTOR 1: Microsoft Edge TTS (WebSocket, DRM Sec-MS-GEC)
   ════════════════════════════════════════════════════════════ */

const TRUSTED_CLIENT_TOKEN  = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR        = "143";
const WIN_EPOCH_SEC         = 11644473600n;
const TICKS_PER_SEC         = 10_000_000n;

/** SHA-256 do timestamp arredondado para janela de 5 min + token */
async function generateSecMsGec(): Promise<string> {
  const unixSec  = BigInt(Math.floor(Date.now() / 1000));
  const winTicks = (unixSec + WIN_EPOCH_SEC) * TICKS_PER_SEC;
  const windowed = winTicks - (winTicks % (300n * TICKS_PER_SEC));
  const input    = `${windowed}${TRUSTED_CLIENT_TOKEN}`;
  const buf      = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function generateMuid(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

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

async function synthesizeEdgeTTS(text: string, voice: string, rate: number): Promise<Uint8Array> {
  const secMsGec = await generateSecMsGec();
  const muid     = generateMuid();
  const connId   = crypto.randomUUID().replace(/-/g, "").toUpperCase();

  const wsUrl =
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec}` +
    `&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}` +
    `&ConnectionId=${connId}` +
    `&MUID=${muid}`;

  const reqId = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  const lang  = voice.substring(0, 5);
  const ssml  =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${voice}'>` +
    `<prosody rate='${rateToSSML(rate)}'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`;

  return new Promise<Uint8Array>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      reject(e);
      return;
    }
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
        const out   = new Uint8Array(total);
        let off     = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        resolve(out);
      } else {
        reject(new Error(reason ?? "Edge TTS failed"));
      }
    };

    const timer = setTimeout(() => settle(false, "Edge TTS timeout (20 s)"), 20_000);

    ws.onopen = () => {
      const ts = new Date().toISOString();
      ws.send(
        `Path: speech.config\r\nX-RequestId: ${reqId}\r\nX-Timestamp: ${ts}\r\nContent-Type: application/json\r\n\r\n` +
        JSON.stringify({ context: { synthesis: { audio: {
          metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
          outputFormat: "audio-24khz-48kbitrate-mono-mp3",
        } } } }),
      );
      ws.send(
        `Path: ssml\r\nX-RequestId: ${reqId}\r\nX-Timestamp: ${ts}\r\nContent-Type: application/ssml+xml\r\n\r\n` + ssml,
      );
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        if (ev.data.includes("Path:turn.end")) settle(true);
      } else {
        const buf        = ev.data as ArrayBuffer;
        if (buf.byteLength < 2) return;
        const headerLen  = new DataView(buf).getUint16(0, false);
        const audioStart = 2 + headerLen;
        if (buf.byteLength > audioStart) {
          chunks.push(new Uint8Array(buf.slice(audioStart)));
        }
      }
    };

    ws.onerror = () => settle(false, "Edge TTS WebSocket error");
    ws.onclose = () => {
      if (!settled) {
        if (chunks.length > 0) settle(true);
        else settle(false, "Edge TTS WebSocket closed without audio");
      }
    };
  });
}

/* ════════════════════════════════════════════════════════════
   MOTOR 2: Google Translate TTS (fallback, sem API key)
   ════════════════════════════════════════════════════════════ */

/** Mapeia voz Edge para código de idioma do Google Translate */
function voiceToGoogleLang(voice: string): string {
  const v = voice.toLowerCase();
  if (v.startsWith("pt-br")) return "pt-br";
  if (v.startsWith("pt-pt") || v.startsWith("pt")) return "pt";
  if (v.startsWith("en-us") || v.startsWith("en")) return "en";
  if (v.startsWith("es")) return "es";
  if (v.startsWith("fr")) return "fr";
  if (v.startsWith("de")) return "de";
  if (v.startsWith("it")) return "it";
  return voice.substring(0, 5).toLowerCase();
}

/** Divide texto em frases de no máximo maxLen caracteres */
function splitTextIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    const slice   = remaining.substring(0, maxLen);
    /* Procurar última quebra de frase dentro do limite */
    let cutAt = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
      slice.lastIndexOf(".\n"),
    );
    if (cutAt <= 0) cutAt = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf(" "));
    if (cutAt <= 0) cutAt = maxLen;
    else cutAt += 1; /* incluir o ponto/vírgula */
    chunks.push(remaining.substring(0, cutAt).trim());
    remaining = remaining.substring(cutAt).trim();
  }
  return chunks.filter((c) => c.length > 0);
}

async function synthesizeGoogleTTS(text: string, lang: string, _rate: number): Promise<Uint8Array> {
  const MAX_CHUNK = 200;
  const chunks    = splitTextIntoChunks(text, MAX_CHUNK);
  const audioChunks: Uint8Array[] = [];

  for (const chunk of chunks) {
    const url  =
      `https://translate.google.com/translate_tts` +
      `?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${lang}&client=tw-ob`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36` +
          ` (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36`,
        "Referer": "https://translate.google.com/",
        "Accept":  "audio/mpeg, audio/*",
      },
    });
    if (!resp.ok) throw new Error(`Google TTS HTTP ${resp.status} para chunk: ${chunk.slice(0, 40)}`);
    const buf = await resp.arrayBuffer();
    audioChunks.push(new Uint8Array(buf));
  }

  const total  = audioChunks.reduce((s, c) => s + c.length, 0);
  const output = new Uint8Array(total);
  let offset   = 0;
  for (const c of audioChunks) { output.set(c, offset); offset += c.length; }
  return output;
}
