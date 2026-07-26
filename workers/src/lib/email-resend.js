/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Email transactionnel via Resend
   ─────────────────────────────────────────────────────────────
   Endpoint  : POST https://api.resend.com/emails
   Auth      : Bearer ${KS_RESEND_KEY}
   FROM      : KS_RESEND_FROM (default: onboarding@resend.dev)
                — déjà vérifié par Resend, fonctionne immédiatement.
                — pour un domaine custom (noreply@xxxx.com),
                  vérifier le domaine sur Resend (4 records DNS).
   ═══════════════════════════════════════════════════════════════ */

const RESEND_URL = 'https://api.resend.com/emails';

// AUTH-5 — journal des envois : pouvoir répondre à « je n'ai rien
// reçu » sans deviner. Best-effort : un échec de log ne casse JAMAIS
// l'envoi (et inversement, un échec d'envoi EST loggé).
let _emailLogReady = false;
async function _logEmail(env, { to, subject, status, provider_id, error }) {
  try {
    if (!env.DB) return;
    if (!_emailLogReady) {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS email_log (
          id          TEXT PRIMARY KEY,
          recipient   TEXT NOT NULL,
          subject     TEXT,
          status      TEXT NOT NULL,
          provider_id TEXT,
          error       TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run().catch(() => {});
      await env.DB.prepare(
        'CREATE INDEX IF NOT EXISTS idx_email_log_recipient ON email_log(recipient, created_at)'
      ).run().catch(() => {});
      _emailLogReady = true;
    }
    await env.DB.prepare(
      'INSERT INTO email_log (id, recipient, subject, status, provider_id, error) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(),
      Array.isArray(to) ? to.join(',') : String(to || ''),
      (subject || '').slice(0, 200),
      status,
      provider_id || null,
      (error || '').slice(0, 300) || null,
    ).run();
  } catch (_) { /* best-effort */ }
}

// ── AUTH-5 — dispatch fournisseur ──────────────────────────────
// KS_EMAIL_PROVIDER = 'resend' (défaut) | 'scaleway'
// Bascule SANS redéploiement : c'est une var d'environnement.
// Scaleway TEM = souveraineté UE (décision du 26/07/2026, cf.
// HANDOFF_AUTH_DURCISSEMENT.md) — actif seulement quand le domaine
// expéditeur est validé chez Scaleway et les secrets posés.
export async function sendEmail(env, opts) {
  const provider = (env.KS_EMAIL_PROVIDER || 'resend').toLowerCase();
  return provider === 'scaleway'
    ? _sendScaleway(env, opts)
    : _sendResend(env, opts);
}

// 'Keystone OS <auth@mail.x.com>' → { name: 'Keystone OS', email: 'auth@mail.x.com' }
function _parseFrom(raw) {
  const m = /^(.*?)\s*<([^>]+)>$/.exec((raw || '').trim());
  if (m) return { name: m[1].trim() || 'Keystone OS', email: m[2].trim() };
  return { name: 'Keystone OS', email: (raw || '').trim() };
}

// Texte brut minimal dérivé du HTML (TEM exige un champ text)
function _htmlToText(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000) || ' ';
}

async function _sendResend(env, { to, subject, html, replyTo, bcc }) {
  if (!env.KS_RESEND_KEY) throw new Error('KS_RESEND_KEY manquant');
  const from = env.KS_EMAIL_FROM || env.KS_RESEND_FROM || 'Keystone OS <onboarding@resend.dev>';

  const body = { from, to: Array.isArray(to) ? to : [to], subject, html };
  if (replyTo) body.reply_to = replyTo;
  if (bcc)     body.bcc      = Array.isArray(bcc) ? bcc : [bcc];

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.KS_RESEND_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    await _logEmail(env, { to, subject, status: 'failed', error: `Resend ${res.status}: ${txt.slice(0, 200)}` });
    throw new Error(`Resend ${res.status}: ${txt.slice(0, 200)}`);
  }
  const out = await res.json();
  await _logEmail(env, { to, subject, status: 'sent', provider_id: out?.id });
  return out;
}

