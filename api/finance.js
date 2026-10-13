// API usada pelo app (aba Finanças) para ler e apagar os lançamentos feitos pelo WhatsApp.
// Protegida pelo APP_TOKEN: envie "Authorization: Bearer <APP_TOKEN>".
import crypto from "node:crypto";
import { listTransactions, getBudgets, deleteTransaction } from "../lib/db.js";

function authorized(request) {
  const expected = process.env.APP_TOKEN;
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !got || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function GET(request) {
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  const [transactions, budgets] = await Promise.all([listTransactions(), getBudgets()]);
  return json({ transactions, budgets });
}

export async function DELETE(request) {
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "missing id" }, 400);
  return json({ deleted: await deleteTransaction(id) });
}
