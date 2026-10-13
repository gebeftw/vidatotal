// Webhook da WhatsApp Cloud API.
// GET  → verificação do webhook pela Meta
// POST → mensagens recebidas
import { waitUntil } from "@vercel/functions";
import { handleMessage } from "../lib/assistant.js";
import { markSeen } from "../lib/db.js";
import { verifySignature, isAllowed, sendText, markRead, downloadMedia } from "../lib/whatsapp.js";

export function GET(request) {
  const p = new URL(request.url).searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(p.get("hub.challenge"), { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body;
  try { body = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }

  const messages = (body.entry || []).flatMap((e) => (e.changes || []).flatMap((c) => c.value?.messages || []));
  // Responde 200 na hora (a Meta reenvia se demorar) e processa em segundo plano.
  for (const msg of messages) waitUntil(processMessage(msg));
  return new Response("OK", { status: 200 });
}

const HELP = `👋 Sou seu assistente financeiro. Me mande:
• "gastei 45 no mercado"
• "uber 18,50 e almoço 32"
• "recebi 3500 de salário"
• uma *foto da nota fiscal*
• "resumo do mês" / "quanto gastei com lazer?"
• "orçamento alimentação 800"
• "apaga o último"`;

async function processMessage(msg) {
  const from = msg.from;
  try {
    if (!isAllowed(from)) return console.warn("Número não autorizado:", from);
    if (!(await markSeen(msg.id))) return; // já processada
    await markRead(msg.id);

    let content, note;
    if (msg.type === "text") {
      const text = msg.text.body.trim();
      if (/^(ajuda|help|menu|oi|olá|ola)$/i.test(text)) return sendText(from, HELP);
      content = note = text;
    } else if (msg.type === "image" || msg.type === "document") {
      const media = msg[msg.type];
      const { data, mimeType } = await downloadMedia(media.id);
      const caption = media.caption || "Registre este comprovante.";
      let block;
      if (mimeType === "application/pdf") {
        block = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
      } else if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) {
        block = { type: "image", source: { type: "base64", media_type: mimeType, data } };
      } else {
        return sendText(from, "📎 Consigo ler fotos (JPG/PNG) e PDFs de comprovantes. Esse formato não é suportado.");
      }
      content = [block, { type: "text", text: caption }];
      note = `[enviou ${msg.type === "image" ? "foto" : "PDF"} de comprovante] ${caption}`;
    } else if (msg.type === "audio") {
      return sendText(from, "🎤 Ainda não entendo áudios. Pode escrever? Ex: \"gastei 45 no mercado\"");
    } else {
      return;
    }

    const reply = await handleMessage(from, content, note);
    await sendText(from, reply);
  } catch (err) {
    console.error("Erro ao processar mensagem:", err);
    await sendText(from, "⚠️ Tive um problema para processar sua mensagem. Tente de novo em instantes.").catch(() => {});
  }
}
