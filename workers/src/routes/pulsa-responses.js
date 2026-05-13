/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Pulsa Responses (collecte + notif mail)
   Sprint Pulsa-3.3

   Route PUBLIQUE (pas d'auth) appelée par form.html quand le
   répondant soumet ses réponses. Pipeline :

     1. Résolution du formulaire par slug (status='published')
     2. Validation basique du payload `responses`
     3. INSERT D1 dans pulsa_responses avec expires_at = now + ttl_days
     4. Envoi mail Resend aux destinataires direction du formulaire
        (best-effort : si Resend échoue, la réponse reste stockée)
     5. Retour { ok: true, response_id } au client

   Stratégie économe : pas de stockage de PII répondant (IP, UA,
   cookies). La donnée serveur est purgée automatiquement au bout
   de form.ttl_days via le cron quotidien.

   Route :
     POST /api/pulsa/responses/:slug
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin, generateId } from '../lib/auth.js';
import { sendEmail } from '../lib/email-resend.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS pulsa_responses (
      id            TEXT PRIMARY KEY,
      form_id       TEXT NOT NULL,
      slug          TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at    TEXT NOT NULL
    )
  `).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_pulsa_responses_form ON pulsa_responses(form_id, created_at DESC)'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_pulsa_responses_expires ON pulsa_responses(expires_at)'
  ).run().catch(() => {});
  _schemaReady = true;
}

// ═══════════════════════════════════════════════════════════════
// POST /api/pulsa/responses/:slug
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaSubmit(request, env, slug) {
  const origin = getAllowedOrigin(env, request);

  if (!slug || !SLUG_RE.test(slug)) {
    return err('Slug invalide', 400, origin);
  }
  await _ensureSchema(env);

  // 1. Résolution du formulaire publié
  const formRow = await env.DB.prepare(
    'SELECT * FROM pulsa_forms WHERE slug = ? AND status = ? LIMIT 1'
  ).bind(slug, 'published').first();
  if (!formRow) return err('Formulaire introuvable ou non publié', 404, origin);

  let config = {};
  try { config = JSON.parse(formRow.config_json || '{}'); } catch {}
  let recipients = [];
  try { recipients = JSON.parse(formRow.recipients_json || '[]'); } catch {}
  const ttlDays = formRow.ttl_days || 90;

  // 2. Validation du payload
  const body = await parseBody(request);
  const responses = body?.responses;
  if (!responses || typeof responses !== 'object') {
    return err('Champ "responses" requis (objet fieldId → valeur)', 400, origin);
  }

  // 3. INSERT D1 (le response_json est l'objet brut, le rendu humain
  // est fait par le mail template — pas besoin de doubler le stockage)
  const responseId = generateId();
  const expiresAt = _isoDaysFromNow(ttlDays);
  await env.DB.prepare(`
    INSERT INTO pulsa_responses (id, form_id, slug, response_json, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(responseId, formRow.id, slug, JSON.stringify(responses), expiresAt).run();

  // 4. Envoi mail (best-effort)
  let mailStatus = 'skipped';
  if (recipients.length > 0 && env.KS_RESEND_KEY) {
    try {
      const subject = `Nouvelle réponse — ${formRow.title || 'Pulsa'}`;
      const html = _renderResponseEmail({
        form: { ...config, slug, ttl_days: ttlDays },
        responses,
        responseId,
        receivedAt: new Date(),
      });
      await sendEmail(env, { to: recipients, subject, html });
      mailStatus = 'sent';
    } catch (e) {
      console.warn('[pulsa-responses] mail send failed', e?.message || e);
      mailStatus = 'failed';
    }
  }

  return json({
    ok: true,
    response_id: responseId,
    mail: mailStatus,
    expires_at: expiresAt,
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// Purge TTL (appelée par le cron quotidien)
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaPurge(env) {
  await _ensureSchema(env);
  const res = await env.DB.prepare(
    `DELETE FROM pulsa_responses WHERE expires_at < datetime('now')`
  ).run();
  return { deleted: res?.meta?.changes ?? 0 };
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function _isoDaysFromNow(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function _escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

/**
 * Convertit la valeur brute d'un champ en HTML humain lisible
 * dans l'email de notification.
 */
function _formatValue(field, raw) {
  if (raw == null || raw === '') return '<em style="color:#64748b">(vide)</em>';
  const opts = field.options || {};
  switch (field.type) {
    case 'text-short':
    case 'text-long':
      return _escapeHtml(raw).replace(/\n/g, '<br>');
    case 'email':
      return `<a href="mailto:${_escapeHtml(raw)}" style="color:#c9a96e">${_escapeHtml(raw)}</a>`;
    case 'website':
    case 'url-external':
      return `<a href="${_escapeHtml(raw)}" target="_blank" rel="noopener" style="color:#c9a96e;word-break:break-all">${_escapeHtml(raw)}</a>`;
    case 'chips': {
      const choice = (opts.choices || []).find(c => c.id === raw);
      return _escapeHtml(choice?.label || raw);
    }
    case 'cards': {
      const ids = Array.isArray(raw) ? raw : [];
      if (ids.length === 0) return '<em style="color:#64748b">(aucun)</em>';
      const labels = ids.map(id => {
        const c = (opts.choices || []).find(c => c.id === id);
        return _escapeHtml(c?.label || id);
      });
      return labels.join(' · ');
    }
    case 'yes-no':
      if (raw === 'yes') return _escapeHtml(opts.yes_label || 'Oui');
      if (raw === 'no')  return _escapeHtml(opts.no_label || 'Non');
      return _escapeHtml(raw);
    case 'rank-top3': {
      const arr = Array.isArray(raw) ? raw : [];
      const items = arr.map((v, i) => v ? `<li>${_escapeHtml(v)}</li>` : '').filter(Boolean);
      return items.length ? `<ol style="margin:0;padding-left:18px">${items.join('')}</ol>` : '<em style="color:#64748b">(vide)</em>';
    }
    case 'date': {
      try {
        return new Date(raw).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
      } catch { return _escapeHtml(raw); }
    }
    case 'amount': {
      const cur = opts.currency || 'EUR';
      try {
        return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, maximumFractionDigits: opts.decimals ?? 2 }).format(Number(raw));
      } catch { return _escapeHtml(raw) + ' ' + _escapeHtml(cur); }
    }
    case 'social-links': {
      const networks = (opts.networks || []).filter(n => n.enabled);
      const obj = (raw && typeof raw === 'object') ? raw : {};
      const lines = networks
        .map(n => {
          const v = obj[n.id];
          if (!v) return null;
          return `<div style="margin-bottom:4px"><strong style="color:#c9a96e;font-size:11px;letter-spacing:.06em;text-transform:uppercase">${_escapeHtml(n.label)}</strong> &nbsp; ${_escapeHtml(v)}</div>`;
        })
        .filter(Boolean);
      return lines.length ? lines.join('') : '<em style="color:#64748b">(aucun)</em>';
    }
    default:
      return _escapeHtml(typeof raw === 'object' ? JSON.stringify(raw) : raw);
  }
}

/**
 * Template HTML du mail de notification.
 * Charte sobre dark/navy/or, lisible sur Outlook, Apple Mail, Gmail.
 */
function _renderResponseEmail({ form, responses, responseId, receivedAt }) {
  const meta = form.meta || {};
  const sections = form.sections || [];
  const totalAnswered = Object.keys(responses).length;
  const receivedStr = receivedAt.toLocaleString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const sectionsHtml = sections.map(sec => {
    const fieldsHtml = (sec.fields || []).map(f => {
      const value = responses[f.id];
      const labelHtml = _escapeHtml(f.label || '(sans libellé)');
      const valueHtml = _formatValue(f, value);
      return `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #1f2a37;vertical-align:top">
            <div style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">
              ${labelHtml}
            </div>
            <div style="color:#f1f5f9;font-size:14px;line-height:1.55">
              ${valueHtml}
            </div>
          </td>
        </tr>
      `;
    }).join('');
    return `
      <tr><td style="padding:20px 0 8px 0">
        <div style="color:#c9a96e;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">
          ${_escapeHtml(sec.title || 'Section')}
        </div>
      </td></tr>
      <tr><td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${fieldsHtml}</table>
      </td></tr>
    `;
  }).join('');

  return `
  <!DOCTYPE html><html><head><meta charset="utf-8"/></head>
  <body style="margin:0;padding:0;background:#0a0e14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e14;padding:40px 16px">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#111720;border:1px solid #1f2a37;border-radius:12px;overflow:hidden">
          <tr><td style="padding:32px 36px 8px 36px">
            <div style="font-size:11px;letter-spacing:.18em;color:#c9a96e;text-transform:uppercase;font-weight:700;margin-bottom:8px">Keystone OS · Pulsa</div>
            <h1 style="margin:0 0 8px 0;color:#f1f5f9;font-size:22px;font-weight:700;letter-spacing:-.02em">
              Nouvelle réponse${meta.title ? ' — ' + _escapeHtml(meta.title) : ''}
            </h1>
            <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.5">
              Reçue le ${_escapeHtml(receivedStr)} · ${totalAnswered} champ${totalAnswered > 1 ? 's' : ''} renseigné${totalAnswered > 1 ? 's' : ''}
            </p>
          </td></tr>

          <tr><td style="padding:8px 36px 24px 36px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sectionsHtml}</table>
          </td></tr>

          <tr><td style="padding:0 36px 32px 36px">
            <div style="background:#0a0e14;border:1px solid #1f2a37;border-radius:8px;padding:16px 18px;font-size:12px;color:#64748b;line-height:1.6">
              <strong style="color:#94a3b8">Conservation</strong> &nbsp; Cette réponse est stockée pendant ${form.ttl_days || 90} jours, puis supprimée automatiquement (RGPD Art. 5).
              <br><strong style="color:#94a3b8">Identifiant</strong> &nbsp; <code style="color:#c9a96e">${_escapeHtml(responseId)}</code>
              <br><strong style="color:#94a3b8">URL du formulaire</strong> &nbsp; <code style="color:#c9a96e">/form?s=${_escapeHtml(form.slug || '')}</code>
            </div>
          </td></tr>
        </table>
        <div style="margin-top:20px;color:#475569;font-size:11px">
          Notification automatique · Protein Studio · Keystone OS · Pulsa
        </div>
      </td></tr>
    </table>
  </body></html>`;
}