// ── Scaleway TEM (fr-par) ──────────────────────────────────────
// POST https://api.scaleway.com/transactional-email/v1alpha1/regions/{r}/emails
// Auth : X-Auth-Token (clé secrète IAM). Secrets requis :
//   KS_SCW_SECRET_KEY (wrangler secret) · KS_SCW_PROJECT_ID (var)
//   KS_EMAIL_FROM = 'Keystone OS <auth@mail.protein-keystone.com>'
async function _sendScaleway(env, { to, subject, html, replyTo, bcc }) {
  if (!env.KS_SCW_SECRET_KEY) throw new Error('KS_SCW_SECRET_KEY manquant');
  if (!env.KS_SCW_PROJECT_ID) throw new Error('KS_SCW_PROJECT_ID manquant');
  const region = env.KS_SCW_REGION || 'fr-par';
  const from = _parseFrom(env.KS_EMAIL_FROM || env.KS_RESEND_FROM);
  if (!from.email) throw new Error('KS_EMAIL_FROM manquant');

  const url = `https://api.scaleway.com/transactional-email/v1alpha1/regions/${region}/emails`;
  const recipients = (Array.isArray(to) ? to : [to]).map(e => ({ email: e }));
  const body = {
    from,
    to: recipients,
    subject,
    html,
    text: _htmlToText(html),
    project_id: env.KS_SCW_PROJECT_ID,
  };
  if (replyTo) body.additional_headers = [{ key: 'Reply-To', value: replyTo }];

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Auth-Token': env.KS_SCW_SECRET_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    await _logEmail(env, { to, subject, status: 'failed', error: `Scaleway ${res.status}: ${txt.slice(0, 200)}` });
    throw new Error(`Scaleway ${res.status}: ${txt.slice(0, 200)}`);
  }
  const out = await res.json();
  const id = out?.emails?.[0]?.message_id || out?.emails?.[0]?.id || null;
  await _logEmail(env, { to, subject, status: 'sent', provider_id: id ? `scw:${id}` : 'scw' });

  // BCC : TEM v1alpha1 n'a pas de champ bcc → copie séparée, best-effort
  // (l'échec de la copie ne casse pas l'envoi principal).
  if (bcc) {
    const bccList = Array.isArray(bcc) ? bcc : [bcc];
    for (const b of bccList) {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'X-Auth-Token': env.KS_SCW_SECRET_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, to: [{ email: b }] }),
        });
      } catch (_) { /* best-effort */ }
    }
  }

  return { id: id ? `scw:${id}` : 'scw', provider: 'scaleway' };
}

