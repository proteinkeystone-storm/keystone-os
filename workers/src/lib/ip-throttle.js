/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Plafond anti-abus PAR IP (correctif sécurité #2)
   ─────────────────────────────────────────────────────────────
   LE TROU FERMÉ ICI
   ─────────────────────────────────────────────────────────────
   Les surfaces publiques anonymes bornaient l'abus par une empreinte
   `device_hash = SHA256(User-Agent | IP)`. Or le User-Agent est un
   simple en-tête, contrôlé par le client : une requête sur deux avec un
   UA neuf = une empreinte neuve = un compteur/appareil qui repart à zéro.
   Le plafond « par appareil » ne bornait donc plus RIEN face à une boucle
   automatisée ; il ne restait que le plafond « par lien/jour », bien plus
   haut, exposant d'autant le portefeuille IA du client.

   CE QUE FAIT CE MODULE
   ─────────────────────────────────────────────────────────────
   Un plafond quotidien PAR IP, indépendant de l'empreinte appareil. L'IP
   ne se change pas d'un simple en-tête : la rotation d'UA gratuite ne
   déjoue plus rien, il faut désormais un pool d'adresses (proxies/botnet)
   pour multiplier les compteurs — coût sans commune mesure.

   Calibré ENTRE le cap/appareil et le cap/lien : il ne remplace ni
   n'abaisse aucun plafond existant, il rattrape le contournement au
   niveau intermédiaire. Le partage d'IP légitime (Wi-Fi d'un commerce,
   NAT mobile) garde une marge confortable.

   FAIL-OPEN assumé, comme le reste des surfaces publiques : une base
   muette laisse passer plutôt que de couper un visiteur qui paie (le
   budget global reste protégé en aval par budgetGuard). Table dédiée
   (`public_ip_usage`) : ZÉRO impact sur les compteurs par appareil
   existants (pas de double-comptage dans leurs SUM).
   ═══════════════════════════════════════════════════════════════ */

let _ready = false;
async function _ensure(env) {
  if (_ready) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS public_ip_usage (
        scope      TEXT NOT NULL,       -- 'concierge:<short_id>' | 'agent:<slug>' | …
        day        TEXT NOT NULL,       -- YYYY-MM-DD UTC
        ip_hash    TEXT NOT NULL,       -- SHA-256(IP) tronqué (anonyme, non réversible)
        count      INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (scope, day, ip_hash)
      )
    `).run();
    await env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_public_ip_usage_day ON public_ip_usage(scope, day)'
    ).run();
    _ready = true;
  } catch (e) {
    console.warn('[ip-throttle] table init failed:', e.message);
  }
}

// SHA-256(IP) tronqué. IP SEULE — jamais le User-Agent (c'est tout l'intérêt).
// Anonyme et non réversible : on ne stocke pas l'adresse, seulement son
// empreinte, cohérent avec la ligne RGPD des scans (device_hash).
export async function ipHashOf(request) {
  const ip = request.headers.get('cf-connecting-ip')
          || request.headers.get('x-forwarded-for')
          || '?';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// Le plafond/IP est-il DÉJÀ atteint pour aujourd'hui ? true = refuser.
// FAIL-OPEN : tout incident D1 renvoie false (on laisse passer).
export async function ipRateExceeded(env, scope, ipHash, cap) {
  if (!Number.isInteger(cap) || cap <= 0) return false;
  await _ensure(env);
  const day = new Date().toISOString().slice(0, 10);
  try {
    const row = await env.DB
      .prepare('SELECT count FROM public_ip_usage WHERE scope = ? AND day = ? AND ip_hash = ?')
      .bind(scope, day, ipHash).first();
    return (row?.count ?? 0) >= cap;
  } catch (e) {
    console.warn('[ip-throttle] rate-check FAIL-OPEN :', e.message);
    return false;
  }
}

// Incrémente le compteur/IP du jour. À appeler quand la requête est ADMISE,
// AVANT la génération (un échec du modèle compte : sinon la boucle est gratuite).
export async function ipRateBump(env, scope, ipHash) {
  await _ensure(env);
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(`
    INSERT INTO public_ip_usage (scope, day, ip_hash, count, updated_at)
    VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(scope, day, ip_hash) DO UPDATE SET
      count = count + 1, updated_at = datetime('now')
  `).bind(scope, day, ipHash).run().catch(() => {});
}
