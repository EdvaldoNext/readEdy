---
name: mercadopago-checkout-pro
description: >-
  Implementa cobrança Mercado Pago com Checkout Pro (preference), pagamento
  único e acesso por período fixo. Use ao adicionar checkout, webhook,
  assinatura, plano pago, init_point ou Mercado Pago em qualquer aplicação.
  Não usar preapproval nem assinatura recorrente do Mercado Pago.
---

# Mercado Pago — Checkout Pro

Pagamento único. Cada aprovação libera acesso por um período (padrão: 30 dias). A confirmação vem do webhook ou da busca do pagamento na API. O retorno do browser não libera acesso.

Antes de escrever código, leia [reference.md](reference.md) e siga esse contrato. Adapte só a ficha do app (nome, URL, planos, período, tolerância).

## Ordem

1. Preencher a ficha em [reference.md](reference.md) com dados deste app.
2. Criar `plans`, `checkout_sessions`, `subscriptions`, `billing_events` e `is_subscription_active`.
3. Publicar três endpoints de servidor: `create-checkout`, `mercadopago-webhook`, `link-checkout`.
4. Guardar segredos só no servidor: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `APP_URL`.
5. No cliente: botão do plano chama o checkout, guarda o token, redireciona para `init_point`, e no retorno vincula a conta.
6. Travar rotas pagas no cliente e no banco com a mesma regra de acesso.
7. Rodar o checklist de [reference.md](reference.md).

## Regras

- O preço enviado ao Mercado Pago é `plans.price_brl` do slug ativo. O cliente não envia valor.
- `external_reference` é o UUID da sessão (`checkout_token`).
- A coluna que guarda o id da preference pode se chamar `preference_id`. Não criar preapproval.
- Escritas de sessão, assinatura e evento usam service role. O cliente autenticado só lê a própria assinatura.
- O webhook grava o evento antes de ativar. `mp_event_id` único: duplicata (`23505`) responde sucesso e para.
- Validar `x-signature` com HMAC-SHA256 do manifest oficial. Sem assinatura válida, responder 401 e não ativar.
- Decidir acesso só depois de `GET /v1/payments/{id}`. Seguir apenas com `status = approved`.
- Um usuário tem no máximo uma assinatura em `pending`, `active` ou `past_due`. Novo pagamento atualiza essa linha.
- `current_period_end` = agora + período do app. Não há cobrança automática no mês seguinte.
- `link-checkout` exige JWT. Se `user_id` já for de outra conta, responder 409.
- Webhook no painel do Mercado Pago: tópico `payment`, URL do endpoint `mercadopago-webhook`.

## Acesso liberado

Admin, se o app tiver esse papel, ignora a trava. Nos demais casos: status `active` ou `past_due`, e `current_period_end` mais a tolerância ainda no futuro. Tolerância só em `past_due` (padrão: 3 dias).