// ── Template HTML : livraison de la clé après paiement ────────
export function tplWelcomeKey({ ownerName, plan, key, activateUrl }) {
  const PLAN_LABEL = { STARTER: 'Starter', PRO: 'Pro', MAX: 'Max' }[plan] || plan;
  return `
  <!DOCTYPE html><html><head><meta charset="utf-8"/></head>
  <body style="margin:0;padding:0;background:#0a0e14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e14;padding:40px 16px">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111720;border:1px solid #1f2a37;border-radius:12px;overflow:hidden">
          <tr><td style="padding:40px 40px 24px 40px">
            <div style="font-size:14px;letter-spacing:2px;color:#c9a96e;text-transform:uppercase;margin-bottom:8px">Keystone OS</div>
            <h1 style="margin:0 0 16px 0;color:#f1f5f9;font-size:24px;font-weight:600">Bienvenue${ownerName ? ' ' + escapeHtml(ownerName) : ''} !</h1>
            <p style="margin:0 0 24px 0;color:#94a3b8;font-size:15px;line-height:1.6">
              Votre abonnement <strong style="color:#c9a96e">${PLAN_LABEL}</strong> est actif. Voici votre clé d'activation personnelle :
            </p>
            <div style="background:#0a0e14;border:1px solid #c9a96e;border-radius:8px;padding:20px;text-align:center;margin:0 0 24px 0">
              <div style="font-family:'SF Mono','Courier New',monospace;font-size:22px;letter-spacing:2px;color:#c9a96e;font-weight:600">${escapeHtml(key)}</div>
            </div>
            <p style="margin:0 0 24px 0;color:#94a3b8;font-size:14px;line-height:1.6">
              <strong style="color:#f1f5f9">Important :</strong> votre clé est liée au premier appareil sur lequel vous l'activez (sécurité anti-fraude). Activez-la donc sur l'appareil que vous utiliserez le plus.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td>
              <a href="${activateUrl}" style="display:inline-block;background:#c9a96e;color:#0a0e14;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px">Activer Keystone OS</a>
            </td></tr></table>
            <p style="margin:32px 0 0 0;color:#64748b;font-size:13px;line-height:1.6;border-top:1px solid #1f2a37;padding-top:24px">
              Tu peux te désabonner à tout moment depuis ton compte Stripe — sans engagement, sans frais.
              Question ? Réponds simplement à cet email.
            </p>
          </td></tr>
        </table>
        <div style="margin-top:24px;color:#475569;font-size:12px">
          Protein Studio · Keystone OS — Suite d'applications métiers augmentée par l'IA
        </div>
      </td></tr>
    </table>
  </body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ═══════════════════════════════════════════════════════════════
// Templates Sprint S3 — Email + magic-link
// ───────────────────────────────────────────────────────────────
// Tous les templates partagent le wrapper Apple Premium (font-stack
// native, fond #0a0e14, accent #c9a96e). Cohérence visuelle avec
// tplWelcomeKey + l'UI Keystone OS.
// ═══════════════════════════════════════════════════════════════

// Wrapper commun : { title, body, ctaLabel?, ctaUrl?, footer? }
function _emailShell({ title, body, ctaLabel, ctaUrl, footer }) {
  const cta = ctaLabel && ctaUrl ? `
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 0 24px 0"><tr><td>
      <a href="${ctaUrl}" style="display:inline-block;background:#c9a96e;color:#0a0e14;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px">${escapeHtml(ctaLabel)}</a>
    </td></tr></table>` : '';
  const foot = footer || 'Protein Studio · Keystone OS — Suite d\'applications métiers augmentée par l\'IA';
  return `
  <!DOCTYPE html><html><head><meta charset="utf-8"/></head>
  <body style="margin:0;padding:0;background:#0a0e14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e14;padding:40px 16px">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111720;border:1px solid #1f2a37;border-radius:12px;overflow:hidden">
          <tr><td style="padding:40px 40px 24px 40px">
            <div style="font-size:14px;letter-spacing:2px;color:#c9a96e;text-transform:uppercase;margin-bottom:8px">Keystone OS</div>
            <h1 style="margin:0 0 16px 0;color:#f1f5f9;font-size:24px;font-weight:600">${escapeHtml(title)}</h1>
            ${body}
            ${cta}
            <p style="margin:32px 0 0 0;color:#64748b;font-size:13px;line-height:1.6;border-top:1px solid #1f2a37;padding-top:24px">
              ${foot}
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

// ── Livraison de la clé du palier GRATUIT ─────────────────────
// Template DISTINCT de tplWelcomeKey, qui est celui de l'après-paiement :
// il parle d'« abonnement » et renvoie vers « ton compte Stripe » pour se
// désabonner. Un utilisateur gratuit n'a NI abonnement NI client Stripe —
// lui envoyer ça serait lui affirmer deux choses fausses.
//
// Le rappel sur le lien d'appareil est conservé : la clé se lie à la
// première empreinte qui l'active, et se faire refuser plus tard sans
// comprendre pourquoi est le scénario de support le plus probable.
export function tplFreeKey({ ownerName, key, activateUrl }) {
  const body = `
    <p style="margin:0 0 24px 0;color:#94a3b8;font-size:15px;line-height:1.6">
      Votre accès <strong style="color:#c9a96e">gratuit</strong> est ouvert : Missive, booK et Keynapse,
      sans carte bancaire et sans limite de durée. Voici votre clé :
    </p>
    <div style="background:#0a0e14;border:1px solid #c9a96e;border-radius:8px;padding:20px;text-align:center;margin:0 0 24px 0">
      <div style="font-family:'SF Mono','Courier New',monospace;font-size:22px;letter-spacing:2px;color:#c9a96e;font-weight:600">${escapeHtml(key)}</div>
    </div>
    <p style="margin:0 0 24px 0;color:#94a3b8;font-size:14px;line-height:1.6">
      <strong style="color:#f1f5f9">À savoir :</strong> votre clé se lie au premier appareil sur lequel
      vous l'activez. Gardez cet e-mail — c'est lui qui vous permettra de la retrouver.
    </p>`;
  return _emailShell({
    title: `Bienvenue${ownerName ? ' ' + escapeHtml(ownerName) : ''} !`,
    body,
    ctaLabel: 'Ouvrir Keystone OS',
    ctaUrl:   activateUrl,
    footer:   'Vous pourrez ajouter une application payante plus tard, à l\'unité — rien ne se déclenche tout seul. '
            + 'Une question ? Répondez simplement à cet e-mail.',
  });
}

// ── Magic-link générique (activation initiale OU récupération) ──
// purpose : 'activation' | 'recovery' | 'magic_login'
// expiresMinutes : durée de validité du lien (default 15)
// otpCode : code 6 chiffres (AUTH-2) — chemin cross-device et repli
//   quand la protection email d'entreprise a neutralisé le lien.
export function tplMagicLink({ ownerName, magicUrl, otpCode = null, purpose = 'magic_login', expiresMinutes = 15 }) {
  const headers = {
    activation:   { title: `Bienvenue${ownerName ? ' ' + ownerName : ''} !`, intro: 'Cliquez sur le lien ci-dessous pour activer Keystone OS sur cet appareil. Ce lien est personnel et fonctionne une seule fois.', cta: 'Activer Keystone OS' },
    recovery:     { title: 'Récupération de votre accès',                     intro: 'Voici votre lien de récupération. Cliquez dessus depuis l\'appareil sur lequel vous voulez retrouver vos données. Aucune clé à saisir.', cta: 'Récupérer mon accès' },
    magic_login:  { title: 'Connexion à Keystone OS',                          intro: 'Cliquez pour vous connecter sans avoir à saisir votre clé. Ce lien est valable une seule fois et expire bientôt.', cta: 'Se connecter' },
  };
  const h = headers[purpose] || headers.magic_login;
  const otpBlock = otpCode ? `
    <p style="margin:0 0 8px 0;color:#94a3b8;font-size:14px;line-height:1.6">
      Sur un autre appareil, ou si le bouton ne fonctionne pas (protections email d'entreprise) :
      saisissez ce code sur la page de connexion.
    </p>
    <div style="background:#0a0e14;border:1px solid #c9a96e;border-radius:8px;padding:16px;text-align:center;margin:0 0 24px 0">
      <div style="font-family:'SF Mono','Courier New',monospace;font-size:28px;letter-spacing:8px;color:#c9a96e;font-weight:600">${escapeHtml(otpCode)}</div>
    </div>` : '';
  const body = `
    <p style="margin:0 0 16px 0;color:#94a3b8;font-size:15px;line-height:1.6">
      ${escapeHtml(h.intro)}
    </p>
    ${otpBlock}
    <p style="margin:0 0 24px 0;color:#94a3b8;font-size:14px;line-height:1.6">
      <strong style="color:#f1f5f9">Expire dans ${expiresMinutes} minutes.</strong> Si vous n'avez pas demandé ce lien, ignorez cet email — votre compte reste protégé.
    </p>`;
  return _emailShell({
    title: h.title,
    body,
    ctaLabel: h.cta,
    ctaUrl: magicUrl,
  });
}

// ── Invitation membre (plan MAX) ──────────────────────────────
// L'owner de la licence MAX invite un collègue (même domaine email).
export function tplInviteMember({ ownerEmail, ownerName, magicUrl, expiresHours = 168 }) {
  const inviter = ownerName ? `${escapeHtml(ownerName)} (${escapeHtml(ownerEmail)})` : escapeHtml(ownerEmail);
  const body = `
    <p style="margin:0 0 16px 0;color:#94a3b8;font-size:15px;line-height:1.6">
      <strong style="color:#f1f5f9">${inviter}</strong> vous invite à rejoindre son équipe Keystone OS (plan <strong style="color:#c9a96e">Max</strong>).
    </p>
    <p style="margin:0 0 16px 0;color:#94a3b8;font-size:14px;line-height:1.6">
      En cliquant sur le bouton ci-dessous, vous activez votre accès personnel. Vous aurez votre propre espace de travail (formulaires, briefs, QR codes) — séparé de celui des autres membres.
    </p>
    <p style="margin:0 0 24px 0;color:#94a3b8;font-size:13px;line-height:1.6">
      Cette invitation expire dans ${expiresHours} heure${expiresHours > 1 ? 's' : ''}.
    </p>`;
  return _emailShell({
    title: 'Vous êtes invité',
    body,
    ctaLabel: 'Accepter l\'invitation',
    ctaUrl: magicUrl,
  });
}

// ── Notification : nouveau device ajouté à votre licence ──────
export function tplDeviceAdded({ deviceLabel, addedAt, revokeUrl }) {
  const body = `
    <p style="margin:0 0 16px 0;color:#94a3b8;font-size:15px;line-height:1.6">
      Un nouvel appareil a été ajouté à votre compte Keystone OS&nbsp;:
    </p>
    <div style="background:#0a0e14;border:1px solid #1f2a37;border-radius:8px;padding:16px 20px;margin:0 0 24px 0">
      <div style="color:#f1f5f9;font-size:15px;font-weight:600;margin-bottom:4px">${escapeHtml(deviceLabel)}</div>
      <div style="color:#64748b;font-size:13px">Ajouté le ${escapeHtml(addedAt)}</div>
    </div>
    <p style="margin:0 0 24px 0;color:#94a3b8;font-size:14px;line-height:1.6">
      Si vous êtes à l'origine de cette activation, rien à faire. Sinon, vous pouvez révoquer cet appareil en un clic&nbsp;:
    </p>`;
  return _emailShell({
    title: 'Nouvel appareil activé',
    body,
    ctaLabel: revokeUrl ? 'Révoquer cet appareil' : null,
    ctaUrl:   revokeUrl || null,
    footer:   'Notification automatique — vous pouvez configurer cette alerte depuis Settings → Notifications.',
  });
}

// ── Licence qui expire bientôt ────────────────────────────────
export function tplLicenceExpiring({ daysLeft, expiresAt, renewUrl }) {
  const body = `
    <p style="margin:0 0 16px 0;color:#94a3b8;font-size:15px;line-height:1.6">
      Votre abonnement Keystone OS expire le <strong style="color:#f1f5f9">${escapeHtml(expiresAt)}</strong> (dans <strong style="color:#c9a96e">${daysLeft} jour${daysLeft > 1 ? 's' : ''}</strong>).
    </p>
    <p style="margin:0 0 24px 0;color:#94a3b8;font-size:14px;line-height:1.6">
      Pour éviter toute interruption d'accès à vos formulaires, briefs et QR codes, renouvelez dès maintenant.
    </p>`;
  return _emailShell({
    title: 'Votre abonnement expire bientôt',
    body,
    ctaLabel: renewUrl ? 'Renouveler maintenant' : null,
    ctaUrl:   renewUrl || null,
  });
}
