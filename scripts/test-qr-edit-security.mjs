// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — AUDIT de la nouvelle écriture « contenu Smart »
// ───────────────────────────────────────────────────────────────────
// PATCH /api/qr/:id accepte désormais template_data pour tout modèle Smart
// (avant : Concierge seul). Ce banc attaque cette surface :
//   1. cloison entre clients      2. authentification
//   3. injection dans la page publique (le contenu FINIT en HTML servi)
//   4. changement de modèle en douce   5. plafond de taille
// Handler appelé EN DIRECT (jamais de self-HTTP), D1 simulé.
// ══════════════════════════════════════════════════════════════════

import { handleUpdateQr } from '../workers/src/routes/qr.js';
import { getTemplate } from '../workers/src/routes/smart-templates/index.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) { if (cond) pass++; else { fail++; fails.push(label); } }

const ADMIN = 'secret-de-banc';

function makeEnv(entity, tenant = 'default') {
  const state = { entity: JSON.parse(JSON.stringify(entity)), writes: [] };
  const db = {
    prepare(sql) {
      const q = { sql, args: [] };
      q.bind = (...a) => { q.args = a; return q; };
      q.first = async () => {
        if (!/FROM entities/i.test(sql)) return null;
        // Cloison : la ligne n'est rendue QUE si le tenant demandeur correspond.
        const askedTenant = q.args[0], askedId = q.args[1];
        if (askedTenant !== tenant || askedId !== state.entity.id) return null;
        return { data: JSON.stringify(state.entity) };
      };
      q.run = async () => {
        if (/UPDATE entities/i.test(sql)) {
          const blob = q.args.find(a => typeof a === 'string' && a.trim().startsWith('{'));
          if (blob) { state.writes.push(JSON.parse(blob)); state.entity = JSON.parse(blob); }
        }
        return { success: true };
      };
      q.all = async () => ({ results: [] });
      return q;
    },
  };
  return { env: { DB: db, KS_ADMIN_SECRET: ADMIN, KS_ALLOWED_ORIGIN: 'https://protein-keystone.com' }, state };
}
const req = (body, auth = `Bearer ${ADMIN}`) => new Request('https://x/api/qr/qr-1', {
  method: 'PATCH',
  headers: auth ? { Authorization: auth, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const RING = {
  id: 'qr-1', tenant_id: 'default', type: 'qr_codes', name: 'Portail',
  qr_type: 'url', mode: 'smart', short_id: 'AB12CD34', status: 'active',
  template_id: 'key-ring',
  template_data: { place_name: 'Portail', phone: '0600000000' },
};

// ── 1. Cloison entre clients ────────────────────────────────────────
{
  // Le QR appartient au tenant 'client-A' ; l'appelant est authentifié 'default'.
  const { env, state } = makeEnv({ ...RING, tenant_id: 'client-A' }, 'client-A');
  const res = await handleUpdateQr(req({ template_data: { place_name: 'Pirate', phone: '0611111111' } }), env, 'qr-1');
  ok(res.status === 404, 'cloison : le QR d\'un autre client est introuvable (404)');
  ok(state.writes.length === 0, 'cloison : aucune écriture sur le QR d\'un autre client');
}
{
  // Bon tenant, MAUVAIS identifiant de QR.
  const { env, state } = makeEnv(RING);
  const res = await handleUpdateQr(req({ template_data: { place_name: 'X', phone: '0600000000' } }), env, 'qr-AUTRE');
  ok(res.status === 404, 'identifiant inconnu : 404');
  ok(state.writes.length === 0, 'identifiant inconnu : aucune écriture');
}

// ── 2. Authentification ─────────────────────────────────────────────
{
  const { env, state } = makeEnv(RING);
  const res = await handleUpdateQr(req({ template_data: { place_name: 'Anonyme', phone: '0600000000' } }, null), env, 'qr-1');
  ok(res.status === 401, 'sans jeton : refusé (401)');
  ok(state.writes.length === 0, 'sans jeton : aucune écriture');
}
{
  const { env } = makeEnv(RING);
  const res = await handleUpdateQr(req({ template_data: { place_name: 'X', phone: '0600000000' } }, 'Bearer faux'), env, 'qr-1');
  ok(res.status === 401, 'jeton invalide : refusé (401)');
}

// ── 3. Injection dans la page PUBLIQUE ──────────────────────────────
// Le contenu écrit ici finit en HTML servi à des inconnus au scan.
const XSS = '"><script>alert(1)</script>';
{
  const { env, state } = makeEnv(RING);
  const poison = {
    place_name: XSS,
    subtitle:   '</title><img src=x onerror=alert(1)>',
    notice:     "'\"><svg onload=alert(1)>",
    message:    '</textarea><script>fetch("//evil")</script>',
    phone:      'javascript:alert(1)',
    whatsapp:   '"><script>a</script>',
    email:      'x@y.z"><script>b</script>',
    accent_color: 'red;}</style><script>c</script><style>{',
    hero_url:   'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  };
  const res = await handleUpdateQr(req({ template_data: poison }), env, 'qr-1');
  ok(res.status === 200, 'injection : le contenu est accepté (c\'est du texte, il doit être NEUTRALISÉ au rendu)');

  const html = getTemplate('key-ring').renderHTML({ ...state.entity }, {});
  ok(!/<script>alert\(1\)<\/script>/.test(html),      'rendu : aucune balise script injectée');
  // Un gestionnaire n'est dangereux que DANS une vraie balise : échappé
  // (« &lt;img … onerror=… &gt; »), c'est du texte inerte. On teste donc la
  // balise ouvrante réelle, pas la sous-chaîne.
  ok(!/<[a-z][^>]*\son\w+\s*=/i.test(html.replace(/<script>[\s\S]*?<\/script>/gi, '')),
                                                      'rendu : aucun gestionnaire d\'événement dans une balise');
  ok(!/<img\b/i.test(html),                           'rendu : aucune balise img injectée (hero_url hostile rejeté)');
  ok(!/<svg[^>]*onload/i.test(html),                  'rendu : pas de SVG exécutable');
  ok(!/href="javascript:/i.test(html),                'rendu : aucun lien javascript:');
  ok(!/src="data:text\/html/i.test(html),             'rendu : image data:text/html rejetée');
  ok(html.includes('&lt;script&gt;') || html.includes('&lt;'), 'rendu : les chevrons sont échappés');
  // Sortie d'attribut : le guillemet du payload ne doit jamais rester nu.
  ok(!/<title>[^<]*"><\/title>/.test(html),           'rendu : pas de sortie d\'attribut dans le titre');
  // La couleur d'accent atterrit dans une feuille de style inline.
  ok(!/<\/style>\s*<script>/i.test(html),             'rendu : la couleur ne casse pas la feuille de style');
}

// ── 4. Changement de modèle en douce ────────────────────────────────
{
  const { env, state } = makeEnv(RING);
  // On tente de basculer sur un modèle plus permissif ET d'écrire son contenu.
  const res = await handleUpdateQr(req({
    template_id: 'storytelling-brand',
    template_data: { place_name: 'Portail', phone: '0600000000' },
  }), env, 'qr-1');
  ok(res.status === 200, 'requête acceptée');
  ok(state.entity.template_id === 'key-ring', 'le modèle NE PEUT PAS être changé par cette route');
}
{
  // Contourner validate() en visant un modèle qui n'a pas les mêmes règles :
  // impossible puisque la validation suit le modèle STOCKÉ, pas celui demandé.
  const { env, state } = makeEnv(RING);
  const res = await handleUpdateQr(req({ template_id: 'storytelling-brand', template_data: { titre: 'X' } }), env, 'qr-1');
  ok(res.status === 400, 'les règles du modèle STOCKÉ s\'appliquent (pas celles d\'un modèle demandé)');
  ok(state.writes.length === 0, 'contournement : aucune écriture');
}

// ── 5. Plafond & formes hostiles ────────────────────────────────────
{
  const { env } = makeEnv(RING);
  const res = await handleUpdateQr(req({ template_data: { place_name: 'X', phone: '0600000000', big: 'y'.repeat(400 * 1024) } }), env, 'qr-1');
  ok(res.status === 400, 'plafond de taille appliqué');
}
{
  const { env, state } = makeEnv(RING);
  const before = JSON.stringify(state.entity.template_data);
  for (const hostile of [null, 'texte', 42, true]) {
    await handleUpdateQr(req({ template_data: hostile }), env, 'qr-1');
  }
  ok(JSON.stringify(state.entity.template_data) === before, 'types non-objet ignorés (null, texte, nombre, booléen)');
}
{
  // Prototype pollution : __proto__ dans le contenu ne doit pas contaminer.
  const { env } = makeEnv(RING);
  await handleUpdateQr(req({ template_data: JSON.parse('{"place_name":"X","phone":"0600000000","__proto__":{"pollue":true}}') }), env, 'qr-1');
  ok({}.pollue === undefined, 'aucune pollution de prototype via le contenu');
}

// ── 6. Le code imprimé et les compteurs restent hors d'atteinte ─────
{
  const { env, state } = makeEnv(RING);
  await handleUpdateQr(req({
    template_data: { place_name: 'Portail', phone: '0600000000' },
    short_id: 'PIRATE00', tenant_id: 'client-A', id: 'autre', scans_total: 99999,
  }), env, 'qr-1');
  ok(state.entity.short_id === 'AB12CD34', 'short_id non modifiable par cette route');
  ok(state.entity.tenant_id === 'default', 'tenant_id non modifiable par cette route');
  ok(state.entity.id === 'qr-1',           'identifiant non modifiable par cette route');
  ok(state.entity.scans_total === undefined, 'les compteurs de scans ne sont pas écrits dans l\'entité');
}

console.log(`\n  Audit — écriture du contenu Smart : ${pass} PASS, ${fail} FAIL`);
if (fail) { console.log('  Échecs:\n   - ' + fails.join('\n   - ')); process.exit(1); }
process.exit(0);
