-- Plano Premium passa a R$ 15,99. O checkout envia esse valor ao Mercado Pago.
update public.plans
set price_brl = 15.99
where slug = 'premium_monthly';
