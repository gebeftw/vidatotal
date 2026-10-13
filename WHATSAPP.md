# 📲 Assistente financeiro no WhatsApp

Mande seus gastos pelo WhatsApp e o assistente registra, categoriza, avisa quando você estoura o orçamento e responde resumos. Tudo aparece na aba **Finanças** do Vida Total.

## O que ele entende

| Você manda | Ele faz |
|---|---|
| `gastei 45 no mercado` | ✅ R$ 45,00 · Alimentação · Mercado |
| `uber 18,50 e almoço 32` | registra os dois |
| `paguei a luz 210 ontem` | registra com a data de ontem |
| `recebi 3500 de salário` | registra como receita |
| 📷 foto ou PDF da nota fiscal | lê valor, loja e data e registra |
| `resumo do mês` / `quanto gastei com lazer?` | totais por categoria e saldo |
| `orçamento alimentação 800` | define limite mensal e avisa ao chegar em 80% e 100% |
| `apaga o último` / `na verdade foi 50` | apaga ou corrige |
| `ajuda` | mostra os exemplos |

## Como funciona

```
WhatsApp → Meta Cloud API → /api/whatsapp (Vercel) → Claude (entende e usa ferramentas) → Upstash Redis
                                                                                              ↑
                                                        App Vida Total (aba Finanças) → /api/finance
```

- `api/whatsapp.js` — webhook: confere assinatura, aceita só os números em `ALLOWED_NUMBERS`, ignora mensagens repetidas.
- `lib/assistant.js` — o Claude com as ferramentas: registrar, consultar, editar, apagar e definir orçamento.
- `lib/db.js` — lançamentos e orçamentos no Upstash Redis.
- `api/finance.js` — o app busca/apaga lançamentos com o `APP_TOKEN`.

## Configuração (≈ 20 min)

### 1. Banco de dados
No painel do Vercel do projeto: **Storage → Create → Upstash for Redis** e conecte ao projeto. As variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` são criadas sozinhas.

### 2. Chave do Claude
Crie uma chave em https://console.anthropic.com → **API Keys** e salve como `ANTHROPIC_API_KEY` nas variáveis de ambiente do Vercel.

### 3. WhatsApp (Meta)
1. Acesse https://developers.facebook.com → **Meus apps → Criar app → Outro → Empresa**.
2. Adicione o produto **WhatsApp**. Em **API Setup** você ganha um número de teste:
   - copie o **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - em **To**, cadastre e confirme o **seu** celular.
3. Token permanente: **Configurações do negócio → Usuários do sistema → Adicionar** (admin) → **Gerar token** com as permissões `whatsapp_business_messaging` e `whatsapp_business_management` → `WHATSAPP_TOKEN`.
   (O token temporário da página API Setup funciona para testar, mas expira em 24h.)
4. **Configurações do app → Básico → Chave secreta do app** → `WHATSAPP_APP_SECRET`.

### 4. Demais variáveis no Vercel
- `WHATSAPP_VERIFY_TOKEN`: uma senha qualquer que você inventa.
- `ALLOWED_NUMBERS`: seu número com DDI e DDD, só dígitos (ex: `5511987654321`). Separe por vírgula para dividir o controle com outra pessoa — vocês compartilham os mesmos lançamentos.
- `APP_TOKEN`: um texto longo e aleatório (ex: `openssl rand -hex 24`).

Faça o **redeploy** depois de salvar as variáveis.

### 5. Ligar o webhook
Na Meta: **WhatsApp → Configuração → Webhook → Editar**
- URL de callback: `https://SEU-SITE.vercel.app/api/whatsapp`
- Token de verificação: o mesmo `WHATSAPP_VERIFY_TOKEN`
- Em **Campos do webhook**, assine **messages**.

### 6. Testar
Mande `ajuda` para o número de teste. Depois `gastei 45 no mercado`.
No app: **Finanças → Assistente no WhatsApp**, cole o `APP_TOKEN` e toque em **Conectar**.

## Custos
- **WhatsApp:** conversas iniciadas por você (e respondidas em até 24h) não são cobradas pela Meta.
- **Claude:** cobrado por uso na sua conta Anthropic. Por padrão usa `claude-opus-5-5` com esforço baixo; para economizar, defina `ANTHROPIC_MODEL=claude-haiku-5-5`.
- **Vercel / Upstash:** os planos gratuitos dão conta do uso pessoal.

## Observações
- Áudios ainda não são entendidos (o assistente pede para escrever).
- Gastos lançados manualmente no app continuam só no navegador; os do WhatsApp ficam no servidor e são sincronizados ao abrir a aba Finanças. Apagar um gasto 📲 no app também apaga no servidor.
