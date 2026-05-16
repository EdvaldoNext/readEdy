/**
 * ReadEra TTS Proxy — Supabase Edge Function (Deno)
 *
 * Cadeia de síntese (TTS_PROVIDER=auto por defeito):
 *   1. OpenAI TTS — se OPENAI_API_KEY estiver definida
 *   2. edge-tts-universal (Microsoft Edge, token/DRM atualizados)
 *   3. Google Cloud TTS — se GOOGLE_CLOUD_TTS_API_KEY estiver definida
 *   4. Google Translate TTS (fallback gratuito)
 *
 * GET ?text=&voice=&rate=  →  audio/mpeg 200
 * POST { text, voice, rate }  →  audio/mpeg 200
 */

import { EdgeTTS } from "edge-tts-universal";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const DEFAULT_VOICE = "pt-BR-FranciscaNeural";
const MAX_CHARS = 4000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  let text = "";
  let voice = DEFAULT_VOICE;
  let rate = 1.0;

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      text = (url.searchParams.get("text") || "").trim();
      voice = url.searchParams.get("voice") || DEFAULT_VOICE;
      rate = clampRate(Number(url.searchParams.get("rate") || "1.0"));
    } else if (req.method === "POST") {
      const body = await req.json();
      text = String(body.text ?? "").trim();
      voice = String(body.voice ?? DEFAULT_VOICE);
      rate = clampRate(Number(body.rate) || 1.0);
    } else {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: CORS,
      });
    }

    if (!text) {
      return jsonError("text is required", 400);
    }

    const sendText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
    const audioData = await synthesizeWithFallback(sendText, voice, rate);

    return new Response(audioData, {
      status: 200,
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
    return jsonError(msg, 500);
  }
});

function jsonError(msg: string, status: number): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1.0;
  return Math.max(0.25, Math.min(3.0, rate));
}

function rateToProsody(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return (pct >= 0 ? "+" : "") + pct + "%";
}

/* ── Cadeia de providers ───────────────────────────────────── */

