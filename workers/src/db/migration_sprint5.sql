-- ════════════════════════════════════════════════════════════════
-- Sprint 5 — Stripe subscriptions automation
-- ════════════════════════════════════════════════════════════════
-- Lie chaque licence à son abonnement Stripe pour :
-- - Identifier la licence à mettre à jour lors d'événements webhook
-- - Suspendre / réactiver selon paiement / annulation
-- - Conserver l'email du client pour relances éventuelles
-- ════════════════════════════════════════════════════════════════

ALTER TABLE licences ADD COLUMN stripe_customer_id     TEXT;
ALTER TABLE licences ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE licences ADD COLUMN customer_email         TEXT;

CREATE INDEX IF NOT EXISTS idx_licences_stripe_sub  ON licences(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_licences_stripe_cust ON licences(stripe_customer_id);

-- Idempotence des webhooks Stripe : on enregistre chaque event reçu
-- pour éviter de retraiter un même paiement deux fois (Stripe fait
-- des retries en cas d'erreur 5xx).
CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT PRIMARY KEY,            -- evt_xxxxx
  type        TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  status      TEXT NOT NULL DEFAULT 'processed'
);
