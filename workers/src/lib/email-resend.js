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