async function synthesizeWithFallback(
  text: string,
  voice: string,
  rate: number,
): Promise<Uint8Array> {
  const mode = (Deno.env.get("TTS_PROVIDER") || "auto").toLowerCase();
  const errors: string[] = [];

  const providers: Array<{
    name: string;
    enabled: boolean;
    run: () => Promise<Uint8Array>;
  }> = [];

  if (mode === "openai") {
    providers.push({ name: "openai", enabled: true, run: () => synthesizeOpenAI(text, voice, rate) });
  } else if (mode === "google") {
    providers.push({ name: "google-cloud", enabled: true, run: () => synthesizeGoogleCloud(text, voice, rate) });
  } else if (mode === "edge") {
    providers.push({ name: "edge", enabled: true, run: () => synthesizeEdgeUniversal(text, voice, rate) });
  } else {
    /* auto: APIs pagas primeiro (se configuradas), depois Edge, depois fallbacks */
    if (Deno.env.get("OPENAI_API_KEY")) {
      providers.push({ name: "openai", enabled: true, run: () => synthesizeOpenAI(text, voice, rate) });
    }
    providers.push({ name: "edge", enabled: true, run: () => synthesizeEdgeUniversal(text, voice, rate) });
    if (Deno.env.get("GOOGLE_CLOUD_TTS_API_KEY")) {
      providers.push({ name: "google-cloud", enabled: true, run: () => synthesizeGoogleCloud(text, voice, rate) });
    }
    providers.push({ name: "google-translate", enabled: true, run: () => synthesizeGoogleTranslate(text, voice) });
  }

  for (const p of providers) {
    if (!p.enabled) continue;
    try {
      const data = await p.run();
      if (data && data.length > 0) {
        console.log(`[tts-proxy] OK via ${p.name} (${data.length} bytes)`);
        return data;
      }
      errors.push(`${p.name}: empty audio`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p.name}: ${msg}`);
      console.warn(`[tts-proxy] ${p.name} falhou:`, msg);
    }
  }

  throw new Error("Todos os motores TTS falharam: " + errors.join(" | "));
}

/* ── 1. Microsoft Edge via edge-tts-universal (DRM/token atual) ─ */

async function synthesizeEdgeUniversal(
  text: string,
  voice: string,
  rate: number,
): Promise<Uint8Array> {
  const tts = new EdgeTTS(text, voice, { rate: rateToProsody(rate) });
  const result = await tts.synthesize();
  const buf = await result.audio.arrayBuffer();
  if (!buf || buf.byteLength === 0) {
    throw new Error("Edge TTS returned empty audio");
  }
  return new Uint8Array(buf);
}

/* ── 2. OpenAI TTS (OPENAI_API_KEY) ────────────────────────── */

function mapOpenAIVoice(voice: string): string {
  const v = voice.toLowerCase();
  if (v.includes("male") || v.includes("antonio") || v.includes("donaldo")) return "onyx";
  if (v.startsWith("en")) return "nova";
  return "nova";
}

async function synthesizeOpenAI(
  text: string,
  voice: string,
  rate: number,
): Promise<Uint8Array> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not set");

  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_TTS_MODEL") || "tts-1",
      input: text,
      voice: mapOpenAIVoice(voice),
      speed: rate,
      response_format: "mp3",
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`OpenAI TTS HTTP ${resp.status}: ${errBody.slice(0, 200)}`);
  }

  return new Uint8Array(await resp.arrayBuffer());
}

/* ── 3. Google Cloud TTS (GOOGLE_CLOUD_TTS_API_KEY) ────────── */

function mapGoogleCloudVoice(voice: string): { languageCode: string; name: string } {
  const v = voice.toLowerCase();
  if (v.startsWith("pt-br")) {
    return { languageCode: "pt-BR", name: "pt-BR-Standard-A" };
  }
  if (v.startsWith("pt")) {
    return { languageCode: "pt-PT", name: "pt-PT-Standard-A" };
  }
  if (v.startsWith("en")) {
    return { languageCode: "en-US", name: "en-US-Standard-C" };
  }
  if (v.startsWith("es")) {
    return { languageCode: "es-ES", name: "es-ES-Standard-A" };
  }
  return { languageCode: "pt-BR", name: "pt-BR-Standard-A" };
}

async function synthesizeGoogleCloud(
  text: string,
  voice: string,
  rate: number,
): Promise<Uint8Array> {
  const key = Deno.env.get("GOOGLE_CLOUD_TTS_API_KEY");
  if (!key) throw new Error("GOOGLE_CLOUD_TTS_API_KEY not set");

  const mapped = mapGoogleCloudVoice(voice);
  const speakingRate = rate;

  const resp = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: mapped.languageCode,
          name: mapped.name,
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate,
        },
      }),
    },
  );

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Google Cloud TTS HTTP ${resp.status}: ${errBody.slice(0, 200)}`);
  }

  const json = await resp.json();
  if (!json.audioContent) {
    throw new Error("Google Cloud TTS: no audioContent");
  }

  const binary = atob(json.audioContent);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/* ── 4. Google Translate TTS (fallback gratuito) ───────────── */

function voiceToGoogleLang(voice: string): string {
  const v = voice.toLowerCase();
  if (v.startsWith("pt-br")) return "pt-br";
  if (v.startsWith("pt-pt") || v.startsWith("pt")) return "pt";
  if (v.startsWith("en")) return "en";
  if (v.startsWith("es")) return "es";
  if (v.startsWith("fr")) return "fr";
  if (v.startsWith("de")) return "de";
  if (v.startsWith("it")) return "it";
  return voice.substring(0, 5).toLowerCase();
}

function splitTextIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.substring(0, maxLen);
    let cutAt = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
    );
    if (cutAt <= 0) cutAt = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf(" "));
    if (cutAt <= 0) cutAt = maxLen;
    else cutAt += 1;
    chunks.push(remaining.substring(0, cutAt).trim());
    remaining = remaining.substring(cutAt).trim();
  }
  return chunks.filter((c) => c.length > 0);
}

async function synthesizeGoogleTranslate(
  text: string,
  voice: string,
): Promise<Uint8Array> {
  const lang = voiceToGoogleLang(voice);
  const chunks = splitTextIntoChunks(text, 200);
  const audioChunks: Uint8Array[] = [];
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

  const clients = ["tw-ob", "gtx", "dict-chrome-ex"];

  for (const chunk of chunks) {
    let got = false;
    for (const client of clients) {
      const url =
        `https://translate.google.com/translate_tts` +
        `?ie=UTF-8&client=${client}&tl=${lang}&q=${encodeURIComponent(chunk)}`;
      try {
        const resp = await fetch(url, {
          headers: {
            "User-Agent": ua,
            Referer: "https://translate.google.com/",
            Accept: "audio/mpeg, audio/*",
          },
        });
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          if (buf.byteLength > 100) {
            audioChunks.push(new Uint8Array(buf));
            got = true;
            break;
          }
        }
      } catch (_) {
        /* tenta próximo client */
      }
    }
    if (!got) {
      throw new Error(`Google Translate TTS failed for chunk (${chunk.length} chars)`);
    }
  }

  const total = audioChunks.reduce((s, c) => s + c.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const c of audioChunks) {
    output.set(c, offset);
    offset += c.length;
  }
  return output;
}
