/* ═══════════════════════════════════════════════════════════════
   AUTH-5 — dispatch fournisseur email (Resend | Scaleway TEM)
   Test unitaire pur (fetch stubbé, aucun serveur requis) :
     node test/test-email-provider.mjs
   Prouve : (1) défaut = Resend (rien ne change pour l'existant),
   (2) KS_EMAIL_PROVIDER=scaleway → API TEM fr-par, X-Auth-Token,
   payload {from décomposé, to[], project_id, text dérivé du html},
   (3) secrets manquants → erreur claire AVANT tout appel réseau,
   (4) échec HTTP TEM → throw avec le détail.
   ═══════════════════════════════════════════════════════════════ */

import { sendEmail } from '../src/lib/email-resend.js';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}

const calls = [];
function stubFetch(status = 200, json = {}) {
  calls.length = 0;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts: { ...opts, body: JSON.parse(opts.body) } });
    return {
      ok: status < 400,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    };
  };
}

const MAIL = { to: 'client@entreprise.fr', subject: 'Test', html: '<p>Bonjour <b>monde</b></p>', replyTo: 'sav@x.fr' };

async function main() {
  console.log('AUTH-5 — dispatch fournisseur email\n');

  // (1) Défaut = Resend
  stubFetch(200, { id: 're_123' });
  const r = await sendEmail({ KS_RESEND_KEY: 'k' }, MAIL);
  ok(calls[0]?.url.includes('api.resend.com'), 'sans KS_EMAIL_PROVIDER → Resend', calls[0]?.url);
  ok(calls[0]?.opts.headers['Authorization'] === 'Bearer k', 'auth Bearer Resend');
  ok(r?.id === 're_123', 'id Resend retourné');

  // (2) scaleway → API TEM
  stubFetch(200, { emails: [{ message_id: 'scw_456' }] });
  const env = {
    KS_EMAIL_PROVIDER: 'scaleway',
    KS_SCW_SECRET_KEY: 'scw-secret',
    KS_SCW_PROJECT_ID: 'proj-1',
    KS_EMAIL_FROM: 'Keystone OS <auth@mail.protein-keystone.com>',
  };
  const s = await sendEmail(env, MAIL);
  const c = calls[0];
  ok(c?.url === 'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails',
    'URL TEM fr-par', c?.url);
  ok(c?.opts.headers['X-Auth-Token'] === 'scw-secret', 'auth X-Auth-Token');
  ok(c?.opts.body.from?.email === 'auth@mail.protein-keystone.com'
    && c?.opts.body.from?.name === 'Keystone OS', 'from décomposé name/email', c?.opts.body.from);
  ok(Array.isArray(c?.opts.body.to) && c?.opts.body.to[0]?.email === MAIL.to, 'to[] objets', c?.opts.body.to);
  ok(c?.opts.body.project_id === 'proj-1', 'project_id présent');
  ok(c?.opts.body.text === 'Bonjour monde', 'text dérivé du html', c?.opts.body.text);
  ok(c?.opts.body.additional_headers?.[0]?.value === 'sav@x.fr', 'Reply-To en additional_headers');
  ok(s?.id === 'scw:scw_456' && s?.provider === 'scaleway', 'id normalisé scw:', s);

  // (3) secrets manquants → erreur AVANT réseau
  stubFetch(200, {});
  let threw = null;
  try { await sendEmail({ KS_EMAIL_PROVIDER: 'scaleway' }, MAIL); } catch (e) { threw = e.message; }
  ok(threw === 'KS_SCW_SECRET_KEY manquant' && calls.length === 0, 'secret manquant → throw, zéro appel réseau', { threw, calls: calls.length });

  // (4) échec HTTP TEM → throw détaillé
  stubFetch(403, { message: 'denied' });
  threw = null;
  try { await sendEmail(env, MAIL); } catch (e) { threw = e.message; }
  ok(/^Scaleway 403/.test(threw || ''), 'erreur TEM remontée avec statut', threw);

  console.log(`\n═══ ${pass} ✓ · ${fail} ✗ ═══`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
