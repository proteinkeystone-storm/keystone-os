/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Sonde MCP Apps (S7)
   ───────────────────────────────────────────────────────────────
   UNE question, une seule : claude.ai accepte-t-il d'afficher une
   interface servie par un connecteur PERSONNALISÉ ? L'annonce ne cite
   que les connecteurs de l'annuaire (HANDOFF_MCP_CLAUDE « Réserve »).

   Mécanique (extension `io.modelcontextprotocol/ui`, spec vérifiée le
   17/09/2026, version 2026-01-26) :
     · une ressource `ui://keystone/qr-card` servie par `resources/read`
       en `text/html;profile=mcp-app` ;
     · l'outil `keystone_qr_card` la désigne par `_meta.ui.resourceUri` ;
     · le SERVEUR ne déclare rien : c'est le client qui annonce l'extension
       à `initialize`. Un client qui l'ignore ne voit qu'un outil normal,
       dont le résultat texte (JSON) suffit au modèle → repli gratuit.

   CONTRAINTE QUI DÉCIDE DE TOUT : la CSP par défaut de l'iframe interdit
   TOUT réseau (scripts et styles inline seulement). La page ne peut donc
   ni appeler l'API Keystone, ni charger une police, ni lire le coffre.
   Les données arrivent par le résultat de l'outil (`tool-result`) ou par
   un `tools/call` relayé par l'hôte. D'où : aucun fetch ici, aucune URL
   externe, et la charte rendue en CSS inline (notre font-stack est native,
   il n'y a rien à télécharger).

   ANNULATION : variable Worker `MCP_APPS`. À « off » (ou absente), l'outil
   et la ressource disparaissent du catalogue — rien d'autre à défaire.

   Banc : scripts/test-mcp-apps.mjs (autonomie de la page, gate, protocole).
   ═══════════════════════════════════════════════════════════════ */

export const APPS_UI_URI  = 'ui://keystone/qr-card';
export const APPS_UI_MIME = 'text/html;profile=mcp-app';
/* Seule adresse citée par la page : « Ouvrir dans Keystone » (ui/open-link).
   Le vrai pad, dans le vrai navigateur, reste meilleur qu'une vignette. */
export const APPS_APP_URL = 'https://protein-keystone.com/app';

/* La sonde n'existe que si la variable Worker MCP_APPS vaut 'on'. */
export const appsEnabled = (env) => String((env && env.MCP_APPS) || '').toLowerCase() === 'on';

/* Ressources à ajouter à `resources/list` (vide si la sonde est éteinte). */
export function appsResources(env) {
  if (!appsEnabled(env)) return [];
  return [{
    uri: APPS_UI_URI, name: 'ui/qr-card', title: 'Carte des QR codes (interface)',
    mimeType: APPS_UI_MIME,
    description: 'Interface de la carte Smart Dynamic QR (scans, meilleurs QR, points à surveiller), affichée par le client s’il sait rendre les interfaces MCP. Données fournies par l’outil keystone_qr_card.',
  }];
}

/* `resources/read` : rend la page, ou null si ce n'est pas notre URI. */
export function appsResourceRead(uri, env) {
  if (!appsEnabled(env) || String(uri || '') !== APPS_UI_URI) return null;
  return {
    uri: APPS_UI_URI, mimeType: APPS_UI_MIME, text: QR_CARD_HTML,
    /* `prefersBorder` : l'hôte encadre la vue. Pas de `csp` demandée : la
       page n'a besoin d'aucun réseau, autant le prouver. */
    _meta: { ui: { prefersBorder: true } },
  };
}

/* ── La page. Autonome : aucun réseau, aucun innerHTML, aucune dépendance.
   Le DOM est construit par createElement/textContent — une donnée ne peut
   pas devenir du balisage. ──────────────────────────────────────────── */
export const QR_CARD_HTML = `<!doctype html>
<html lang="fr" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Keystone — Carte des QR codes</title>
<style>
  :root{
    --bg:#131826; --card:#1c2234; --card2:#242d42; --bd:rgba(255,255,255,.08);
    --tx:#f8fafc; --tx2:rgba(248,250,252,.58); --accent:#6366f1; --accent2:#818cf8;
    --green:#22c55e; --warn:#fbbf24;
  }
  html[data-theme="light"]{
    --bg:#f6f7fb; --card:#ffffff; --card2:#f2f4f9; --bd:rgba(15,23,42,.09);
    --tx:#0f172a; --tx2:rgba(15,23,42,.58); --accent:#4f46e5; --accent2:#4338ca;
    --green:#15803d; --warn:#b45309;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:transparent;color:var(--tx)}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    letter-spacing:-.02em; -webkit-font-smoothing:antialiased; padding:2px;
  }
  .card{background:var(--card);border:1px solid var(--bd);border-radius:18px;padding:18px 18px 14px;max-width:720px}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
  .brand{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--tx2)}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--accent);flex:0 0 auto}
  .period{font-size:12px;color:var(--tx2);background:var(--card2);border:1px solid var(--bd);border-radius:999px;padding:4px 10px;white-space:nowrap}
  h1{font-size:19px;font-weight:900;letter-spacing:-.03em;margin:0 0 12px}
  h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--tx2);margin:18px 0 8px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px}
  .tile{background:var(--card2);border:1px solid var(--bd);border-radius:14px;padding:11px 12px}
  .tile .n{font-size:24px;font-weight:900;letter-spacing:-.04em;line-height:1.1}
  .tile .l{font-size:11px;color:var(--tx2);margin-top:3px}
  ol.rank{list-style:none;margin:0;padding:0}
  ol.rank li{display:flex;align-items:baseline;gap:10px;padding:7px 0;border-bottom:1px solid var(--bd);font-size:13px}
  ol.rank li:last-child{border-bottom:0}
  .rk{width:18px;color:var(--tx2);font-variant-numeric:tabular-nums;font-size:12px}
  .nm{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sc{font-weight:700;font-variant-numeric:tabular-nums}
  .tr{font-size:11px;color:var(--tx2);width:66px;text-align:right}
  .tr.up{color:var(--green)} .tr.down{color:var(--warn)}
  ul.watch{list-style:none;margin:0;padding:0;font-size:12.5px;color:var(--tx2)}
  ul.watch li{padding:5px 0}
  footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:16px}
  button{font:inherit;letter-spacing:-.02em;font-size:13px;font-weight:600;border-radius:11px;padding:9px 14px;cursor:pointer;
    background:var(--accent);color:#fff;border:1px solid transparent}
  button:hover{background:var(--accent2)}
  button.ghost{background:transparent;color:var(--tx);border-color:var(--bd)}
  button:disabled{opacity:.5;cursor:default}
  .state{font-size:11.5px;color:var(--tx2);flex:1 1 auto;text-align:right}
</style>
</head>
<body>
<div class="card" id="card">
  <header>
    <div class="brand"><span class="dot"></span><span>Keystone · Smart Dynamic QR</span></div>
    <div class="period" id="period">7 derniers jours</div>
  </header>
  <h1 id="title">Vos QR codes</h1>
  <div class="grid" id="stats"></div>
  <div id="rankWrap" hidden><h2>Meilleurs QR</h2><ol class="rank" id="rank"></ol></div>
  <div id="watchWrap" hidden><h2>À surveiller</h2><ul class="watch" id="watch"></ul></div>
  <footer>
    <button id="refresh" type="button">Rafraîchir</button>
    <button id="open" class="ghost" type="button">Ouvrir dans Keystone</button>
    <span class="state" id="state">Chargement…</span>
  </footer>
</div>
<script>
(function () {
  'use strict';
  var APP_URL = 'https://protein-keystone.com/app';
  var TOOL = 'keystone_qr_card';
  var PERIODS = { '7d': '7 derniers jours', '30d': '30 derniers jours', '90d': '90 derniers jours', all: 'depuis le début' };
  var seq = 0, pending = {}, period = '7d', got = false;
  var el = function (id) { return document.getElementById(id); };

  /* ── JSON-RPC avec l'hôte, par postMessage ── */
  function post(m) { try { parent.postMessage(m, '*'); } catch (e) { /* hôte parti */ } }
  function notify(method, params) { post({ jsonrpc: '2.0', method: method, params: params || {} }); }
  function rpc(method, params) {
    var id = 'v' + (++seq);
    var p = new Promise(function (res, rej) {
      pending[id] = { res: res, rej: rej };
      setTimeout(function () { if (pending[id]) { delete pending[id]; rej(new Error('pas de réponse de l’hôte')); } }, 8000);
    });
    post({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
    return p;
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var m = e.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id && pending[m.id]) {
      var w = pending[m.id]; delete pending[m.id];
      if (m.error) w.rej(new Error((m.error && m.error.message) || 'erreur de l’hôte'));
      else w.res(m.result);
      return;
    }
    if (m.method === 'ui/notifications/tool-input') { applyInput(m.params); return; }
    if (m.method === 'ui/notifications/tool-result') { var d = pick(m.params); if (d) render(d); return; }
    if (m.method === 'ui/notifications/host-context-changed') { applyHost(m.params); return; }
  });

  /* ── Extraction tolérante : la forme exacte du résultat poussé par l'hôte
        n'est pas garantie, on cherche donc structuredContent, puis le JSON
        du premier contenu texte, puis le brut. ── */
  function pick(p) {
    if (!p || typeof p !== 'object') return null;
    var roots = [p, p.result, p.toolResult, p.output];
    for (var i = 0; i < roots.length; i++) {
      var r = roots[i];
      if (!r || typeof r !== 'object') continue;
      if (r.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent;
      if (r.vue === 'carte_qr') return r;
      if (Array.isArray(r.content)) {
        for (var j = 0; j < r.content.length; j++) {
          var c = r.content[j];
          if (c && c.type === 'text' && typeof c.text === 'string') {
            try { var o = JSON.parse(c.text); if (o && typeof o === 'object') return o; } catch (e) { /* pas du JSON */ }
          }
        }
      }
    }
    return null;
  }
  function applyInput(p) {
    var a = p && (p.arguments || p.input || p);
    var v = a && typeof a.period === 'string' ? a.period : null;
    if (v && PERIODS[v]) { period = v; el('period').textContent = PERIODS[v]; }
  }
  function applyHost(p) {
    var h = p && (p.hostContext || p);
    var theme = h && typeof h.theme === 'string' ? h.theme : null;
    if (theme) document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  /* ── Rendu (createElement + textContent uniquement) ── */
  function tile(n, l) {
    var d = document.createElement('div'); d.className = 'tile';
    var a = document.createElement('div'); a.className = 'n'; a.textContent = n;
    var b = document.createElement('div'); b.className = 'l'; b.textContent = l;
    d.appendChild(a); d.appendChild(b); return d;
  }
  function num(v) { var n = Number(v || 0); return n.toLocaleString('fr-FR'); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function render(d) {
    got = true;
    if (typeof d.periode === 'string' && PERIODS[d.periode]) { period = d.periode; }
    el('period').textContent = PERIODS[period] || period;

    var stats = el('stats'); clear(stats);
    stats.appendChild(tile(num(d.scans), 'scans'));
    stats.appendChild(tile(num(d.visiteurs_uniques), 'visiteurs uniques'));
    stats.appendChild(tile(num(d.aujourdhui), 'aujourd’hui'));
    stats.appendChild(tile(num(d.qr_actifs) + ' / ' + num(d.qr_total), 'QR actifs'));

    var rank = el('rank'); clear(rank);
    var list = Array.isArray(d.classement) ? d.classement.slice(0, 5) : [];
    for (var i = 0; i < list.length; i++) {
      var q = list[i] || {};
      var li = document.createElement('li');
      var rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = String(i + 1) + '.';
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = String(q.nom || '—');
      var sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = num(q.scans);
      var tr = document.createElement('span');
      var t = String(q.tendance || '');
      tr.className = 'tr' + (t === 'en hausse' ? ' up' : t === 'en baisse' ? ' down' : '');
      tr.textContent = t;
      li.appendChild(rk); li.appendChild(nm); li.appendChild(sc); li.appendChild(tr);
      rank.appendChild(li);
    }
    el('rankWrap').hidden = list.length === 0;

    var watch = el('watch'); clear(watch);
    var w = Array.isArray(d.a_surveiller) ? d.a_surveiller.slice(0, 4) : [];
    for (var k = 0; k < w.length; k++) {
      var li2 = document.createElement('li'); li2.textContent = String(w[k]); watch.appendChild(li2);
    }
    el('watchWrap').hidden = w.length === 0;

    setState(d.mesure_le ? 'À jour · ' + hhmm(d.mesure_le) : 'À jour');
    measure();
  }
  function setState(s) { el('state').textContent = s; }
  function hhmm(s) {
    try {
      var t = new Date(s);
      if (isNaN(t.getTime())) return String(s);
      return t.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return String(s); }
  }

  /* ── Hauteur : l'hôte dimensionne l'iframe. On n'annonce QUE les vraies
        variations : l'hôte redimensionne l'iframe, ce qui refait naître un
        événement de l'observateur — sans ce garde-fou, la page bavarde en
        boucle (vu au banc local : 11 notifications identiques). ── */
  var lastH = 0, queued = false;
  function measure() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      var h = Math.ceil(el('card').getBoundingClientRect().height) + 8;
      if (!h || Math.abs(h - lastH) < 2) return;
      lastH = h;
      notify('ui/notifications/size-changed', { height: h, width: null });
    });
  }
  if (typeof ResizeObserver === 'function') { new ResizeObserver(measure).observe(el('card')); }
  window.addEventListener('resize', measure);

  /* ── Actions ── */
  el('refresh').addEventListener('click', function () {
    var b = el('refresh'); b.disabled = true; setState('Mise à jour…');
    rpc('tools/call', { name: TOOL, arguments: { period: period } }).then(function (r) {
      var d = pick(r); if (d) render(d); else setState('Réponse illisible');
    }).catch(function (e) { setState(e.message || 'Échec de la mise à jour'); })
      .then(function () { b.disabled = false; });
  });
  el('open').addEventListener('click', function () {
    rpc('ui/open-link', { url: APP_URL }).catch(function () { notify('ui/open-link', { url: APP_URL }); });
  });

  /* ── Poignée de main ── */
  rpc('ui/initialize', { protocolVersion: '2026-01-26', clientInfo: { name: 'keystone-qr-card', version: '1.0' } })
    .then(applyHost).catch(function () { /* hôte muet : la page reste lisible */ })
    .then(function () {
      notify('ui/notifications/initialized', {});
      measure();
      setTimeout(function () { if (!got) setState('En attente des données — touchez « Rafraîchir »'); }, 1500);
    });
})();
</script>
</body>
</html>`;
