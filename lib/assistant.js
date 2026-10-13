// Cérebro do assistente: o Claude interpreta a mensagem e usa ferramentas
// para registrar, consultar, editar e apagar lançamentos.
import Anthropic from "@anthropic-ai/sdk";
import * as db from "./db.js";

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const TZ = process.env.TIMEZONE || "America/Sao_Paulo";

// Mesmas categorias da aba Finanças do app.
export const EXPENSE_CATS = ["Alimentação", "Moradia", "Transporte", "Saúde", "Lazer", "Educação", "Assinaturas", "Outros"];
export const INCOME_CATS = ["Salário", "Freelance", "Investimentos", "Outros"];

const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const DATE = { type: "string", description: "Data no formato YYYY-MM-DD" };

const tools = [
  {
    name: "registrar_lancamentos",
    description: "Registra um ou mais gastos ou receitas. Use sempre que o usuário informar algo que gastou, pagou, comprou ou recebeu (inclusive a partir de foto de nota fiscal).",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["lancamentos"],
      properties: {
        lancamentos: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["tipo", "valor", "categoria", "descricao", "data"],
            properties: {
              tipo: { type: "string", enum: ["gasto", "receita"] },
              valor: { type: "number", description: "Valor positivo em reais" },
              categoria: { type: "string", enum: [...new Set([...EXPENSE_CATS, ...INCOME_CATS])] },
              descricao: { type: "string", description: "Descrição curta, ex: 'Almoço', 'Uber', 'Conta de luz'" },
              data: DATE,
            },
          },
        },
      },
    },
  },
  {
    name: "consultar",
    description: "Consulta lançamentos e totais em um período. Use para resumos, saldo, 'quanto gastei com X', e para achar o id de um lançamento antes de editar ou apagar.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["data_inicio", "data_fim"],
      properties: {
        data_inicio: DATE,
        data_fim: DATE,
        categoria: { type: "string", description: "Filtrar por uma categoria (opcional)" },
        tipo: { type: "string", enum: ["gasto", "receita"] },
      },
    },
  },
  {
    name: "editar_lancamento",
    description: "Corrige um lançamento existente pelo id. Envie só os campos que mudam.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" },
        valor: { type: "number" },
        categoria: { type: "string" },
        descricao: { type: "string" },
        data: DATE,
      },
    },
  },
  {
    name: "apagar_lancamento",
    description: "Apaga um lançamento pelo id.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "definir_orcamento",
    description: "Define o limite mensal de gastos de uma categoria. Valor 0 remove o limite.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["categoria", "valor_mensal"],
      properties: {
        categoria: { type: "string", enum: EXPENSE_CATS },
        valor_mensal: { type: "number" },
      },
    },
  },
];

// Situação do mês da data informada para uma categoria (usado nos alertas de orçamento).
function monthStatus(all, budgets, category, date) {
  const month = date.slice(0, 7);
  const spent = all
    .filter((t) => t.type === "expense" && t.category === category && t.date.startsWith(month))
    .reduce((s, t) => s + t.amount, 0);
  const limit = budgets[category];
  return limit
    ? { categoria: category, gasto_no_mes: spent, orcamento: limit, percentual: Math.round((spent / limit) * 100) }
    : { categoria: category, gasto_no_mes: spent };
}

