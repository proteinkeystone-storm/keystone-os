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

export async function sendEmail(env, { to, subject, html, replyTo, bcc }) {
  if (!env.KS_RESEND_KEY) throw new Error('KS_RESEND_KEY manquant');
  const from = env.KS_RESEND_FROM || 'Keystone OS <onboarding@resend.dev>';

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
    throw new Error(`Resend ${res.status}: ${txt.slice(0, 200)}`);
  }
  return await res.json();
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
          Protein Studio · Pôle de promotion immobilière augmentée par l'IA
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
  const foot = footer || 'Protein Studio · Keystone OS — Pôle de promotion immobilière augmentée par l\'IA';
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

// ── Magic-link générique (activation initiale OU récupération) ──
// purpose : 'activation' | 'recovery' | 'magic_login'
// expiresMinutes : durée de validité du lien (default 15)
export function tplMagicLink({ ownerName, magicUrl, purpose = 'magic_login', expiresMinutes = 15 }) {
  const headers = {
    activation:   { title: `Bienvenue${ownerName ? ' ' + ownerName : ''} !`, intro: 'Cliquez sur le lien ci-dessous pour activer Keystone OS sur cet appareil. Ce lien est personnel et fonctionne une seule fois.', cta: 'Activer Keystone OS' },
    recovery:     { title: 'Récupération de votre accès',                     intro: 'Voici votre lien de récupération. Cliquez dessus depuis l\'appareil sur lequel vous voulez retrouver vos données. Aucune clé à saisir.', cta: 'Récupérer mon accès' },
    magic_login:  { title: 'Connexion à Keystone OS',                          intro: 'Cliquez pour vous connecter sans avoir à saisir votre clé. Ce lien est valable une seule fois et expire bientôt.', cta: 'Se connecter' },
  };
  const h = headers[purpose] || headers.magic_login;
  const body = `
    <p style="margin:0 0 16px 0;color:#94a3b8;font-size:15px;line-height:1.6">
      ${escapeHtml(h.intro)}
    </p>
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
