# Contrato: cobrança Mercado Pago (Checkout Pro)

Pagamento único pelo Checkout Pro. Cada pagamento libera acesso por um período fixo (padrão: 30 dias). Não cria assinatura recorrente (`preapproval`).

Troque só a ficha. O restante permanece igual em qualquer app.

## Ficha do app

| Campo | Valor |
|---|---|
| Nome no extrato (`statement_descriptor`) | até 13 caracteres, sem acento |
| URL pública do app | `https://app.exemplo.com` |
| URL de retorno | `{APP_URL}/?checkout={token}&tab=conta` |
| Moeda | `BRL` |
| Parcelas | `1` |
| Período liberado após aprovação | `30 dias` |
| Tolerância depois do vencimento (`past_due`) | `3 dias` |
| Plano padrão | `basic_monthly` |
| Título do item | `{APP} — {plano} (30 dias)` |
| Descrição do item | Acesso por 30 dias |

## Segredos

Ficam só no servidor. Nunca no browser.

| Variável | Uso |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | `Authorization: Bearer` nas chamadas à API |
| `MERCADOPAGO_WEBHOOK_SECRET` | Validar `x-signature` |
| `APP_URL` | Montar `back_urls` quando o cliente não envia a URL |
| `SUPABASE_URL` | Base das functions, se o backend for Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Gravar sessão, assinatura e eventos |
| `SUPABASE_ANON_KEY` | Validar o JWT do usuário |

O browser chama o backend com a chave pública no header `apikey` (Supabase) e o JWT do usuário em `Authorization`.

## Peças

| Peça | Responsabilidade |
|---|---|
| `create-checkout` | Lê o plano, cria a preference, grava sessão e assinatura `pending` |
| `mercadopago-webhook` | Confirma o pagamento na API e ativa o acesso |
| `link-checkout` | Liga a sessão paga à conta logada |
| Cliente | Guarda o token, redireciona para `init_point`, religa no retorno |
| Banco | Planos, sessões, assinaturas, eventos do webhook |

API: `https://api.mercadopago.com`.

## Fluxo

1. O usuário já tem conta (precisa de e-mail) e escolhe um plano.
2. O cliente faz `POST` em `create-checkout` com `{ plan_slug, payer_email }`.
3. O servidor gera um `checkout_token` (UUID). Esse valor é o `external_reference`.
4. O servidor cria a preference e grava `checkout_sessions` (`pending`) e `subscriptions` (`pending`).
5. A resposta traz `init_point`, `checkout_token` e `preference_id`.
6. O cliente salva o token e redireciona o browser para `init_point`.
7. O Mercado Pago cobra e devolve o usuário para a URL de retorno com `?checkout={token}`.
8. Em paralelo, o Mercado Pago chama o webhook com `type: payment`.
9. O webhook busca o pagamento em `GET /v1/payments/{id}`. Só `approved` libera acesso.
10. O cliente chama `link-checkout` com o token e o JWT. A assinatura ganha `user_id`.
11. A tela lê `subscriptions` do usuário. Acesso vale enquanto `status` é `active` (ou `past_due` dentro da tolerância) e `current_period_end` ainda não passou.

Se o webhook ainda não chegou, `link-checkout` confirma com `GET /v1/payments/search?external_reference={token}`.

## Banco

Writes só com service role. O cliente autenticado só faz `select` da própria assinatura.