async function runTool(name, input, phone) {
  switch (name) {
    case "registrar_lancamentos": {
      const saved = [];
      for (const l of input.lancamentos) {
        const tx = {
          id: newId(),
          type: l.tipo === "receita" ? "income" : "expense",
          amount: Math.abs(Number(l.valor)),
          category: l.categoria,
          description: l.descricao,
          date: l.data,
          createdAt: new Date().toISOString(),
          source: "whatsapp",
          by: phone,
        };
        saved.push(await db.saveTransaction(tx));
      }
      const [all, budgets] = await Promise.all([db.listTransactions(), db.getBudgets()]);
      const cats = [...new Set(saved.filter((t) => t.type === "expense").map((t) => `${t.category}|${t.date}`))];
      return {
        registrados: saved.map((t) => ({ id: t.id, tipo: t.type, valor: t.amount, categoria: t.category, descricao: t.description, data: t.date })),
        situacao_mes: cats.map((c) => monthStatus(all, budgets, ...c.split("|"))),
      };
    }
    case "consultar": {
      const [all, budgets] = await Promise.all([db.listTransactions(), db.getBudgets()]);
      const type = input.tipo === "receita" ? "income" : input.tipo === "gasto" ? "expense" : null;
      const list = all.filter((t) =>
        t.date >= input.data_inicio && t.date <= input.data_fim &&
        (!input.categoria || t.category.toLowerCase() === input.categoria.toLowerCase()) &&
        (!type || t.type === type));
      const gastos = list.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
      const receitas = list.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
      const porCategoria = {};
      for (const t of list.filter((t) => t.type === "expense")) porCategoria[t.category] = (porCategoria[t.category] || 0) + t.amount;
      return {
        total_gastos: gastos,
        total_receitas: receitas,
        saldo: receitas - gastos,
        gastos_por_categoria: porCategoria,
        orcamentos_mensais: budgets,
        quantidade: list.length,
        ultimos_lancamentos: list.slice(-40).map((t) => ({ id: t.id, tipo: t.type === "income" ? "receita" : "gasto", valor: t.amount, categoria: t.category, descricao: t.description, data: t.date })),
      };
    }
    case "editar_lancamento": {
      const tx = await db.getTransaction(input.id);
      if (!tx) return { erro: "Lançamento não encontrado" };
      if (input.valor != null) tx.amount = Math.abs(Number(input.valor));
      if (input.categoria) tx.category = input.categoria;
      if (input.descricao) tx.description = input.descricao;
      if (input.data) tx.date = input.data;
      await db.saveTransaction(tx);
      return { atualizado: tx };
    }
    case "apagar_lancamento":
      return (await db.deleteTransaction(input.id)) ? { apagado: input.id } : { erro: "Lançamento não encontrado" };
    case "definir_orcamento":
      await db.setBudget(input.categoria, input.valor_mensal);
      return { ok: true, orcamentos: await db.getBudgets() };
    default:
      return { erro: `Ferramenta desconhecida: ${name}` };
  }
}

const systemPrompt = () => `Você é o assistente financeiro pessoal do app Vida Total, conversando pelo WhatsApp em português do Brasil.
Hoje é ${todayISO()} (fuso ${TZ}).

O usuário manda mensagens curtas e informais como "gastei 32 no almoço", "uber 18,50", "paguei a luz 210 ontem", "recebi 3500 de salário", ou fotos de notas fiscais. Sua função é manter o controle financeiro por ele:
- Registre cada gasto/receita com registrar_lancamentos, escolhendo a categoria mais adequada. Datas relativas ("ontem", "sexta") viram datas absolutas. Uma mensagem pode ter vários lançamentos.
- Gastos usam: ${EXPENSE_CATS.join(", ")}. Receitas usam: ${INCOME_CATS.join(", ")}.
- Em foto ou PDF de nota fiscal/comprovante, leia o valor total, o estabelecimento e a data, e registre. Se não der para ler o valor, peça ao usuário.
- Se faltar o valor, pergunte. Se a categoria for ambígua, escolha a mais provável e diga qual usou.
- Para resumos, saldo ou "quanto gastei", use consultar com o período certo (padrão: mês atual).
- Para corrigir ou apagar ("apaga o último", "na verdade foi 45"), consulte para achar o id e depois edite/apague.
- Depois de registrar, se a situação do mês mostrar 80% ou mais do orçamento da categoria, avise. Acima de 100%, alerte com destaque.

Respostas: curtas e diretas, formato WhatsApp (*negrito*, listas com •), valores como R$ 1.234,56, no máximo um emoji por linha. Confirme o que foi registrado em uma linha (ex: "✅ R$ 32,00 · Alimentação · Almoço"). Não invente lançamentos que o usuário não informou.`;

// Processa uma mensagem do usuário e devolve o texto de resposta.
// `content` é uma string ou uma lista de blocos (imagem/documento + texto).
export async function handleMessage(phone, content, historyNote) {
  const history = await db.getHistory(phone);
  const messages = [...history, { role: "user", content }];

  for (let i = 0; i < 8; i++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: systemPrompt(),
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") return "Desculpe, não consegui processar essa mensagem.";

    messages.push({ role: "assistant", content: response.content });
    const toolUses = response.content.filter((b) => b.type === "tool_use");

    if (response.stop_reason !== "tool_use" || !toolUses.length) {
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim()
        || "✅ Feito.";
      // Guarda só o texto da conversa como memória curta.
      await db.saveHistory(phone, [...history, { role: "user", content: historyNote }, { role: "assistant", content: text }]);
      return text;
    }

    const results = await Promise.all(toolUses.map(async (t) => {
      try {
        return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(await runTool(t.name, t.input, phone)) };
      } catch (err) {
        return { type: "tool_result", tool_use_id: t.id, is_error: true, content: String(err.message || err) };
      }
    }));
    messages.push({ role: "user", content: results });
  }
  return "⚠️ Não consegui concluir. Tente reformular a mensagem.";
}
