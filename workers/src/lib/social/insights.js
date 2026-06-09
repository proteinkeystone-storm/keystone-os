/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Insights (analytique simple) v1.0
   (Sprint Social — perf par post : pull à la demande)

   FB / IG / Threads exposent des insights GRATUITES au MÊME format Graph :
     { data: [ { name, period, values:[{value}], total_value:{value} } ] }
   Ce module centralise (1) les métriques retenues par réseau et (2) un
   parseur PUR commun → testable sans I/O. Le fetch réel vit dans chaque
   adapter (fetchInsights), le dispatch dans broadcast.js (fetchPostInsights).

   ⚠ Telegram = AVEUGLE (Bot API n'expose pas les vues d'un post de canal)
   → pas de fetchInsights → l'UI affiche « non disponible ».
   ⚠ Côté Meta, ces lectures exigent un scope DÉDIÉ par réseau :
     facebook  → read_insights
     instagram → instagram_manage_insights
     threads   → threads_manage_insights
   Sans le scope, l'appel renvoie une erreur de permission (gérée → l'UI
   affiche « indisponible », pas de crash). Test live = token avec le scope
   (perso) ou App Review (clients).
   ═══════════════════════════════════════════════════════════════ */

/**
 * Métriques retenues par réseau (ordre = ordre d'affichage). Ajustables ICI
 * sans toucher au moteur. `metric` = nom d'API ; `label` = libellé FR UI.
 */
export const INSIGHTS_FIELDS = {
  facebook: [
    { metric: 'post_impressions',             label: 'Impressions' },
    { metric: 'post_impressions_unique',      label: 'Portée' },
    { metric: 'post_clicks',                  label: 'Clics' },
    { metric: 'post_reactions_by_type_total', label: 'Réactions' },
  ],
  instagram: [
    { metric: 'reach',    label: 'Portée' },
    { metric: 'likes',    label: "J'aime" },
    { metric: 'comments', label: 'Commentaires' },
    { metric: 'saved',    label: 'Enregistrements' },
    { metric: 'shares',   label: 'Partages' },
  ],
  threads: [
    { metric: 'views',   label: 'Vues' },
    { metric: 'likes',   label: "J'aime" },
    { metric: 'replies', label: 'Réponses' },
    { metric: 'reposts', label: 'Reposts' },
    { metric: 'quotes',  label: 'Citations' },
  ],
};

/** Renvoie les métriques d'un réseau (ou [] si non géré). */
export function insightsFieldsFor(platform) {
  return INSIGHTS_FIELDS[platform] || [];
}

// Une valeur de métrique Graph peut être un nombre, une chaîne numérique, ou
// un objet ventilé (ex. réactions by_type_total {like:5, love:2}) → on somme.
function _coerceMetricValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'object') {
    let sum = 0;
    for (const v of Object.values(raw)) if (typeof v === 'number' && Number.isFinite(v)) sum += v;
    return sum;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parseur PUR d'une réponse Graph insights → liste UI-ready.
 * @param {any} json   réponse brute { data:[...] }
 * @param {{metric:string,label:string}[]} fields  métriques attendues (ordre conservé)
 * @returns {{key:string,label:string,value:number|null}[]}  value null = métrique absente
 */
export function parseGraphInsights(json, fields) {
  const data   = Array.isArray(json?.data) ? json.data : [];
  const byName = {};
  for (const d of data) if (d && d.name) byName[d.name] = d;

  return (fields || []).map(f => {
    const d = byName[f.metric];
    let value = null;
    if (d) {
      const raw = (Array.isArray(d.values) && d.values.length)
        ? d.values[d.values.length - 1]?.value
        : (d.total_value ? d.total_value.value : undefined);
      value = _coerceMetricValue(raw);
    }
    return { key: f.metric, label: f.label, value };
  });
}

/**
 * Fetch + parse des insights Graph d'un objet (post/média). Mutualisé par les
 * adapters FB/IG/Threads (même format Graph ; seuls base + objectId changent).
 * @param {{base:string, objectId:string, platform:string, accessToken:string, label?:string}} a
 * @returns {Promise<{metrics:{key:string,label:string,value:number|null}[]}>}
 * @throws en cas d'erreur HTTP (permission/scope manquant, id invalide…).
 */
export async function fetchGraphInsights({ base, objectId, platform, accessToken, label }) {
  if (!objectId) throw new Error('identifiant de post manquant');
  const fields = insightsFieldsFor(platform);
  const res = await fetch(`${base}/${encodeURIComponent(objectId)}/insights?` + new URLSearchParams({
    metric: fields.map(f => f.metric).join(','),
    access_token: accessToken,
  }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${label || platform} insights ${res.status} : ${data?.error?.message || JSON.stringify(data).slice(0, 160)}`);
  }
  return { metrics: parseGraphInsights(data, fields) };
}