```sql
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  price_brl numeric(10, 2) not null,
  billing_interval text not null default 'month'
    check (billing_interval in ('month', 'year')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  plan_id uuid not null references public.plans (id),
  payer_email text,
  preference_id text,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'linked')),
  user_id uuid references auth.users (id) on delete set null,
  subscription_id uuid,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'past_due', 'canceled', 'expired')),
  preference_id text,
  checkout_session_id uuid references public.checkout_sessions (id) on delete set null,
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.checkout_sessions
  add constraint checkout_sessions_subscription_id_fkey
  foreign key (subscription_id) references public.subscriptions (id) on delete set null;

create unique index subscriptions_one_open_per_user_idx
  on public.subscriptions (user_id)
  where user_id is not null
    and status in ('pending', 'active', 'past_due');

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  mp_event_id text not null unique,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

`user_id` na assinatura pode nascer nulo e ser preenchido no vínculo. O índice único impede duas assinaturas abertas para o mesmo usuário.

RLS: `select` da própria linha em `subscriptions` e dos `plans` ativos. Sem policy de insert ou update para o cliente.

Em outro banco, mantenha as mesmas colunas e o índice único. Troque só tipos e a forma de autenticar o usuário.

## 1. Criar checkout

`POST`. CORS limitado ao domínio do app.

1. Recusar plano inexistente, inativo ou gratuito.
2. Ler o usuário pelo JWT. Exigir e-mail (do body ou da conta).
3. `checkoutToken = crypto.randomUUID()`.
4. `POST https://api.mercadopago.com/checkout/preferences`:

```json
{
  "items": [{
    "id": "{plan.slug}",
    "title": "{APP} — {plan.name} (30 dias)",
    "description": "Acesso por 30 dias",
    "quantity": 1,
    "currency_id": "BRL",
    "unit_price": 5.99
  }],
  "payer": { "email": "{payer_email}" },
  "external_reference": "{checkoutToken}",
  "back_urls": {
    "success": "{backUrl}",
    "failure": "{backUrl}",
    "pending": "{backUrl}"
  },
  "auto_return": "approved",
  "notification_url": "{SERVER}/mercadopago-webhook",
  "statement_descriptor": "MEUAPP",
  "metadata": {
    "checkout_token": "{checkoutToken}",
    "plan_slug": "{plan.slug}",
    "user_id": "{userId ou null}"
  },
  "payment_methods": { "installments": 1 }
}
```

5. Sem `init_point` (em teste, `sandbox_init_point`), abortar.
6. Inserir `checkout_sessions` com `token`, `plan_id`, `payer_email`, `preference_id`, `status = pending`, `user_id`.
7. Se o usuário já tem assinatura `pending`, `active` ou `past_due`, atualizar essa linha. Caso contrário, inserir. Campos: `plan_id`, `status = pending`, `preference_id`, `checkout_session_id`, `current_period_end = null`.
8. Se a assinatura nasceu sem `user_id`, gravar `checkout_sessions.subscription_id`.
9. Responder `{ init_point, checkout_token, preference_id }`.

## 2. Webhook

`POST` no endpoint público `mercadopago-webhook`.

No painel do Mercado Pago, o tópico deste contrato é `payment`.

1. Ler o body cru. A assinatura usa esses bytes.
2. Validar `x-signature`. Inválida: `401` e parar.
3. Inserir em `billing_events` com `mp_event_id` único (`data.id` ou `x-request-id`). Código `23505`: responder `{ ok: true, duplicate: true }` e parar.
4. Se o tópico for `payment` e houver `data.id`, buscar o pagamento. O resto do body não decide acesso.
5. `GET https://api.mercadopago.com/v1/payments/{id}` com o access token.
6. Seguir só se `status = approved`.
7. Achar a sessão por `external_reference` (token) ou, em seguida, por `preference_id`.
8. Sessão → `status = paid`.
9. Assinatura → `status = active`, `current_period_end = agora + período`, `updated_at = agora`. Ordem: `checkout.subscription_id`, depois `user_id` com status aberto, depois `preference_id`.
10. Responder `{ ok: true }`.

Manifest oficial:

```text
id:{data.id em minúsculas se tiver letras};request-id:{x-request-id};ts:{ts};
```

`x-signature` vem como `ts=...,v1=...`. `v1` é HMAC-SHA256 do manifest, em hex, com o webhook secret. Comparar em tempo constante.

