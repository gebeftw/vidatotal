// Armazenamento no Upstash Redis (integração "Upstash for Redis" do Vercel Marketplace)
// via API REST — sem driver, só fetch.
// Cada lançamento é um campo de um hash, então duas mensagens simultâneas
// não sobrescrevem uma à outra.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const LEDGER = process.env.LEDGER_ID || "default";

const K = {
  tx: `vt:${LEDGER}:tx`,
  budgets: `vt:${LEDGER}:budgets`,
  history: (phone) => `vt:${LEDGER}:hist:${phone}`,
  seen: (msgId) => `vt:seen:${msgId}`,
};

async function redis(...command) {
  if (!URL_ || !TOKEN) throw new Error("Banco não configurado: defina KV_REST_API_URL e KV_REST_API_TOKEN");
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Redis: ${data.error}`);
  return data.result;
}

const pairsToObject = (arr) => {
  const out = {};
  for (let i = 0; i < (arr || []).length; i += 2) out[arr[i]] = arr[i + 1];
  return out;
};

/* ─── Lançamentos ─── */
export async function listTransactions() {
  const raw = pairsToObject(await redis("HGETALL", K.tx));
  return Object.values(raw)
    .map((v) => JSON.parse(v))
    .sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));
}

export async function getTransaction(id) {
  const v = await redis("HGET", K.tx, id);
  return v ? JSON.parse(v) : null;
}

export async function saveTransaction(tx) {
  await redis("HSET", K.tx, tx.id, JSON.stringify(tx));
  return tx;
}

export async function deleteTransaction(id) {
  return (await redis("HDEL", K.tx, id)) > 0;
}

/* ─── Orçamentos mensais por categoria ─── */
export async function getBudgets() {
  const raw = pairsToObject(await redis("HGETALL", K.budgets));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]));
}

export async function setBudget(category, amount) {
  if (!amount) return redis("HDEL", K.budgets, category);
  return redis("HSET", K.budgets, category, String(amount));
}

/* ─── Memória curta da conversa (últimas trocas, expira em 2h) ─── */
export async function getHistory(phone) {
  const v = await redis("GET", K.history(phone));
  return v ? JSON.parse(v) : [];
}

export async function saveHistory(phone, history) {
  await redis("SET", K.history(phone), JSON.stringify(history.slice(-10)), "EX", 7200);
}

/* ─── Evita processar a mesma mensagem duas vezes (o WhatsApp reenvia) ─── */
export async function markSeen(msgId) {
  return (await redis("SET", K.seen(msgId), "1", "NX", "EX", 86400)) === "OK";
}
