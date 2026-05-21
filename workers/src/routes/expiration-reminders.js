/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Cron rappels expiration licence (Sprint S5.2)
   ═══════════════════════════════════════════════════════════════
   Appelé par le scheduled handler (cron quotidien 3h UTC). Cherche
   les licences qui expirent dans 7, 3 ou 1 jour(s) et envoie un
   email de rappel via tplLicenceExpiring (S3).

   Kill-switch dormant (defense in depth) :
   - env.KS_EXPIRATION_REMINDERS_ENABLED !== 'true'
     → on cherche, on calcule, on audit log « would_have_sent »
       MAIS on n'envoie AUCUN email. Permet de valider la sélection
       de licences ciblées avant d'activer pour de vrai.
   - env.KS_EXPIRATION_REMINDERS_ENABLED === 'true'
     → on envoie + on INSERT dans licence_reminder_log pour
       idempotence (1 envoi max par couple (licence, bucket)).

   Buckets (un email par licence et par bucket, jamais 2x le même) :
     - '7d' : licences qui expirent dans 4-7 jours
     - '3d' : licences qui expirent dans 2-3 jours
     - '1d' : licences qui expirent dans 0-1 jour

   Sécurité :
   - Idempotence stricte via PRIMARY KEY (licence_key, days_bucket).
   - JAMAIS de mail si pas d'expires_at, pas d'email valide, ou plan
     ADMIN/DEMO (= comptes internes, pas de notif commerciale).
   - Best-effort : un échec d'envoi pour une licence ne bloque pas
     les autres (try/catch par licence).
   ═══════════════════════════════════════════════════════════════ */

import { audit }                                from '../lib/audit.js';
import { sendEmail, tplLicenceExpiring }        from '../lib/email-resend.js';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// ── Auto-migration table idempotence ────────────────────────────
let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS licence_reminder_log (
        licence_key  TEXT NOT NULL,
        days_bucket  TEXT NOT NULL,
        sent_at      TEXT NOT NULL DEFAULT (datetime('now')),
        recipient    TEXT,
        PRIMARY KEY (licence_key, days_bucket)
      )
    `).run();
  } catch (_) { /* table déjà créée, ok */ }
  _schemaReady = true;
}

// ── Détermine le bucket en fonction du nombre de jours restants ─
function _bucketFor(daysLeft) {
  if (daysLeft <= 1) return '1d';
  if (daysLeft <= 3) return '3d';
  if (daysLeft <= 7) return '7d';
  return null;
}

// ── Récupère l'email destinataire pour une licence ──────────────
// Priorité : owner (s'il est un email valide) → 1er email actif
// dans licence_emails. Renvoie null si rien d'utilisable.
async function _resolveRecipient(env, licence) {
  const owner = (licence.owner || '').toString().trim().toLowerCase();
  if (owner && EMAIL_RE.test(owner)) return owner;

  try {
    const row = await env.DB
      .prepare(`
        SELECT email FROM licence_emails
         WHERE licence_key = ? AND status = 'active'
         ORDER BY role = 'owner' DESC, activated_at ASC
         LIMIT 1
      `)
      .bind(licence.key)
      .first();
    if (row?.email && EMAIL_RE.test(row.email)) return row.email;
  } catch (_) { /* table licence_emails absente sur certains envs — silent */ }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// handleExpirationReminders — appelé par le scheduled handler
// ───────────────────────────────────────────────────────────────
// Retourne un résumé pour logging :
//   { enabled, scanned, eligible, sent, would_have_sent, skipped, errors }
// ═══════════════════════════════════════════════════════════════
export async function handleExpirationReminders(env) {
  await _ensureSchema(env);

  const enabled = (env.KS_EXPIRATION_REMINDERS_ENABLED || '').toLowerCase() === 'true';
  const renewUrl = env.KS_RENEW_URL || null;

  // Cherche les licences actives, non-ADMIN/DEMO, avec expires_at <= now + 7 jours.
  // On exclut les licences déjà expirées (les rappels n'ont plus de sens).
  const { results: candidates = [] } = await env.DB
    .prepare(`
      SELECT key, owner, plan, expires_at, tenant_id
        FROM licences
       WHERE is_active = 1
         AND expires_at IS NOT NULL
         AND datetime(expires_at) > datetime('now')
         AND datetime(expires_at) <= datetime('now', '+7 days')
         AND UPPER(COALESCE(plan, '')) NOT IN ('ADMIN', 'DEMO')
       LIMIT 500
    `)
    .all();

  const summary = {
    enabled,
    scanned:         candidates.length,
    eligible:        0,
    sent:            0,
    would_have_sent: 0,
    skipped:         0,
    errors:          0,
  };

  const now = Date.now();

  for (const licence of candidates) {
    try {
      const expiresMs = new Date(licence.expires_at).getTime();
      if (isNaN(expiresMs)) { summary.skipped++; continue; }

      const daysLeft = Math.ceil((expiresMs - now) / (24 * 60 * 60 * 1000));
      const bucket = _bucketFor(daysLeft);
      if (!bucket) { summary.skipped++; continue; }
      summary.eligible++;

      // Idempotence : si déjà envoyé pour ce bucket → skip
      const already = await env.DB
        .prepare('SELECT 1 AS n FROM licence_reminder_log WHERE licence_key = ? AND days_bucket = ? LIMIT 1')
        .bind(licence.key, bucket)
        .first();
      if (already) { summary.skipped++; continue; }

      const recipient = await _resolveRecipient(env, licence);
      if (!recipient) { summary.skipped++; continue; }

      if (!enabled) {
        // Mode dormant : audit only, pas d'envoi, pas d'INSERT.
        // L'absence d'INSERT permet de re-essayer dès que kill-switch ON.
        await audit(env, {
          action:   'expiration_reminder_would_send',
          actor:    'cron',
          target:   licence.key,
          tenantId: licence.tenant_id || null,
          details:  { recipient, bucket, daysLeft, plan: licence.plan, expires_at: licence.expires_at },
        });
        summary.would_have_sent++;
        continue;
      }

      // Mode actif : envoie l'email puis INSERT pour idempotence.
      try {
        const html = tplLicenceExpiring({
          daysLeft,
          expiresAt: licence.expires_at,
          renewUrl,
        });
        await sendEmail(env, {
          to:      recipient,
          subject: daysLeft <= 1
            ? `⚠️ Votre abonnement Keystone OS expire demain`
            : `Votre abonnement Keystone OS expire dans ${daysLeft} jours`,
          html,
        });

        await env.DB.prepare(`
          INSERT INTO licence_reminder_log (licence_key, days_bucket, sent_at, recipient)
          VALUES (?, ?, datetime('now'), ?)
        `).bind(licence.key, bucket, recipient).run();

        await audit(env, {
          action:   'expiration_reminder_sent',
          actor:    'cron',
          target:   licence.key,
          tenantId: licence.tenant_id || null,
          details:  { recipient, bucket, daysLeft, plan: licence.plan },
        });
        summary.sent++;
      } catch (e) {
        await audit(env, {
          action:   'expiration_reminder_failed',
          actor:    'cron',
          target:   licence.key,
          tenantId: licence.tenant_id || null,
          details:  { recipient, bucket, daysLeft, error: e?.message?.slice(0, 200) },
        });
        summary.errors++;
      }
    } catch (e) {
      console.warn('[expiration-reminders] per-licence error', licence.key, e?.message);
      summary.errors++;
    }
  }

  return summary;
}