```ts
async function verifyMpSignature(req: Request, body: string, secret: string): Promise<boolean> {
  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature || !xRequestId) return false;

  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k?.trim(), (v || "").trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  let dataId = "";
  try {
    dataId = String(JSON.parse(body)?.data?.id || "");
  } catch {
    return false;
  }
  if (/[a-zA-Z]/.test(dataId)) dataId = dataId.toLowerCase();

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
```

## 3. Vincular à conta

`POST` com JWT obrigatório e `{ checkout_token }`.

1. Identificar o usuário pelo JWT. Sem usuário, `401`.
2. Buscar `checkout_sessions` pelo token. `404` se não existir. `expired` recusa. `linked` responde `{ ok: true, already_linked: true }`.
3. Achar a assinatura por `subscription_id` ou por `preference_id`.
4. Se `subscriptions.user_id` já pertence a outra conta, `409`.
5. Pago = sessão `paid`, ou existe pagamento `approved` em `GET /v1/payments/search?external_reference={token}&sort=date_created&criteria=desc`. Se o resultado tiver `preference_id`, ele precisa bater com o da sessão.
6. Atualizar a assinatura: `user_id`, `checkout_session_id`. Se pago, `status = active` e `current_period_end = agora + período`.
7. Atualizar a sessão: `user_id`. Se pago, `status = linked`.
8. Responder `{ ok: true, subscription_id }`.

## Cliente

Guardar o token em `localStorage` (`{app}_checkout_token`).

```text
startCheckout(planSlug, payerEmail)
  POST create-checkout
  salvar checkout_token
  location = init_point

onReturn()
  ler ?checkout=
  salvar token
  limpar o query param da URL

linkAfterAuth()
  POST link-checkout com o JWT
  limpar o token
  reler subscriptions

pollAfterReturn()
  a cada 4s, até 8 vezes, chamar linkAfterAuth
  parar quando o acesso estiver liberado
```

Leitura da assinatura:

```text
subscriptions
  select status, current_period_end, plan
  where user_id = usuário atual
    and status in (pending, active, past_due)
  order by created_at desc
  limit 1
```

Acesso liberado:

```text
admin → sempre, se o app tiver esse papel
status active ou past_due
e current_period_end + tolerância > agora
tolerância = 3 dias só em past_due; 0 em active
```

A mesma regra no banco:

```sql
create or replace function public.is_subscription_active(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.status in ('active', 'past_due')
      and coalesce(s.current_period_end, now()) > now() - interval '3 days'
  );
$$;
```

Ajuste o intervalo se a ficha usar outra tolerância.

## Mapa de status

| Origem | Valor | No app |
|---|---|---|
| Checkout criado | — | sessão `pending`, assinatura `pending` |
| Pagamento | `approved` | sessão `paid`, assinatura `active`, fim = agora + período |
| Vínculo com sessão paga | — | sessão `linked`, `user_id` preenchido |
| Pagamento | `pending`, `in_process`, `rejected` | não altera o acesso |
| Fora do prazo | — | acesso falso na leitura |

Cada novo pagamento atualiza a assinatura aberta do usuário e redefine `current_period_end`.

## Checklist

- [ ] Plano inativo ou slug errado devolve 400 e não chama o Mercado Pago.
- [ ] Sem e-mail, o checkout não abre.
- [ ] `unit_price` na preference é o `price_brl` do banco.
- [ ] `external_reference` é o token da sessão.
- [ ] `init_point` abre o Checkout Pro.
- [ ] Webhook duplicado não estende o período duas vezes.
- [ ] Webhook com assinatura inválida devolve 401 e não ativa.
- [ ] Pagamento `approved` define `current_period_end` em agora + período.
- [ ] `link-checkout` com outra conta no mesmo `user_id` devolve 409.
- [ ] Usuário sem assinatura `active` não passa em `is_subscription_active`.
- [ ] Segundo pagamento do mesmo usuário atualiza a linha aberta.
