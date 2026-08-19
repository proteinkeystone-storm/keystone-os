/* ═══════════════════════════════════════════════════════════════
   SENTINEL · Search Console — le jeton Google qui expire (19 août 2026)

   Constat Stéphane : « Rafraîchir » → alerte « Lecture Search Console
   impossible (Bad Request) », carte toujours « connectée ». Cause : app
   OAuth Google en mode TEST → refresh token périmé après 7 jours, et
   Google répond alors LITTÉRALEMENT :
       400 { "error": "invalid_grant", "error_description": "Bad Request" }
   Le worker lisait error_description en premier → le message devenait
   « Bad Request », ratait sa propre branche « accès expiré » (qui teste
   /invalid_grant/ sur le message) et sortait un 502 cryptique SANS
   marquer la connexion morte.

   Ce banc traverse la VRAIE route (handleSiteGscRun / handleSiteGscGet)
   avec un D1 factice et un fetch qui rejoue mot pour mot la réponse de
   Google. Il vérifie :
     1. jeton périmé → 401, message clair (« expiré »), connexion
        marquée status='error' ;
     2. après quoi GET gsc dit connected:false (la carte redevient
        « Connecter ») ;
     3. chemin sain → 200, score calculé, relevé persisté (non-régression).

   Usage : node workers/test/test-sentinel-gsc-expiry.mjs   ·  Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */
import { handleSiteGscRun, handleSiteGscGet } from '../src/routes/sentinel.js';
import { encrypt } from '../src/lib/crypto.js';
import { signJWT } from '../src/lib/jwt.js';

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? String(extra).slice(0, 220) : ''); }
};

// ── L'env factice ────────────────────────────────────────────────
const ENC_KEY = 'clef-de-test-32-caracteres-mini!';
const state = {
  gscRow: null,          // la ligne sentinel_gsc « en base »
  flaggedError: false,   // UPDATE status='error' parti ?
  savedRun: null,        // UPDATE last_score … parti ? (chemin sain)
};
function dbHandlers(sql, args) {
  return {
    async first() {
      if (/FROM sentinel_sites WHERE id = \?/.test(sql)) return { id: args[0] };
      if (/FROM sentinel_gsc WHERE site_id = \?/.test(sql)) return state.gscRow;
      return null;
    },
    async run() {
      if (/UPDATE sentinel_gsc SET status='error'/.test(sql)) { state.flaggedError = true; state.gscRow = { ...state.gscRow, status: 'error' }; }
      if (/UPDATE sentinel_gsc SET last_score/.test(sql)) state.savedRun = { score: args[0], results: args[1] };
      return { success: true };
    },
    async all() { return { results: [] }; },
  };
}
const env = {
  KS_JWT_SECRET: 'gsc-banc-secret',
  KS_GSC_CLIENT_ID: 'cid-banc', KS_GSC_CLIENT_SECRET: 'csec-banc',
  KS_ENCRYPTION_KEY: ENC_KEY,
  KS_ALLOWED_ORIGIN: '*',
  DB: { prepare: (sql) => ({ bind: (...args) => dbHandlers(sql, args), ...dbHandlers(sql, []) }) },
};

// ── Le faux Google : rejoue la prod, mot pour mot ────────────────
let googleMode = 'expired';   // 'expired' | 'sain'
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/token')) {
    if (googleMode === 'expired') {
      // Réponse RÉELLE de Google pour un refresh token périmé/révoqué
      // (app en mode test après 7 jours) — c'est elle qui produisait
      // l'alerte « (Bad Request) » de la capture du 19/08.
      return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }), { status: 400 });
    }
    return new Response(JSON.stringify({ access_token: 'at-banc' }), { status: 200 });
  }
  if (u.includes('/searchAnalytics/query')) {
    return new Response(JSON.stringify({ rows: [{ keys: ['keystone'], clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 }] }), { status: 200 });
  }
  throw new Error('fetch inattendu dans le banc : ' + u);
};

const freshRow = async () => {
  const { ciphertext, iv } = await encrypt('refresh-token-de-banc', ENC_KEY);
  return { property: 'https://protein-keystone.com/', account_email: '', status: 'connected',
    refresh_ciphertext: ciphertext, refresh_iv: iv, last_score: 0, last_results: null, last_run_at: '2026-07-03 18:24:48' };
};
const jwt = await signJWT({ sub: 'tenant-banc', plan: 'MAX' }, env, 3600);
const req = (method = 'POST') => new Request('https://ks.test/api/sentinel/sites/site-1/gsc/run', {
  method, headers: { Authorization: 'Bearer ' + jwt } });

try {
  // ── 1 · Jeton périmé (le cas de la capture du 19/08) ──────────
  console.log('\n▶ Jeton Google périmé (app en mode test, +7 jours)');
  state.gscRow = await freshRow(); state.flaggedError = false;
  googleMode = 'expired';
  const r1 = await handleSiteGscRun(req(), env, 'site-1');
  const d1 = await r1.json().catch(() => ({}));
  ok(r1.status === 401, 'la route répond 401 (accès à rétablir), pas un 502 cryptique', 'status=' + r1.status + ' body=' + JSON.stringify(d1));
  ok(/expir|révoqu/i.test(d1.error || ''), 'le message dit que l\'accès a expiré, en français', d1.error);
  ok(!/bad request/i.test(d1.error || ''), 'plus de « Bad Request » brut montré au client', d1.error);
  ok(state.flaggedError, 'la connexion est marquée morte en base (status=error)');

  // ── 2 · La carte suit : GET gsc → connected:false ──────────────
  const r2 = await handleSiteGscGet(req('GET'), env, 'site-1');
  const d2 = await r2.json();
  ok(d2.gsc && d2.gsc.connected === false, 'GET gsc dit « non connectée » → la carte redevient « Connecter »', JSON.stringify(d2.gsc || {}));

  // ── 3 · Non-régression : jeton valide → relevé complet ────────
  console.log('\n▶ Jeton valide (chemin sain)');
  state.gscRow = await freshRow(); state.flaggedError = false; state.savedRun = null;
  googleMode = 'sain';
  const r3 = await handleSiteGscRun(req(), env, 'site-1');
  const d3 = await r3.json();
  ok(r3.status === 200, 'la route répond 200', 'status=' + r3.status);
  ok(d3.gsc && typeof d3.gsc.score === 'number' && d3.gsc.score > 0, 'le score est calculé (position 4,2 pondérée)', JSON.stringify((d3.gsc || {}).score));
  ok(!!state.savedRun, 'le relevé est persisté (UPDATE last_score)');
  ok(!state.flaggedError, 'et rien n\'est marqué en erreur');
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${pass + fail} vérifications — ${pass} ok, ${fail} ko`);
process.exit(fail ? 1 : 0);
