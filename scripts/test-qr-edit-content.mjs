// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Tests : ÉDITION du contenu d'une expérience Smart
// ───────────────────────────────────────────────────────────────────
// PATCH /api/qr/:id acceptait template_data pour le SEUL Concierge : les
// autres modèles (QR Ring, carte de visite, réseaux, jeux…) voyaient leur
// contenu ignoré en silence — une faute de frappe imposait de supprimer le
// QR et donc de RÉIMPRIMER le support. Ce banc verrouille le nouveau
// comportement ET ce qui ne doit surtout PAS bouger (short_id, scans).
//
// Appel DIRECT du handler (jamais de self-HTTP : un Worker qui fetch sa
// propre URL renvoie 404 et fabrique de faux verts). D1 est simulé.
// Exit 0 si tout PASS, 1 sinon.
// ══════════════════════════════════════════════════════════════════

import { handleUpdateQr } from '../workers/src/routes/qr.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) { if (cond) pass++; else { fail++; fails.push(label); } }

const ADMIN = 'secret-de-banc';

// ── D1 simulé : une seule entité, on observe ce qui est réécrit ──────
function makeEnv(entity) {
  const state = { entity: JSON.parse(JSON.stringify(entity)), writes: [], redirectWrites: 0 };
  const db = {
    prepare(sql) {
      const q = { sql, args: [] };
      q.bind = (...a) => { q.args = a; return q; };
      q.first = async () => {
        if (/FROM entities/i.test(sql)) return { data: JSON.stringify(state.entity) };
        return null;
      };
      q.run = async () => {
        if (/UPDATE entities/i.test(sql)) {
          const blob = q.args.find(a => typeof a === 'string' && a.trim().startsWith('{'));
          if (blob) { state.writes.push(JSON.parse(blob)); state.entity = JSON.parse(blob); }
        }
        if (/qr_redirects/i.test(sql)) state.redirectWrites++;
        return { success: true };
      };
      q.all = async () => ({ results: [] });
      return q;
    },
  };
  return { env: { DB: db, KS_ADMIN_SECRET: ADMIN, KS_ALLOWED_ORIGIN: 'https://protein-keystone.com' }, state };
}

function req(body) {
  return new Request('https://x/api/qr/qr-1', {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${ADMIN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const RING = {
  id: 'qr-1', tenant_id: 'default', type: 'qr_codes', name: 'Portail',
  qr_type: 'url', mode: 'smart', short_id: 'AB12CD34', status: 'active',
  template_id: 'key-ring',
  template_data: {
    place_name: 'Propriété Privée',
    subtitle: 'Benedetti / Caron Image (haut de page) — WebP, PNG ou JPG',
    notice: 'ATTENTION Téléphone (Appeler / SMS) WhatsApp (format international)',
    phone: '0675590797', alert_email: 'moi@exemple.fr',
  },
};

// ── 1. Le contenu d'un QR Ring est bien enregistré ──────────────────
{
  const { env, state } = makeEnv(RING);
  const clean = { ...RING.template_data, subtitle: 'Benedetti / Caron', notice: 'ATTENTION' };
  const res = await handleUpdateQr(req({ template_data: clean }), env, 'qr-1');
  ok(res.status === 200, 'QR Ring : la mise à jour du contenu est acceptée');
  ok(state.entity.template_data.notice === 'ATTENTION',        'QR Ring : le message corrigé est enregistré');
  ok(state.entity.template_data.subtitle === 'Benedetti / Caron', 'QR Ring : le sous-titre corrigé est enregistré');
  ok(state.entity.template_data.alert_email === 'moi@exemple.fr', 'QR Ring : les clés hors schéma survivent');
  ok(state.entity.short_id === 'AB12CD34',                     'QR Ring : le code imprimé ne change pas');
  ok(state.redirectWrites === 0,                               'QR Ring : aucune écriture sur la table de redirection');
}

// ── 2. Le modèle garde le dernier mot (validate) ────────────────────
{
  const { env, state } = makeEnv(RING);
  const res = await handleUpdateQr(req({ template_data: { ...RING.template_data, place_name: '' } }), env, 'qr-1');
  ok(res.status === 400, 'refus : nom du lieu vide (règle du modèle)');
  ok(state.writes.length === 0, 'refus : rien n\'est écrit en base');
}
{
  const { env } = makeEnv(RING);
  const sansContact = { place_name: 'Portail', phone: '', whatsapp: '', email: '' };
  const res = await handleUpdateQr(req({ template_data: sansContact }), env, 'qr-1');
  ok(res.status === 400, 'refus : aucun moyen de contact (règle du modèle)');
}

// ── 3. Plafond de taille ────────────────────────────────────────────
{
  const { env } = makeEnv(RING);
  const gros = { ...RING.template_data, hero_url: 'x'.repeat(340 * 1024) };
  const res = await handleUpdateQr(req({ template_data: gros }), env, 'qr-1');
  ok(res.status === 400, 'refus : contenu au-dessus du plafond');
}

// ── 4. Non-régression : Concierge garde son chemin dédié ────────────
{
  const CG = { ...RING, template_id: 'concierge', concierge_source: 'inline',
               template_data: { etablissement: { nom: 'Test' } } };
  const { env, state } = makeEnv(CG);
  const res = await handleUpdateQr(req({ template_data: { etablissement: { nom: 'Modifié' } } }), env, 'qr-1');
  ok(res.status === 200, 'Concierge : mise à jour toujours acceptée');
  ok(state.entity.template_data.etablissement.nom === 'Modifié', 'Concierge : contenu enregistré');
  ok(state.entity.concierge_source === 'inline', 'Concierge : la provenance du bloc est conservée');
}

// ── 5. Non-régression : sans template_data, le contenu est intact ───
{
  const { env, state } = makeEnv(RING);
  const res = await handleUpdateQr(req({ name: 'Portail Nord' }), env, 'qr-1');
  ok(res.status === 200, 'renommage simple accepté');
  ok(state.entity.name === 'Portail Nord', 'renommage appliqué');
  ok(state.entity.template_data.notice === RING.template_data.notice, 'renommage : le contenu de la page est intact');
}

// ── 6. Un QR non-Smart n'est pas concerné ───────────────────────────
{
  const NU = { ...RING, mode: 'dynamic', template_id: null, template_data: null };
  const { env, state } = makeEnv(NU);
  const res = await handleUpdateQr(req({ template_data: { place_name: 'Pirate' } }), env, 'qr-1');
  ok(res.status === 200, 'QR simple : la requête passe');
  ok(!state.entity.template_data, 'QR simple : aucun contenu de modèle n\'est greffé');
}

console.log(`\n  Édition du contenu Smart — ${pass} PASS, ${fail} FAIL`);
if (fail) { console.log('  Échecs:\n   - ' + fails.join('\n   - ')); process.exit(1); }
process.exit(0);
