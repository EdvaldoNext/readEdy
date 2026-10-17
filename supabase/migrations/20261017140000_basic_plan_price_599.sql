-- Plano Básico passa a R$ 5,99. O checkout envia esse valor ao Mercado Pago.
update public.plans
set price_brl = 5.99
where slug = 'basic_monthly';
