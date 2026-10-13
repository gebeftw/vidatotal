// Integração com a WhatsApp Cloud API (Meta).
import crypto from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Confere a assinatura X-Hub-Signature-256 que a Meta envia em cada webhook.
export function verifySignature(rawBody, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // recomendado configurar em produção
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = header.slice(7);
  return got.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// Números brasileiros às vezes chegam sem o 9º dígito (55 11 9XXXX-XXXX → 55 11 XXXX-XXXX).
const variants = (n) => {
  const d = String(n).replace(/\D/g, "");
  const out = new Set([d]);
  if (/^55\d{2}9\d{8}$/.test(d)) out.add(d.slice(0, 4) + d.slice(5));
  if (/^55\d{2}\d{8}$/.test(d)) out.add(d.slice(0, 4) + "9" + d.slice(4));
  return [...out];
};

export function isAllowed(from) {
  const list = (process.env.ALLOWED_NUMBERS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return false;
  const allowed = new Set(list.flatMap(variants));
  return variants(from).some((v) => allowed.has(v));
}

export async function sendText(to, text) {
  // Limite de 4096 caracteres por mensagem.
  for (let i = 0; i < text.length; i += 4000) {
    const res = await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text.slice(i, i + 4000) },
      }),
    });
    if (!res.ok) console.error("Falha ao enviar WhatsApp:", res.status, await res.text());
  }
}

export async function markRead(messageId) {
  await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  }).catch(() => {});
}

// Baixa uma mídia (foto de nota fiscal, PDF) e devolve em base64.
export async function downloadMedia(mediaId) {
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${TOKEN}` } }).then((r) => r.json());
  if (!meta.url) throw new Error("Mídia não encontrada");
  const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const buf = Buffer.from(await bin.arrayBuffer());
  return { data: buf.toString("base64"), mimeType: (meta.mime_type || "").split(";")[0] };
}
