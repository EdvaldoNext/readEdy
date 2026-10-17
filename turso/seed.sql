-- Dados iniciais do Turso. Não copia usuários, PDFs nem pagamentos do Supabase.
-- is_secret = 1: o valor é o nome da variável de ambiente, nunca o segredo.

INSERT INTO plans (id, slug, name, price_brl, billing_interval, storage_mb, max_pdfs, active)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'trial', 'Trial 30 dias', 0, 'month', 512, NULL, 0),
  ('22222222-2222-4222-8222-222222222222', 'pro_monthly', 'ReadEdy Pro Mensal', 19.90, 'month', 5120, NULL, 0),
  ('33333333-3333-4333-8333-333333333333', 'pro_annual', 'ReadEdy Pro Anual', 199.00, 'year', 5120, NULL, 0),
  ('44444444-4444-4444-8444-444444444444', 'basic_monthly', 'ReadEdy Básico', 5.99, 'month', 45, 3, 1),
  ('55555555-5555-4555-8555-555555555555', 'premium_monthly', 'ReadEdy Premium', 15.99, 'month', 120, 10, 1);

INSERT INTO auth_settings (key, value, is_secret)
VALUES
  ('enabled', 'true', 0),
  ('signup_enabled', 'true', 0),
  ('anonymous_sign_ins', 'false', 0),
  ('password_min_length', '6', 0),
  ('email_password_enabled', 'true', 0),
  ('email_magic_link_enabled', 'true', 0),
  ('email_confirmations', 'false', 0),
  ('email_double_confirm_changes', 'true', 0),
  ('email_otp_length', '6', 0),
  ('email_otp_expiry_seconds', '3600', 0),
  ('google_enabled', 'true', 0),
  ('google_client_id_env', 'GOOGLE_OAUTH_CLIENT_ID', 1),
  ('google_client_secret_env', 'GOOGLE_OAUTH_CLIENT_SECRET', 1),
  ('jwt_expiry_seconds', '3600', 0),
  ('refresh_token_rotation', 'true', 0),
  ('admin_role_claim', 'app_metadata.role', 0),
  ('admin_role_value', 'admin', 0),
  ('recovery_redirect_query', 'tab=conta', 0),
  ('post_login_links_checkout', 'true', 0),
  ('app_url_env', 'READEDY_APP_URL', 1),
  ('wired_into_app', 'false', 0);

INSERT INTO billing_settings (key, value, is_secret)
VALUES
  ('provider', 'mercadopago', 0),
  ('currency', 'BRL', 0),
  ('checkout_mode', 'preferences', 0),
  ('api_base', 'https://api.mercadopago.com', 0),
  ('access_token_env', 'MERCADOPAGO_ACCESS_TOKEN', 1),
  ('webhook_secret_env', 'MERCADOPAGO_WEBHOOK_SECRET', 1),
  ('app_url_env', 'READEDY_APP_URL', 1),
  ('statement_descriptor', 'READEDY', 0),
  ('auto_return', 'approved', 0),
  ('installments', '1', 0),
  ('access_period', '1 month', 0),
  ('past_due_grace_days', '3', 0),
  ('back_url_template', '{app_url}/?checkout={token}&tab=conta', 0),
  ('notification_topics', 'payment,subscription_preapproval,subscription_authorized_payment', 0),
  ('item_title_template', 'ReadEdy — {plan_name} (30 dias)', 0),
  ('item_description', 'Acesso à nuvem, TTS e OCR por 30 dias', 0),
  ('external_reference', 'checkout_token', 0),
  ('webhook_signature_header', 'x-signature', 0),
  ('status_map', '{"authorized":"active","paused":"past_due","cancelled":"canceled","pending":"pending"}', 0),
  ('payment_approved_sets_status', 'active', 0),
  ('active_plan_slugs', 'basic_monthly,premium_monthly', 0),
  ('wired_into_app', 'false', 0);
