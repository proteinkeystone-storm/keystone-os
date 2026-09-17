/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Outils MCP (sprint 1 : lectures · sprint 3 : écritures + bannette)
   ───────────────────────────────────────────────────────────────
   Le catalogue que Claude voit via /mcp (routes/mcp.js). Chaque outil
   est une LECTURE servie par une route existante du Worker, appelée en
   interne avec le JWT de l'utilisateur (ctx.call) : la licence, le plan
   et le tenant sont tranchés par la route elle-même, exactement comme
   pour le pad. Ce module ne résout AUCUN tenant et ne touche à AUCUNE
   table : il met en forme.

   Hérité de app/bridge-actions.js (ex-catalogue Kora) : mêmes
   résolutions par nom (exact puis partiel, accents ignorés), mêmes
   garde-fous PII (Key Form : jamais le contenu des réponses ; networK :
   coordonnées seulement sur une fiche ciblée), dates en ISO 8601 UTC —
   Claude formate lui-même.

   LIGNES ROUGES (HANDOFF_MCP_CLAUDE §1) : aucun outil ici ne supprime,
   ne publie, ne touche licence / facturation / admin / Sceau, n'écrit
   dans Key Form ni ne modifie un QR. La seule requête non-GET est le
   board Living Layer (POST de calcul, sans effet de bord) — le banc
   scripts/test-mcp-redlines.mjs le vérifie sur `routes` déclarées.
   ═══════════════════════════════════════════════════════════════ */

import { listFormPads, resolveFormPad, formSchema, validateFormData, formUri } from './mcp-forms.js';
import { APPS_UI_URI, APPS_APP_URL }                                          from './mcp-apps.js';

/* ── Aides ── */
const excerpt = (text, max = 160) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
/* SQLite datetime('now') = « YYYY-MM-DD HH:MM:SS » UTC sans T ni Z →
   ISO complet. Les ISO avec T/Z et les dates pures passent inchangés. */
const iso = (v) => {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (typeof v === 'string' && !/[TZ]/.test(v)) return v.replace(' ', 'T') + 'Z';
  if (typeof v === 'number') return new Date(v).toISOString();
  return String(v);
};
const ms = (v) => { const t = Date.parse(iso(v) || ''); return isNaN(t) ? null : t; };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const todayIso = () => new Date().toISOString().slice(0, 10);
const plusDaysIso = (d) => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);
const jsonArr = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
const clampInt = (v, min, max, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

/* Résolution par NOM — le patron commun (exact, puis partiel, accents ignorés).
   `names(item)` renvoie les libellés comparables d'un item. Sans référence :
   un item unique se résout seul si `soloOk`, sinon on liste, on ne devine pas. */
function resolveByName(items, ref, { label, names, soloOk = true, what = 'élément', empty }) {
  if (!items.length) throw new Error(empty || `Aucun ${what} pour l’instant.`);
  const r = String(ref || '').trim();
  if (!r) {
    if (soloOk && items.length === 1) return items[0];
    throw new Error(`Plusieurs ${what}s : ${items.map(label).join(' · ')}. Précise lequel.`);
  }
  const n = norm(r);
  const all = (it) => (names ? names(it) : [label(it)]).map(norm);
  const exact = items.filter(it => all(it).includes(n));
  if (exact.length === 1) return exact[0];
  const part = exact.length ? exact : items.filter(it => all(it).some(x => x && x.includes(n)));
  if (part.length === 1) return part[0];
  if (part.length > 1)
    throw new Error(`Plusieurs ${what}s correspondent à « ${r} » : ${part.slice(0, 8).map(label).join(' · ')}. Précise.`);
  throw new Error(`Aucun ${what} « ${r} ». Existants : ${items.slice(0, 12).map(label).join(' · ')}.`);
}

const S = (props = {}, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });

/* ── LE CATALOGUE ──
   { name, title, description, inputSchema, routes:[{method,path}], run(ctx,args) }
   ctx.call(path, { method, body }) → JSON de la route (throw = message serveur). */
export const MCP_TOOLS = [

  /* ═══ OS ═══ */
  {
    name: 'keystone_os_catalog', title: 'Catalogue des applications',
    description: "Liste les applications (pads) du K-Store Keystone avec leur identifiant et leur rôle, et le plan du compte connecté. À appeler d'abord pour savoir quels outils existent ; l'accès à chaque application est tranché par la licence à chaque appel.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/catalog' }],
    run: async (ctx) => {
      let pads = [];
      try {
        const data = await ctx.call('/api/catalog');
        const cat = data && data.catalog;
        /* forme réelle du catalogue K-Store (admin → /api/admin/catalog) :
           { version, updatedAt, tools:[{ id, padKey, title, subtitle, plan, price, longDesc… }] } */
        const list = Array.isArray(cat?.tools) ? cat.tools : Array.isArray(cat) ? cat : Array.isArray(cat?.pads) ? cat.pads : [];
        pads = list.filter(p => p && p.id && p.published !== false && !p.replacedBy).map(p => ({
          id: p.id, nom: p.title || p.name || p.id, role: excerpt(p.subtitle || p.longDesc || p.description, 120),
          plan_minimum: p.plan || null,
        }));
      } catch (_) { /* catalogue absent : on sert au moins le plan */ }
      return {
        plan: ctx.claims.plan || null,
        admin: ctx.claims.isAdmin === true || String(ctx.claims.plan || '').toUpperCase() === 'ADMIN',
        applications: pads,
        note: 'Les outils keystone_* couvrent : Smart Dynamic QR, Sentinel, Keynapse, Smart Agent, desK, Social Manager, Ghost Writer, Key Form, Key Brand, networK, Living Layer, et les pads-formulaires (keystone_form_list). Brainstorming, la bibliothèque Ghost Writer et le composer Social vivent dans le navigateur : lus via l’onglet ouvert (Pont) ou le reflet chiffré si activé.',
      };
    },
  },

  /* ═══ LIVING LAYER — « quoi de neuf ? » ═══ */
  {
    name: 'keystone_livinglayer_board', title: 'Quoi de neuf (tous les pads)',
    description: "Le point d'ensemble du tableau de bord Keystone, tous les pads d'un coup : signaux à traiter, alerte éventuelle, pouls global. Pour « quoi de neuf ? ». Pas pour une question sur un seul outil.",
    inputSchema: S(),
    routes: [{ method: 'POST', path: '/api/livinglayer/board' }],
    run: async (ctx) => {
      const data = await ctx.call('/api/livinglayer/board', { method: 'POST', body: { preferMode: 'calculator', clientSensors: {} } });
      const m = (data && data.metrics) || {};
      const n = (v) => (typeof v === 'number' && isFinite(v)) ? v : 0;
      const a_traiter = [];
      if (n(m.sitesDown) > 0)        a_traiter.push({ pad: 'Sentinel', signal: `${m.sitesDown} site(s) hors ligne` });
      if (n(m.socialFailed24h) > 0)  a_traiter.push({ pad: 'Social Manager', signal: `${m.socialFailed24h} publication(s) à reprendre` });
      if (n(m.gapsOpen) > 0)         a_traiter.push({ pad: 'Smart Agent', signal: `${m.gapsOpen} trou(s) de savoir à combler` });
      if (n(m.remindersToday) > 0)   a_traiter.push({ pad: 'Keynapse', signal: `${m.remindersToday} rappel(s) aujourd'hui` });
      if (n(m.keyform24h) > 0)       a_traiter.push({ pad: 'Key Form', signal: `${m.keyform24h} nouvelle(s) réponse(s) depuis hier` });
      if (n(m.deskInbox) > 0)        a_traiter.push({ pad: 'desK', signal: `${m.deskInbox} contribution(s) dans le bac` });
      if (n(m.deskOverdue) > 0)      a_traiter.push({ pad: 'desK', signal: `${m.deskOverdue} copie(s) en retard` });
      if (typeof m.deskBouclageDays === 'number' && m.deskBouclageDays >= 0 && m.deskBouclageDays <= 3)
        a_traiter.push({ pad: 'desK', signal: `bouclage dans ${m.deskBouclageDays} jour(s)` });
      let alerte = null;
      if (n(m.sitesDown) > 0)            alerte = `${m.sitesDown} site(s) hors ligne — à vérifier dans Sentinel.`;
      else if (n(m.socialFailed24h) > 0) alerte = `${m.socialFailed24h} publication(s) non aboutie(s) — à reprendre dans Social Manager.`;
      const pouls = {};
      if (n(m.sitesTotal) > 0)        pouls.sites_en_ligne = `${n(m.sitesTotal) - n(m.sitesDown)}/${m.sitesTotal}`;
      if (n(m.scans7d) > 0)           pouls.scans_qr_7j = m.scans7d;
      if (n(m.formsPublished) > 0)    pouls.formulaires_publies = m.formsPublished;
      if (n(m.socialConnected) > 0)   pouls.reseaux_connectes = m.socialConnected;
      if (n(m.keybrandPublished) > 0) pouls.chartes_publiees = m.keybrandPublished;
      if (n(m.agentKnowledge) > 0)    pouls.fiches_savoir = m.agentKnowledge;
      if (n(m.keynapseNotes) > 0)     pouls.notes_keynapse = m.keynapseNotes;
      if (typeof m.ghostQuota === 'number' && m.ghostQuota > 0) pouls.ecriture_ia = `${n(m.ghostUsed)}/${m.ghostQuota}`;
      const rien = a_traiter.length === 0 && !alerte;
      return { a_traiter, alerte, pouls, rien_a_signaler: rien };
    },
  },

  /* ═══ SMART DYNAMIC QR (lecture seule — jamais /r/, jamais les redirections) ═══ */
  {
    name: 'keystone_qr_list', title: 'Mes QR codes',
    description: "La flotte Smart Dynamic QR : nom, type (url, vcard, wifi…), mode (statique, dynamique, smart), statut, dossier, scans totaux, destination.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/qr' }],
    run: async (ctx) => {
      const data = await ctx.call('/api/qr');
      const qrs = data.qrs || [];
      const out = {
        total: qrs.length,
        actifs: qrs.filter(q => (q.status || 'active') === 'active').length,
        qrs: qrs.map(q => ({ id: q.id, nom: q.name || '(sans nom)', type: q.qr_type || 'url',
          mode: q.mode || 'dynamic', statut: q.status || 'active', dossier: q.folder || null,
          scans: q.mode === 'static' ? null : (q.scans_total || 0),
          destination: q.target_url || q.payload?.url || null, cree_le: iso(q.created_at) })),
      };
      if (qrs.some(q => q.mode === 'static')) out.note = 'Les QR statiques ne suivent pas les scans (par conception).';
      return out;
    },
  },
  {
    name: 'keystone_qr_overview', title: 'Scans de tous mes QR',
    description: "Vue d'ensemble des scans : total, visiteurs uniques, aujourd'hui, cette semaine, classement des meilleurs QR, points à surveiller. period : 7d, 30d, 90d ou all (défaut 7d).",
    inputSchema: S({ period: str('7d | 30d | 90d | all (défaut 7d)') }),
    routes: [{ method: 'GET', path: '/api/qr/overview' }],
    run: async (ctx, args) => {
      const period = ['7d', '30d', '90d', 'all'].includes(args.period) ? args.period : '7d';
      const data = await ctx.call(`/api/qr/overview?period=${period}`);
      const t = data.totals || {};
      const today = todayIso();
      const TREND = { up: 'en hausse', down: 'en baisse', flat: 'stable' };
      const out = {
        periode: period, scans: t.scans_total || 0, visiteurs_uniques: t.unique || 0,
        qr_total: t.qr_total || 0, qr_actifs: t.qr_active || 0,
        aujourdhui: (data.byDay || []).find(d => d.day === today)?.cnt || 0,
        cette_semaine: t.week || 0,
        classement: (data.leaderboard || []).map(l => ({ nom: l.name, scans: l.scans, tendance: TREND[l.trend] || 'stable' })),
        a_surveiller: (data.watch || []).map(w => `${w.name} : ${w.note}`),
      };
      /* en 7d le filtre exclut la semaine précédente → delta mécaniquement +100 % : on le tait */
      out.evolution_semaine_pct = period !== '7d' ? (t.week_delta ?? null) : null;
      return out;
    },
  },
  {
    name: 'keystone_qr_stats', title: "Statistiques d'un QR",
    description: "Les stats détaillées d'un QR retrouvé par son nom (même partiel) : scans aujourd'hui / semaine / total, visiteurs uniques, meilleur créneau (heure UTC), pays, appareils. period : 7d, 30d, 90d, all (défaut 30d).",
    inputSchema: S({ name: str('nom (même partiel) du QR'), period: str('7d | 30d | 90d | all (défaut 30d)') }, ['name']),
    routes: [{ method: 'GET', path: '/api/qr' }, { method: 'GET', path: '/api/qr/:id/stats' }],
    run: async (ctx, args) => {
      const { qrs } = await ctx.call('/api/qr');
      const q = resolveByName(qrs || [], args.name, {
        what: 'QR', soloOk: false, empty: 'Aucun QR dans la flotte.',
        label: (x) => (x.name || '(sans nom)') + (x.folder ? ` (dossier ${x.folder})` : ''),
        names: (x) => [x.name],
      });
      if (q.mode === 'static') return { qr: q.name, mode: 'statique', info: 'QR statique : aucun scan n’est suivi (par conception, RGPD natif).' };
      const period = ['7d', '30d', '90d', 'all'].includes(args.period) ? args.period : '30d';
      const s = await ctx.call(`/api/qr/${encodeURIComponent(q.id)}/stats?period=${period}`);
      const t = s.totals || {};
      let meilleur_creneau = null;
      if (Array.isArray(s.heatmap) && s.heatmap.length) {
        const best = s.heatmap.reduce((a, b) => (b.cnt > a.cnt ? b : a));
        if (best && best.cnt) {
          const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
          meilleur_creneau = { jour: JOURS[best.dow], heure_utc: best.hour, scans: best.cnt };
        }
      }
      return {
        qr: q.name, periode: period, scans: t.total || 0, visiteurs_uniques: t.unique || 0,
        aujourdhui: t.today || 0, cette_semaine: t.week || 0, meilleur_creneau,
        pays: (s.byCountry || []).slice(0, 5).map(c => ({ pays: c.country, scans: c.cnt })),
        appareils: (s.byDevice || []).map(d => ({ appareil: d.device, scans: d.cnt })),
        cree_le: iso(s.meta?.created_at), imprime_le: iso(s.meta?.printed_at),
      };
    },
  },

  /* ═══ SENTINEL ═══ */
  {
    name: 'keystone_sentinel_sites', title: 'Mes sites surveillés',
    description: "Les sites sous surveillance Sentinel : en ligne / hors ligne, disponibilité 24 h, temps de réponse, score d'audit global, date du dernier audit.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/sentinel/sites' }],
    run: async (ctx) => {
      const d = await ctx.call('/api/sentinel/sites');
      const sites = d.sites || [];
      if (!sites.length) return { total: 0, message: 'Aucun site surveillé pour l’instant.' };
      return {
        total: sites.length, limite_du_plan: d.limit ?? null,
        sites: sites.map(s => ({
          nom: s.label || host(s.url), url: s.url,
          plateforme: ({ wix: 'Wix', wordpress: 'WordPress', custom: 'sur-mesure' })[s.platform] || null,
          en_ligne: s.last_checked_at ? (s.last_ok === 1 || s.last_ok === true) : null,
          disponibilite_24h_pct: s.uptime24h ?? null, temps_reponse_ms: s.last_ms ?? null,
          verifie_le: iso(s.last_checked_at), pannes_consecutives: s.consecutive_fails || 0,
          score_audit: s.last_score ?? null, audit_le: iso(s.last_audit_at),
        })),
      };
    },
  },
  {
    name: 'keystone_sentinel_report', title: "Rapport d'un site",
    description: "Le rapport Sentinel d'un site : score global et par axe (SEO, sécurité, performance, disponibilité…), points à corriger priorisés, visibilité IA, tendances. site : nom ou adresse (même partiels) ; inutile si un seul site.",
    inputSchema: S({ site: str('nom ou adresse (même partiels) ; facultatif si un seul site') }),
    routes: [{ method: 'GET', path: '/api/sentinel/sites' }, { method: 'GET', path: '/api/sentinel/sites/:id/cockpit' }],
    run: async (ctx, args) => {
      const d = await ctx.call('/api/sentinel/sites');
      const site = resolveByName(d.sites || [], args.site, {
        what: 'site', empty: 'Aucun site surveillé — ajoute d’abord ton site dans Sentinel.',
        label: (s) => s.label || host(s.url), names: (s) => [s.label, host(s.url), s.url],
      });
      const { cockpit: c } = await ctx.call(`/api/sentinel/sites/${encodeURIComponent(site.id)}/cockpit`);
      const a = c.audit;
      const out = {
        site: site.label || host(site.url), url: site.url,
        en_ligne: c.site.last_checked_at ? (c.site.last_ok === 1 || c.site.last_ok === true) : null,
        verifie_le: iso(c.site.last_checked_at), disponibilite_30j_pct: c.uptime30d ?? null,
        tendance_disponibilite: c.uptimeTrend || 'stable', https: !!(c.ssl && c.ssl.https),
      };
      if (!a) { out.audit = null; out.message = 'Ce site n’a pas encore été audité.'; return out; }
      out.score_global = a.score ?? null;
      out.evolution_7j_pts = c.scoreTrend ?? null;
      out.audit_le = iso(a.created_at);
      const AXES = { disponibilite: 'Disponibilité', performance: 'Performance', seo: 'SEO technique',
                     securite: 'Sécurité', accessibilite: 'Accessibilité', presence: 'Présence locale', keywords: 'Mots-clés' };
      out.axes = {};
      for (const [k, label] of Object.entries(AXES)) if (a.scores && a.scores[k] != null) out.axes[label] = a.scores[k];
      const ORD = { high: 0, medium: 1, low: 2 };
      out.points_a_corriger = (a.findings || []).slice().sort((x, y) => (ORD[x.sev] ?? 3) - (ORD[y.sev] ?? 3)).slice(0, 8)
        .map(f => ({ gravite: f.sev, axe: AXES[f.axis] || f.axis, probleme: f.title, conseil: excerpt(f.detail, 200) }));
      const restants = (a.findings || []).length - out.points_a_corriger.length;
      if (restants > 0) out.points_a_corriger_en_plus = restants;
      if (c.geo && c.geo.configured && c.geo.score != null) out.visibilite_ia = { score: c.geo.score, releve_le: iso(c.geo.run_at) };
      if (c.gsc && c.gsc.connected && c.gsc.score != null) out.mots_cles_google = { score: c.gsc.score, releve_le: iso(c.gsc.run_at) };
      return out;
    },
  },

  /* ═══ KEYNAPSE ═══ */
  {
    name: 'keystone_keynapse_search', title: 'Chercher dans mes notes',
    description: "Cherche un mot-clé dans le titre ou le texte des bulles Keynapse : zone, extrait, date de modification.",
    inputSchema: S({ query: str('mot ou expression à chercher') }, ['query']),
    routes: [{ method: 'GET', path: '/api/keynapse/state' }],
    run: async (ctx, args) => {
      const q = String(args.query || '').trim();
      if (!q) throw new Error('Il faut un mot-clé à chercher.');
      const { zones, bubbles } = await ctx.call('/api/keynapse/state');
      const n = norm(q);
      const zoneName = id => (zones || []).find(z => z.id === id)?.name || null;
      const hits = (bubbles || []).filter(b => norm(b.title).includes(n) || norm(b.description).includes(n));
      if (!hits.length) return { trouve: 0, message: `Rien trouvé pour « ${q} ».` };
      return {
        trouve: hits.length,
        notes: hits.slice(0, 12).map(b => ({ id: b.id, titre: b.title, zone: zoneName(b.zone_id),
          extrait: b.description ? excerpt(b.description, 200) : null, modifie_le: iso(b.updated_at) })),
        en_plus: hits.length > 12 ? hits.length - 12 : undefined,
      };
    },
  },
  {
    name: 'keystone_keynapse_reminders', title: 'Mes rappels',
    description: "Les rappels posés sur des notes Keynapse : à venir et en retard, avec la note, l'échéance et la répétition.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/keynapse/reminders' }],
    run: async (ctx) => {
      const { reminders } = await ctx.call('/api/keynapse/reminders');
      const list = reminders || [];
      if (!list.length) return { total: 0, message: 'Aucun rappel posé dans Keynapse.' };
      const now = Date.now();
      const shaped = list.map(r => ({ note: r.bubble_title, libelle: r.label || null, echeance: iso(r.at),
        en_retard: !r.notified_at && (ms(r.at) || 0) < now, repetition: r.repeat || null }));
      return { total: shaped.length, en_retard: shaped.filter(r => r.en_retard).length, rappels: shaped.slice(0, 20) };
    },
  },
  {
    name: 'keystone_keynapse_bubble', title: 'Lire une note',
    description: "Le détail d'une bulle Keynapse retrouvée par son titre (même partiel) : zone, texte, tâches faites/restantes, notes libres, médias, rappels.",
    inputSchema: S({ title: str('titre (même partiel) de la bulle') }, ['title']),
    routes: [{ method: 'GET', path: '/api/keynapse/state' }, { method: 'GET', path: '/api/keynapse/bubbles/:id' }],
    run: async (ctx, args) => {
      const { zones, bubbles } = await ctx.call('/api/keynapse/state');
      const b = resolveByName(bubbles || [], args.title, { what: 'note', soloOk: false, empty: 'Aucune note dans Keynapse.', label: (x) => x.title });
      const d = await ctx.call(`/api/keynapse/bubbles/${encodeURIComponent(b.id)}`);
      const todos = d.todos || [];
      return {
        id: b.id, titre: d.bubble.title, zone: (zones || []).find(z => z.id === b.zone_id)?.name || null,
        texte: d.bubble.description ? excerpt(d.bubble.description, 600) : null,
        taches: todos.length ? { faites: todos.filter(t => t.done).length, total: todos.length,
          restantes: todos.filter(t => !t.done).map(t => t.label).slice(0, 10) } : null,
        notes_libres: (d.notes || []).slice(0, 5).map(x => excerpt(x.body, 300)),
        photos_dessins: (d.media || []).length, memos_vocaux: (d.audios || []).length,
        rappels: (d.reminders || []).map(r => ({ echeance: iso(r.at), libelle: r.label || null })),
        modifie_le: iso(d.bubble.updated_at),
      };
    },
  },

  /* ═══ SMART AGENT ═══ */
  {
    name: 'keystone_smartagent_agents', title: 'Mes jumeaux Smart Agent',
    description: "Les jumeaux de savoir-faire : nom, statut (en ligne, en pause, brouillon), mission, trous de savoir ouverts (total et cette semaine).",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/smart-agent/agents' }],
    run: async (ctx) => {
      const { agents } = await ctx.call('/api/smart-agent/agents');
      if (!agents.length) return { total: 0, message: 'Aucun jumeau créé pour l’instant.' };
      const ST = { published: 'en ligne', paused: 'en pause', draft: 'brouillon' };
      return { total: agents.length, jumeaux: agents.map(a => ({ id: a.id, nom: a.name, statut: ST[a.status] || a.status,
        mission: a.config?.identity?.mission ? excerpt(a.config.identity.mission, 200) : null,
        trous_ouverts: a.gaps_open || 0, trous_semaine: a.gaps_week || 0 })) };
    },
  },
  {
    name: 'keystone_smartagent_gaps', title: "Trous de savoir d'un jumeau",
    description: "Les questions auxquelles un jumeau n'a pas su répondre : fréquence, récence. name : nom (même partiel) du jumeau ; inutile si un seul.",
    inputSchema: S({ name: str('nom (même partiel) du jumeau ; facultatif si un seul') }),
    routes: [{ method: 'GET', path: '/api/smart-agent/agents' }, { method: 'GET', path: '/api/smart-agent/gaps' }],
    run: async (ctx, args) => {
      const agent = await saResolve(ctx, args.name);
      const { gaps } = await ctx.call(`/api/smart-agent/gaps?agent=${encodeURIComponent(agent.id)}`);
      if (!gaps.length) return { jumeau: agent.name, total: 0, message: 'Aucun trou ouvert.' };
      const now = Date.now();
      const shaped = gaps.map(g => ({ question: g.question, demandee: g.hits,
        recente_7j: (ms(g.last_asked_at) || 0) >= now - 7 * 86400e3, derniere_fois: iso(g.last_asked_at) }));
      return { jumeau: agent.name, total: shaped.length, cette_semaine: shaped.filter(g => g.recente_7j).length,
        trous: shaped.slice(0, 15), en_plus: shaped.length > 15 ? shaped.length - 15 : undefined };
    },
  },
  {
    name: 'keystone_smartagent_kortex_overview', title: "Coffre de savoir d'un jumeau",
    description: "Combien de fiches dans le coffre Kortex d'un jumeau, par statut et par type. name : nom (même partiel) ; inutile si un seul.",
    inputSchema: S({ name: str('nom (même partiel) du jumeau ; facultatif si un seul') }),
    routes: [{ method: 'GET', path: '/api/smart-agent/agents' }, { method: 'GET', path: '/api/smart-agent/kortex/units' }],
    run: async (ctx, args) => {
      const agent = await saResolve(ctx, args.name);
      const { units, counts } = await ctx.call(`/api/smart-agent/kortex/units?agent=${encodeURIComponent(agent.id)}`);
      if (!counts?.total) return { jumeau: agent.name, total: 0, message: 'Coffre vide.' };
      const parType = {};
      for (const u of (units || [])) parType[u.type] = (parType[u.type] || 0) + 1;
      const out = { jumeau: agent.name, total: counts.total, validees: counts.validated, brouillon: counts.draft,
        quarantaine: counts.quarantine, perimees: counts.expired, par_type: parType };
      if ((units || []).length < counts.total) out.note = 'Détail par type limité aux 500 dernières fiches.';
      return out;
    },
  },
  {
    name: 'keystone_smartagent_kortex_search', title: 'Chercher dans le savoir d’un jumeau',
    description: "Recherche (lexicale + sémantique) dans les fiches validées d'un jumeau et renvoie les meilleures fiches. query : 2 à 500 caractères. name : nom (même partiel) du jumeau ; inutile si un seul.",
    inputSchema: S({ query: str('question ou mots-clés (2 à 500 caractères)'), name: str('nom (même partiel) du jumeau ; facultatif si un seul'), topk: int('nombre de fiches (1 à 20, défaut 6)') }, ['query']),
    routes: [{ method: 'GET', path: '/api/smart-agent/agents' }, { method: 'GET', path: '/api/smart-agent/kortex/search' }],
    run: async (ctx, args) => {
      const q = String(args.query || '').trim();
      if (q.length < 2) throw new Error('Question trop courte.');
      const agent = await saResolve(ctx, args.name);
      const topk = clampInt(args.topk, 1, 20, 6);
      const d = await ctx.call(`/api/smart-agent/kortex/search?agent=${encodeURIComponent(agent.id)}&q=${encodeURIComponent(q.slice(0, 500))}&topk=${topk}`);
      const hits = d.results || d.hits || d.units || [];
      return { jumeau: agent.name, trouve: hits.length,
        fiches: hits.slice(0, topk).map(u => ({ id: u.id, type: u.type, titre: u.title, extrait: excerpt(u.body_text || u.text || u.snippet, 400), score: u.score ?? null })) };
    },
  },
  {
    name: 'keystone_smartagent_public_usage', title: "Usage du lien public d'un jumeau",
    description: "Le lien public d'un jumeau publié : questions posées aujourd'hui et au total, plafond, échéance. name : nom (même partiel) ; inutile si un seul.",
    inputSchema: S({ name: str('nom (même partiel) du jumeau ; facultatif si un seul') }),
    routes: [{ method: 'GET', path: '/api/smart-agent/agents' }, { method: 'GET', path: '/api/smart-agent/agents/:id/links' }],
    run: async (ctx, args) => {
      const agent = await saResolve(ctx, args.name);
      if (agent.status !== 'published') return { jumeau: agent.name, publie: false, message: 'Ce jumeau n’est pas publié.' };
      const { links } = await ctx.call(`/api/smart-agent/agents/${encodeURIComponent(agent.id)}/links`);
      const active = (links || []).filter(l => l.status === 'active');
      if (!active.length) return { jumeau: agent.name, publie: true, message: 'Publié, mais aucun lien actif.' };
      return { jumeau: agent.name, publie: true, liens: active.map(l => ({ questions_aujourdhui: l.usage_today || 0,
        questions_total: l.usage_total || 0, plafond_jour: l.max_per_day, expire_le: iso(l.expires_at), url: l.url })) };
    },
  },

  /* ═══ desK ═══ */
  {
    name: 'keystone_desk_railroad', title: 'État du chemin de fer',
    description: "Où en est une revue desK : numéro en fabrication, jours avant bouclage, copies à relancer, contributions à trier. revue : nom (même partiel) ; inutile si une seule.",
    inputSchema: S({ revue: str('nom (même partiel) de la revue ; facultatif si une seule') }),
    routes: [{ method: 'GET', path: '/api/desk/bootstrap' }, { method: 'GET', path: '/api/desk/issue/:id' }],
    run: async (ctx, args) => {
      const { pub, pubs } = await dkResolvePub(ctx, args.revue);
      const cur = dkCurrentIssue(pub);
      if (!cur) return { revue: pub.name, message: 'Aucun numéro pour l’instant.' };
      const D = await ctx.call(`/api/desk/issue/${encodeURIComponent(cur.id)}`);
      const rules = await desk();
      const dues = rules.dkRelancesDues(D.articles || [], { contribs: D.contribs, relances: D.relances });
      const jal = dkJalons(cur.jalons);
      const jb = jal.bouclage ? Date.parse(jal.bouclage + 'T12:00:00Z') : NaN;
      return {
        revue: pub.name, numero: cur.num, theme: cur.theme || null, statut: cur.status,
        bouclage_le: jal.bouclage || null,
        bouclage_dans_jours: isNaN(jb) ? null : Math.round((jb - Date.now()) / 86400000),
        copies_a_relancer: dues.length, dont_en_retard: dues.filter(a => rules.dkLateDays(a) > 0).length,
        a_trier: (D.inbox || []).length,
        autres_revues: pubs.length > 1 ? pubs.filter(p => p.id !== pub.id).map(p => p.name) : undefined,
      };
    },
  },
  {
    name: 'keystone_desk_issue', title: "Sommaire d'un numéro",
    description: "Le sommaire d'un numéro desK : articles attendus / remis / relus, pages (folio réel), contributeur. revue facultative si une seule ; numero facultatif (défaut : le numéro en fabrication).",
    inputSchema: S({ revue: str('nom (même partiel) de la revue'), numero: str('n° visé ; défaut : numéro en fabrication') }),
    routes: [{ method: 'GET', path: '/api/desk/bootstrap' }, { method: 'GET', path: '/api/desk/issue/:id' }],
    run: async (ctx, args) => {
      const { pub } = await dkResolvePub(ctx, args.revue);
      let issue = null;
      if (args.numero != null && String(args.numero).trim())
        issue = (pub.issues || []).find(i => String(i.num) === String(args.numero).trim());
      issue = issue || dkCurrentIssue(pub);
      if (!issue) return { revue: pub.name, message: 'Aucun numéro à afficher.' };
      const D = await ctx.call(`/api/desk/issue/${encodeURIComponent(issue.id)}`);
      const rules = await desk();
      const placed = new Set((D.slots || []).map(s => s.art_id).filter(Boolean));
      const arts = (D.articles || []).filter(a => placed.has(a.id) && a.status !== 'abandonne');
      const items = arts.map(a => ({ id: a.id, titre: a.title, contributeur: a.contrib || null, statut: a.status,
        pages: dkPagesOf(rules, a.id, D, pub), attend_la_copie: rules.dkNeedsCopy(a.status) }));
      return { revue: pub.name, numero: issue.num, theme: issue.theme || null, statut: issue.status,
        articles_places: items.length, copies_attendues: items.filter(i => i.attend_la_copie).length, sommaire: items };
    },
  },
  {
    name: 'keystone_desk_relances', title: 'Copies à relancer',
    description: "Les contributeurs desK dont la copie est attendue et qu'il est temps de relancer (échéance + retard habituel, jamais une relance déjà envoyée récemment). revue facultative si une seule.",
    inputSchema: S({ revue: str('nom (même partiel) de la revue ; facultatif si une seule') }),
    routes: [{ method: 'GET', path: '/api/desk/bootstrap' }, { method: 'GET', path: '/api/desk/issue/:id' }],
    run: async (ctx, args) => {
      const { pub } = await dkResolvePub(ctx, args.revue);
      const cur = dkCurrentIssue(pub);
      if (!cur) return { revue: pub.name, total: 0, message: 'Aucun numéro en cours.' };
      const D = await ctx.call(`/api/desk/issue/${encodeURIComponent(cur.id)}`);
      const rules = await desk();
      const dues = rules.dkRelancesDues(D.articles || [], { contribs: D.contribs, relances: D.relances });
      if (!dues.length) return { revue: pub.name, numero: cur.num, total: 0, message: 'Rien à relancer.' };
      return { revue: pub.name, numero: cur.num, total: dues.length,
        a_relancer: dues.map(a => {
          const ri = rules.dkRelanceInfo(a, { contribs: D.contribs, relances: D.relances });
          const late = rules.dkLateDays(a);
          return { article: a.title, contributeur: a.contrib || null, pages: dkPagesOf(rules, a.id, D, pub),
            retard_jours: late > 0 ? late : 0, type: ri && ri.mode === 'avant' ? 'rappel avant échéance' : 'copie en retard', email_connu: !!(ri && ri.email) };
        }),
        note: 'L’envoi d’une relance reste le geste de la rédactrice.' };
    },
  },
  {
    name: 'keystone_desk_inbox', title: 'Bac à trier',
    description: "Les contributions arrivées par e-mail dans desK qui attendent d'être rattachées à un article. revue facultative si une seule.",
    inputSchema: S({ revue: str('nom (même partiel) de la revue ; facultatif si une seule') }),
    routes: [{ method: 'GET', path: '/api/desk/bootstrap' }, { method: 'GET', path: '/api/desk/issue/:id' }],
    run: async (ctx, args) => {
      const { pub } = await dkResolvePub(ctx, args.revue);
      const cur = dkCurrentIssue(pub);
      if (!cur) return { revue: pub.name, total: 0, message: 'Aucun numéro en cours.' };
      const D = await ctx.call(`/api/desk/issue/${encodeURIComponent(cur.id)}`);
      const inbox = D.inbox || [];
      if (!inbox.length) return { revue: pub.name, total: 0, message: 'Le bac est vide.' };
      return { revue: pub.name, total: inbox.length,
        a_trier: inbox.slice(0, 30).map(m => ({ de: m.from_name || m.from_email, objet: m.subject || '(sans objet)',
          recu_le: iso(m.received_at), pieces_jointes: jsonArr(m.attachments).length })),
        en_plus: inbox.length > 30 ? inbox.length - 30 : undefined };
    },
  },

  /* ═══ SOCIAL MANAGER (lecture — publier n'existe pas ici) ═══ */
  {
    name: 'keystone_social_upcoming', title: 'Posts programmés',
    description: "Les publications Social Manager programmées dans la fenêtre donnée : date, réseaux visés, extrait. days : fenêtre en jours (défaut 7).",
    inputSchema: S({ days: int('fenêtre en jours (1 à 90, défaut 7)') }),
    routes: [{ method: 'GET', path: '/api/social/posts' }],
    run: async (ctx, args) => {
      const days = clampInt(args.days, 1, 90, 7);
      const data = await ctx.call('/api/social/posts?status=scheduled');
      const horizon = Date.now() + days * 86400e3;
      const posts = (data.posts || []).filter(p => p.scheduledAt && (ms(p.scheduledAt) || 0) <= horizon)
        .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
      return { fenetre_jours: days, total: posts.length,
        posts: posts.map(p => ({ id: p.id, quand: iso(p.scheduledAt), reseaux: p.targets || [], extrait: excerpt(p.excerpt, 200), medias: p.mediaCount || 0 })) };
    },
  },
  {
    name: 'keystone_social_recent', title: 'Dernières publications',
    description: "Les posts déjà publiés (ou en échec) : quand, statut par réseau, lien quand il existe. limit : nombre de posts (défaut 10).",
    inputSchema: S({ limit: int('nombre de posts (1 à 50, défaut 10)') }),
    routes: [{ method: 'GET', path: '/api/social/posts' }],
    run: async (ctx, args) => {
      const limit = clampInt(args.limit, 1, 50, 10);
      const data = await ctx.call('/api/social/posts');
      const posts = (data.posts || []).filter(p => p.status !== 'scheduled').slice(0, limit);
      return { total: posts.length, posts: posts.map(p => ({ id: p.id, statut: p.status, quand: iso(p.updatedAt || p.createdAt),
        extrait: excerpt(p.excerpt, 200), par_reseau: (p.results || []).map(r => ({ reseau: r.platform, statut: r.status, url: r.url || null, erreur: r.error || null })) })) };
    },
  },
  {
    name: 'keystone_social_accounts', title: 'Comptes sociaux connectés',
    description: "Les réseaux sociaux connectés à Social Manager : statut et échéance du jeton, avec alerte si elle approche (moins de 7 jours).",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/social/accounts' }],
    run: async (ctx) => {
      const data = await ctx.call('/api/social/accounts');
      const soon = Date.now() + 7 * 86400e3;
      return { total: (data.accounts || []).length, comptes: (data.accounts || []).map(a => ({ reseau: a.platform, nom: a.display_name || null,
        statut: a.status, expire_le: iso(a.expires_at), expire_bientot: !!(a.expires_at && (ms(a.expires_at) || 0) <= soon) })) };
    },
  },
  {
    name: 'keystone_social_insights', title: "Statistiques d'un post",
    description: "Les métriques d'un post publié, par réseau, quand la plateforme les fournit. id : identifiant du post (cf. keystone_social_recent).",
    inputSchema: S({ id: str('identifiant du post') }, ['id']),
    routes: [{ method: 'GET', path: '/api/social/posts/insights' }],
    run: async (ctx, args) => {
      if (!args.id) throw new Error('Identifiant du post requis.');
      const data = await ctx.call(`/api/social/posts/insights?id=${encodeURIComponent(args.id)}`);
      return { id: data.id, stats: data.insights || [] };
    },
  },
  {
    name: 'keystone_social_networks', title: 'Contraintes par réseau',
    description: "Capacités de chaque réseau social branché : longueur max, hashtags, médias, vidéo.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/social/registry' }],
    run: async (ctx) => {
      const data = await ctx.call('/api/social/registry', { auth: false });
      return { reseaux: (data.platforms || []).map(p => ({ id: p.id, nom: p.label, texte_max: p.text?.maxLength ?? null,
        hashtags_max: p.text?.maxHashtags ?? null, medias: !!p.media?.enabled, media_requis: !!p.media?.required, video: !!p.media?.videoEnabled })) };
    },
  },

  /* ═══ GHOST WRITER ═══ */
  {
    name: 'keystone_ghostwriter_quota', title: "Quota d'écriture IA",
    description: "Le quota Ghost Writer du compte : utilisé, plafond, restant, plan, période.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/ghostwriter/quota' }],
    run: async (ctx) => {
      const q = await ctx.call('/api/ghostwriter/quota');
      return { plan: q.plan || null, utilise: q.used ?? null, plafond: q.max ?? null, restant: q.remaining ?? null, illimite: !!q.unlimited, periode: q.period || null };
    },
  },

  /* ═══ KEY FORM (lecture stricte, jamais le contenu des réponses) ═══ */
  {
    name: 'keystone_keyform_forms', title: 'Mes formulaires',
    description: "Les formulaires Key Form : titre, statut (publié / brouillon / archivé), slug public si publié, dates. Lecture seule.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/pulsa/forms' }],
    run: async (ctx) => {
      const forms = await kfForms(ctx);
      if (!forms.length) return { total: 0, message: 'Aucun formulaire Key Form.' };
      const sorted = forms.slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
      return { total: sorted.length, formulaires: sorted.slice(0, 40).map(f => {
        const meta = f.meta || {}; const statut = kfStatut(f.output && f.output.status);
        const row = { id: f.id, titre: meta.title || '(sans titre)', statut, cree_le: iso(f.created_at), modifie_le: iso(f.updated_at) };
        if (statut === 'publié' && meta.slug) row.chemin_public = `/f/${meta.slug}`;
        return row;
      }) };
    },
  },
  {
    name: 'keystone_keyform_responses', title: "Réponses d'un formulaire",
    description: "Suivi des réponses d'un formulaire Key Form : total, aujourd'hui, hier, 7 jours, dernières dates. Jamais le contenu des réponses. form : titre (même partiel) ; inutile si un seul.",
    inputSchema: S({ form: str('titre (même partiel) du formulaire ; facultatif si un seul') }),
    routes: [{ method: 'GET', path: '/api/pulsa/forms' }, { method: 'GET', path: '/api/pulsa/responses' }],
    run: async (ctx, args) => {
      const forms = await kfForms(ctx);
      const form = resolveByName(forms, args.form, { what: 'formulaire', empty: 'Aucun formulaire Key Form.', label: (f) => (f.meta && f.meta.title) || '(sans titre)' });
      const data = await ctx.call(`/api/pulsa/responses?form_id=${encodeURIComponent(form.id)}`);
      const rows = Array.isArray(data.responses) ? data.responses : [];
      const total = typeof data.count === 'number' ? data.count : rows.length;
      const now = Date.now(), day = 86400e3;
      const startToday = Date.parse(todayIso() + 'T00:00:00Z');
      let auj = 0, hier = 0, sem = 0;
      for (const r of rows) {
        const t = ms(r.created_at); if (t == null) continue;
        if (t >= startToday) auj++; else if (t >= startToday - day) hier++;
        if (t >= now - 7 * day) sem++;
      }
      const out = { formulaire: (form.meta && form.meta.title) || '(sans titre)', statut: kfStatut(form.output && form.output.status),
        total, aujourdhui_utc: auj, hier_utc: hier, sept_derniers_jours: sem, dernieres_dates: rows.slice(0, 5).map(r => iso(r.created_at)) };
      if (!total) out.message = 'Aucune réponse reçue pour l’instant.';
      if (total === 500) out.note = 'Liste plafonnée à 500 côté serveur.';
      return out;
    },
  },

  /* ═══ KEY BRAND ═══ */
  {
    name: 'keystone_keybrand_charts', title: 'Mes chartes graphiques',
    description: "Les chartes Key Brand : nom, statut (brouillon / publiée), couleur principale, dernière modification, place restante.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/keybrand/charts' }],
    run: async (ctx) => {
      const { items, max } = await ctx.call('/api/keybrand/charts');
      if (!items?.length) return { total: 0, plafond: max, message: 'Aucune charte créée.' };
      return { total: items.length, plafond: max, place_restante: Math.max(0, (max || 0) - items.length),
        chartes: items.map(c => ({ id: c.id, nom: c.name, statut: c.status === 'published' ? 'publiée' : 'brouillon', couleur_principale: c.primary_hex || null, modifie_le: iso(c.updated_at) })) };
    },
  },
  {
    name: 'keystone_keybrand_chart', title: "Résumé d'une charte",
    description: "Le résumé d'une charte Key Brand : baseline, nombre de couleurs / typographies / variantes de logo, symbolique, lien public si publiée. name : nom (même partiel) ; inutile si une seule.",
    inputSchema: S({ name: str('nom (même partiel) de la charte ; facultatif si une seule') }),
    routes: [{ method: 'GET', path: '/api/keybrand/charts' }, { method: 'GET', path: '/api/keybrand/charts/:id' }],
    run: async (ctx, args) => {
      const { items } = await ctx.call('/api/keybrand/charts');
      const c = resolveByName(items || [], args.name, { what: 'charte', empty: 'Aucune charte créée.', label: (x) => x.name });
      const { chart } = await ctx.call(`/api/keybrand/charts/${encodeURIComponent(c.id)}`);
      const kit = chart.draft || {};
      const out = { id: chart.id, charte: chart.name, statut: chart.status === 'published' ? 'publiée' : 'brouillon',
        baseline: kit.meta?.baseline || null,
        couleurs: Array.isArray(kit.colors?.palette) ? kit.colors.palette : [],
        typographies: Array.isArray(kit.typography?.fonts) ? kit.typography.fonts.map(f => f.family || f.name || f).slice(0, 6) : [],
        variantes_logo: Array.isArray(kit.logo?.variants) ? kit.logo.variants.length : 0,
        symbolique: Array.isArray(kit.branding?.symbolism) ? kit.branding.symbolism.slice(0, 6) : [] };
      if (chart.status === 'published') {
        out.chemin_public = `/b/${chart.slug}`;
        out.acces = chart.access === 'code' ? 'protégé par code' : chart.access === 'public' ? 'public' : 'lien non répertorié';
      }
      return out;
    },
  },

  /* ═══ networK ═══ */
  {
    name: 'keystone_network_overview', title: 'Mon réseau',
    description: "La forme du réseau relationnel networK : nombre de contacts, répartition par catégorie, relances dues.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/network/bootstrap' }],
    run: async (ctx) => {
      const { categories, contacts } = await nkBoot(ctx);
      if (!contacts.length) return { total: 0, message: 'Réseau vide pour l’instant.' };
      const catById = new Map(categories.map(c => [c.id, c.label]));
      const byCat = {};
      for (const c of contacts) { const l = catById.get(c.category_id) || 'Sans catégorie'; byCat[l] = (byCat[l] || 0) + 1; }
      const today = todayIso();
      return { total: contacts.length,
        par_categorie: Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([categorie, n]) => ({ categorie, contacts: n })),
        relances_dues: contacts.filter(c => c.relance_at && c.relance_at <= today).length };
    },
  },
  {
    name: 'keystone_network_relances', title: 'Qui recontacter',
    description: "Les contacts networK à recontacter : relances dues ou en retard (date + motif), et combien arrivent dans les 7 jours.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/network/bootstrap' }],
    run: async (ctx) => {
      const { contacts } = await nkBoot(ctx);
      const today = todayIso(), week = plusDaysIso(7);
      const due = contacts.filter(c => c.relance_at && c.relance_at <= today).sort((a, b) => String(a.relance_at).localeCompare(String(b.relance_at)));
      const soon = contacts.filter(c => c.relance_at && c.relance_at > today && c.relance_at <= week).length;
      if (!due.length) return { total_dues: 0, a_venir_7j: soon, message: soon ? `Aucune relance due — ${soon} prévue(s) sous 7 jours.` : 'Aucune relance à faire.' };
      return { total_dues: due.length, a_venir_7j: soon,
        a_relancer: due.slice(0, 30).map(c => ({ id: c.id, nom: c.name, prevue_le: c.relance_at, en_retard: c.relance_at < today, motif: c.relance_note || null })) };
    },
  },
  {
    name: 'keystone_network_contact', title: "Fiche d'un contact",
    description: "La fiche d'un contact networK retrouvé par son nom (même partiel) : rôle, société, catégorie, tags, coordonnées, relance prévue, dernière interaction, journal récent.",
    inputSchema: S({ name: str('nom (même partiel) du contact') }, ['name']),
    routes: [{ method: 'GET', path: '/api/network/bootstrap' }],
    run: async (ctx, args) => {
      const boot = await nkBoot(ctx);
      const c = resolveByName(boot.contacts, args.name, { what: 'contact', soloOk: false, empty: 'Réseau vide.', label: (x) => x.name });
      const acts = boot.activity.filter(a => a.contact_id === c.id).sort((a, b) => String(b.happened_at).localeCompare(String(a.happened_at)));
      const out = { id: c.id, contact: c.name, type: c.kind || 'person', societe: c.company || null, fonction: c.title || null,
        categorie: (boot.categories.find(x => x.id === c.category_id) || {}).label || null,
        roles: jsonArr(c.roles), tags: jsonArr(c.tags),
        coordonnees: { email: c.email || null, telephone: c.phone || null, site: c.website || null },
        relance: c.relance_at ? { prevue_le: c.relance_at, motif: c.relance_note || null } : null,
        derniere_interaction: acts.length ? iso(acts[0].happened_at) : null,
        journal_recent: acts.slice(0, 8).map(a => ({ type: a.type, quoi: excerpt(a.label, 160), quand: iso(a.happened_at) })) };
      if (c.notes) out.notes = excerpt(c.notes, 400);
      return out;
    },
  },

  /* ═══════════════════════════════════════════════════════════════
     ÉCRITURES (sprint 3) — HANDOFF_MCP_CLAUDE §3.2 (directes), §3.3
     (à confirmation), Bannette (brief §2).
     · write:true    → annotations non « lecture seule », portée OAuth
                       keystone.write exigée par routes/mcp.js.
     · confirm:true  → ctx.confirm(args, aperçu) : 1er appel = aperçu +
                       confirm_token (5 min) ; 2e appel, mêmes arguments +
                       jeton = exécution unique. Le jeton est lié au compte,
                       à la connexion, à l'outil et aux arguments.
     · bannette:true → rien n'est exécuté ici : la proposition est déposée
                       (POST /api/mcp/inbox) et l'utilisateur l'applique
                       d'un clic dans Keystone (app/bannette.js).
     · gate:'X'      → hors catalogue tant que la variable Worker X n'est
                       pas 'on' (keystone_qr_create : décision de Stéphane
                       après gardien QR vert avant/après).
     Chaque écriture réussie rend `activite` (une ligne) : le ledger la
     garde pour le bandeau d'activité de l'onglet.
     Toujours des CRÉATIONS : jamais de modification, de suppression, de
     publication (lignes rouges §1 — le banc test-mcp-redlines le vérifie).
     ═══════════════════════════════════════════════════════════════ */

  /* ═══ KEYNAPSE ═══ */
  {
    name: 'keystone_keynapse_create_note', title: 'Créer une note Keynapse', write: true,
    description: "Crée une bulle Keynapse (titre + texte), dans une zone existante si précisée, avec un rappel facultatif. Toujours une nouvelle bulle : rien n'est écrasé. Pour « note-moi… », « crée une note avec le résumé… ».",
    inputSchema: S({ title: str('titre de la note (≤ 120 caractères)'), text: str('texte de la note (facultatif, ≤ 4000 caractères)'),
      zone: str('nom (même partiel) d’une zone existante ; facultatif'),
      reminder_at: str('rappel : date-heure ISO 8601 (facultatif)'), reminder_label: str('libellé du rappel (facultatif)') }, ['title']),
    routes: [{ method: 'GET', path: '/api/keynapse/state' }, { method: 'POST', path: '/api/keynapse/bubbles' }, { method: 'POST', path: '/api/keynapse/bubbles/:id/reminders' }],
    run: async (ctx, args) => {
      const title = String(args.title || '').trim().slice(0, 120);
      if (!title) throw new Error('Il faut un titre.');
      let zoneId = null, zoneName = null;
      if (args.zone) {
        const { zones } = await ctx.call('/api/keynapse/state');
        const z = resolveByName(zones || [], args.zone, { what: 'zone', soloOk: false, empty: 'Aucune zone dans Keynapse pour l’instant.', label: (x) => x.name });
        zoneId = z.id; zoneName = z.name;
      }
      const { bubble } = await ctx.call('/api/keynapse/bubbles', { method: 'POST', body: { title, description: String(args.text || '').slice(0, 4000), zone_id: zoneId } });
      const out = { fait: true, id: bubble.id, titre: bubble.title, zone: zoneName, cree_le: iso(bubble.created_at) || new Date().toISOString(),
        activite: `Note « ${excerpt(title, 60)} » créée dans Keynapse` };
      if (args.reminder_at) {
        const { reminder } = await ctx.call(`/api/keynapse/bubbles/${encodeURIComponent(bubble.id)}/reminders`, { method: 'POST', body: { at: String(args.reminder_at), label: args.reminder_label ? String(args.reminder_label) : null } });
        out.rappel = { echeance: iso(reminder.at), libelle: reminder.label || null };
      }
      return out;
    },
  },

  /* ═══ SENTINEL ═══ */
  {
    name: 'keystone_sentinel_add_site', title: 'Surveiller un site', write: true,
    description: "Ajoute un site à la surveillance Sentinel (disponibilité, audit). kind : 'local' (commerce, cabinet : téléphone et adresse attendus sur le site, défaut) ou 'online' (activité en ligne). Doublon refusé ; la limite du plan s'applique.",
    inputSchema: S({ url: str('adresse complète du site (https://…)'), label: str('nom court (facultatif)'), kind: str("'local' (défaut) ou 'online'") }, ['url']),
    routes: [{ method: 'POST', path: '/api/sentinel/sites' }],
    run: async (ctx, args) => {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('Adresse complète attendue (https://…).');
      const kind = args.kind === 'online' ? 'online' : 'local';
      const { site } = await ctx.call('/api/sentinel/sites', { method: 'POST', body: { url, label: args.label ? String(args.label).slice(0, 80) : '', kind } });
      const nom = site.label || host(site.url);
      return { fait: true, id: site.id, site: nom, url: site.url, plateforme: site.platform || null, nature: kind,
        en_ligne: site.last_ok === 1 || site.last_ok === true, temps_reponse_ms: site.last_ms ?? null,
        suite: 'Lance keystone_sentinel_run_audit pour obtenir un premier score.', activite: `Site ${nom} ajouté à Sentinel` };
    },
  },
  {
    name: 'keystone_sentinel_run_audit', title: 'Lancer un audit Sentinel', write: true,
    description: "Lance l'audit complet d'un site surveillé (SEO, sécurité, performance, présence) et rend le score et les points à corriger. Prend 10 à 30 s ; plafond de 10 audits par jour via l'assistant. site : nom ou adresse (même partiels) ; inutile si un seul site.",
    inputSchema: S({ site: str('nom ou adresse (même partiels) ; facultatif si un seul site') }),
    routes: [{ method: 'GET', path: '/api/sentinel/sites' }, { method: 'POST', path: '/api/sentinel/sites/:id/audit' }],
    run: async (ctx, args) => {
      const d = await ctx.call('/api/sentinel/sites');
      const site = resolveByName(d.sites || [], args.site, { what: 'site', empty: 'Aucun site surveillé — ajoute-le d’abord (keystone_sentinel_add_site).',
        label: (s) => s.label || host(s.url), names: (s) => [s.label, host(s.url), s.url] });
      if (ctx.quota) await ctx.quota('sentinel-audit', 10, 'audits Sentinel');
      const { audit } = await ctx.call(`/api/sentinel/sites/${encodeURIComponent(site.id)}/audit`, { method: 'POST' });
      const nom = site.label || host(site.url);
      const sev = { high: 3, medium: 2, low: 1 };
      const findings = Array.isArray(audit.findings) ? audit.findings.slice() : [];
      return { fait: true, site: nom, score: audit.score ?? null, axes: audit.scores || {},
        pages_auditees: Array.isArray(audit.pages) ? audit.pages.length : (audit.pages ?? null),
        a_corriger: findings.sort((a, b) => (sev[b.sev] || 0) - (sev[a.sev] || 0)).slice(0, 8)
          .map(f => ({ axe: f.axis, gravite: f.sev, quoi: f.title, detail: f.detail ? excerpt(f.detail, 160) : null })),
        activite: `Audit Sentinel lancé sur ${nom}` };
    },
  },

  /* ═══ networK ═══ */
  {
    name: 'keystone_network_add_contact', title: 'Ajouter un contact', write: true,
    description: "Ajoute un contact à networK (personne, société, lieu ou groupe) avec ses coordonnées, une catégorie existante, des étiquettes et une relance prévue. Doublon de nom refusé (utilise alors keystone_network_log_activity).",
    inputSchema: S({ name: str('nom du contact ou de la structure'), kind: str("type : person (défaut), company, place ou group"),
      company: str('société'), title: str('fonction'), email: str('e-mail'), phone: str('téléphone'), website: str('site web'),
      category: str('nom (même partiel) d’une catégorie existante ; facultatif'),
      tags: { type: 'array', items: { type: 'string' }, description: 'étiquettes (≤ 12)' },
      notes: str('notes libres'), relance_at: str('relance prévue : date AAAA-MM-JJ'), relance_note: str('motif de la relance') }, ['name']),
    routes: [{ method: 'GET', path: '/api/network/bootstrap' }, { method: 'POST', path: '/api/network/contact' }],
    run: async (ctx, args) => {
      const name = String(args.name || '').trim().slice(0, 200);
      if (!name) throw new Error('Il faut un nom.');
      const boot = await nkBoot(ctx);
      const dup = boot.contacts.find(c => norm(c.name) === norm(name));
      if (dup) throw new Error(`« ${dup.name} » existe déjà dans networK. Pour y ajouter une interaction : keystone_network_log_activity.`);
      let categoryId, categoryLabel = null;
      if (args.category) {
        const c = resolveByName(boot.categories, args.category, { what: 'catégorie', soloOk: false, empty: 'Aucune catégorie dans networK.', label: (x) => x.label });
        categoryId = c.id; categoryLabel = c.label;
      }
      const body = { name, kind: NK_KINDS.includes(args.kind) ? args.kind : 'person',
        company: args.company, title: args.title, email: args.email, phone: args.phone, website: args.website, category_id: categoryId,
        tags: Array.isArray(args.tags) ? args.tags.slice(0, 12).map(String) : undefined,
        notes: args.notes, relance_at: args.relance_at, relance_note: args.relance_note };
      const { contact } = await ctx.call('/api/network/contact', { method: 'POST', body });
      return { fait: true, id: contact.id, contact: contact.name, type: contact.kind, categorie: categoryLabel,
        relance: contact.relance_at ? { prevue_le: contact.relance_at, motif: contact.relance_note || null } : null,
        activite: `Contact ${contact.name} ajouté dans networK` };
    },
  },
  {
    name: 'keystone_network_log_activity', title: 'Noter une interaction', write: true,
    description: "Journalise une interaction avec un contact networK (appel, e-mail, rendez-vous, devis, document, note). contact : nom (même partiel) ; happened_at : date AAAA-MM-JJ, sinon maintenant.",
    inputSchema: S({ contact: str('nom (même partiel) du contact'), label: str('ce qui s’est passé, en une ligne'),
      type: str('call, email, meeting, quote, doc, note ou other (défaut)'), happened_at: str('date AAAA-MM-JJ (facultatif)') }, ['contact', 'label']),
    routes: [{ method: 'GET', path: '/api/network/bootstrap' }, { method: 'POST', path: '/api/network/activity' }],
    run: async (ctx, args) => {
      const label = String(args.label || '').trim().slice(0, 200);
      if (!label) throw new Error('Il faut un libellé.');
      const boot = await nkBoot(ctx);
      const c = resolveByName(boot.contacts, args.contact, { what: 'contact', soloOk: false, empty: 'Réseau vide — ajoute d’abord le contact.', label: (x) => x.name });
      const type = NK_ACT_TYPES.includes(args.type) ? args.type : 'other';
      const { activity } = await ctx.call('/api/network/activity', { method: 'POST', body: { contact_id: c.id, label, type, happened_at: args.happened_at } });
      return { fait: true, id: activity.id, contact: c.name, type: activity.type, quoi: activity.label, quand: iso(activity.happened_at),
        activite: `Interaction notée pour ${c.name} dans networK` };
    },
  },

  /* ═══ desK ═══ */
  {
    name: 'keystone_desk_create_publication', title: 'Créer une revue desK', write: true,
    description: "Crée une publication (revue) dans desK, avec ses rubriques par défaut ; le numéro, les dates de bouclage et l'équipe se règlent ensuite dans l'application. Doublon de nom refusé.",
    inputSchema: S({ name: str('nom de la revue') }, ['name']),
    routes: [{ method: 'GET', path: '/api/desk/bootstrap' }, { method: 'POST', path: '/api/desk/publication' }],
    run: async (ctx, args) => {
      const name = String(args.name || '').trim().slice(0, 120);
      if (!name) throw new Error('Il faut un nom de revue.');
      const boot = await ctx.call('/api/desk/bootstrap');
      if ((boot.publications || []).some(p => norm(p.name) === norm(name))) throw new Error(`La revue « ${name} » existe déjà dans desK.`);
      const { publication } = await ctx.call('/api/desk/publication', { method: 'POST', body: { name } });
      return { fait: true, id: publication.id, revue: publication.name,
        suite: 'Dans desK : crée le premier numéro (dates de bouclage), invite l’équipe, ajuste les rubriques.',
        activite: `Revue « ${excerpt(name, 60)} » créée dans desK` };
    },
  },

  /* ═══ SMART AGENT (à confirmation) ═══ */
  {
    name: 'keystone_smartagent_kortex_add_unit', title: 'Ajouter une fiche de savoir', write: true, confirm: true,
    description: "Ajoute une fiche de savoir au coffre privé d'un jumeau Smart Agent. À CONFIRMER : le premier appel rend un aperçu et un confirm_token ; le second, mêmes arguments + jeton, écrit. status 'draft' (défaut) attend la validation dans l'application ; 'validated' change tout de suite ce que le jumeau public répond.",
    inputSchema: S({ agent: str('nom (même partiel) du jumeau ; facultatif si un seul'),
      type: str('type de fiche : fact, procedure, qa, case, rule, objection ou definition'), title: str('titre de la fiche'),
      body: { type: 'object', additionalProperties: true, description: "champs selon le type — fact:{statement,context?} · procedure:{goal,steps[],warnings?} · qa:{question,answer} · case:{situation,action,result} · rule:{rule,rationale?,exceptions?} · objection:{objection,response,proof?} · definition:{term,definition}" },
      status: str("'draft' (défaut) ou 'validated'"), confirm_token: str('jeton rendu par l’aperçu ; absent au premier appel') }, ['type', 'title', 'body']),
    routes: [{ method: 'GET', path: '/api/smart-agent/agents' }, { method: 'POST', path: '/api/smart-agent/kortex/units' }],
    run: async (ctx, args) => {
      const type = String(args.type || '').trim();
      if (!KORTEX_TYPES.includes(type)) throw new Error(`Type inconnu « ${type} ». Types : ${KORTEX_TYPES.join(', ')}.`);
      const title = String(args.title || '').trim().slice(0, 200);
      if (!title) throw new Error('Il faut un titre.');
      const body = (args.body && typeof args.body === 'object' && !Array.isArray(args.body)) ? args.body : null;
      if (!body) throw new Error('body doit être un objet selon le gabarit du type.');
      const status = args.status === 'validated' ? 'validated' : 'draft';
      const agent = await saResolve(ctx, args.agent);
      const pending = await ctx.confirm(args, {
        action: `Ajouter la fiche « ${excerpt(title, 80)} » (${type}, ${status === 'validated' ? 'validée : le jumeau public s’en servira aussitôt' : 'brouillon : à valider dans Smart Agent'}) au jumeau ${agent.name}`,
        jumeau: agent.name, type, titre: title, statut: status, champs: body,
      });
      if (pending) return pending;
      const { unit } = await ctx.call('/api/smart-agent/kortex/units', { method: 'POST', body: { agent_id: agent.id, type, title, body, status, source_kind: 'manual', source_ref: 'assistant (MCP)' } });
      return { fait: true, id: unit.id, jumeau: agent.name, type: unit.type, titre: unit.title, statut: unit.status,
        activite: `Fiche « ${excerpt(unit.title, 60)} » ajoutée au jumeau ${agent.name}` };
    },
  },

  /* ═══ KEY BRAND (à confirmation) ═══ */
  {
    name: 'keystone_keybrand_create_chart', title: 'Créer une charte', write: true, confirm: true,
    description: "Crée une charte graphique Key Brand (brouillon vide, à compléter dans l'application : couleurs, typographies, logos). À CONFIRMER : aperçu + confirm_token, puis exécution. Doublon de nom refusé.",
    inputSchema: S({ name: str('nom de la charte (marque)'), baseline: str('baseline / signature (facultatif)'), confirm_token: str('jeton rendu par l’aperçu ; absent au premier appel') }, ['name']),
    routes: [{ method: 'GET', path: '/api/keybrand/charts' }, { method: 'POST', path: '/api/keybrand/charts' }],
    run: async (ctx, args) => {
      const name = String(args.name || '').trim().slice(0, 80);
      if (!name) throw new Error('Il faut un nom de charte.');
      const { items, max } = await ctx.call('/api/keybrand/charts');
      if ((items || []).some(c => norm(c.name) === norm(name))) throw new Error(`La charte « ${name} » existe déjà.`);
      const baseline = args.baseline ? String(args.baseline).slice(0, 200) : null;
      const pending = await ctx.confirm(args, { action: `Créer la charte « ${name} »${baseline ? ` (baseline : ${excerpt(baseline, 80)})` : ''} — brouillon vide à compléter dans Key Brand`,
        nom: name, baseline, place_restante: max != null ? Math.max(0, max - (items || []).length) : null });
      if (pending) return pending;
      const meta = baseline ? { name, baseline } : { name };
      const { chart } = await ctx.call('/api/keybrand/charts', { method: 'POST', body: { name, draft: { meta } } });
      return { fait: true, id: chart.id, charte: chart.name, statut: 'brouillon', suite: 'Complète couleurs, typographies et logos dans Key Brand.',
        activite: `Charte « ${name} » créée dans Key Brand` };
    },
  },

  /* ═══ SMART DYNAMIC QR (à confirmation, HORS CATALOGUE tant que MCP_QR_CREATE ≠ 'on') ═══ */
  {
    name: 'keystone_qr_create', title: 'Créer un QR code', write: true, confirm: true, gate: 'MCP_QR_CREATE',
    description: "Crée un QR code URL dans Smart Dynamic QR (dynamique par défaut : traçable, cible modifiable dans l'application). À CONFIRMER : aperçu + confirm_token. Création seulement — jamais de modification, de suppression ni de redirection d'un QR existant.",
    inputSchema: S({ name: str('nom du QR'), url: str('adresse cible (https://…)'), mode: str("'dynamic' (défaut) ou 'static'"),
      tags: { type: 'array', items: { type: 'string' }, description: 'étiquettes (≤ 12)' }, confirm_token: str('jeton rendu par l’aperçu ; absent au premier appel') }, ['name', 'url']),
    routes: [{ method: 'GET', path: '/api/qr' }, { method: 'POST', path: '/api/qr' }],
    run: async (ctx, args) => {
      const name = String(args.name || '').trim().slice(0, 80);
      const url = String(args.url || '').trim();
      if (!name) throw new Error('Il faut un nom.');
      if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('Adresse cible complète attendue (https://…).');
      const mode = args.mode === 'static' ? 'static' : 'dynamic';
      const { qrs } = await ctx.call('/api/qr');
      if ((qrs || []).some(q => norm(q.name) === norm(name))) throw new Error(`Un QR « ${name} » existe déjà.`);
      const pending = await ctx.confirm(args, { action: `Créer le QR « ${name} » (${mode === 'dynamic' ? 'dynamique, traçable' : 'statique'}) vers ${url}`, nom: name, cible: url, mode });
      if (pending) return pending;
      const { qr } = await ctx.call('/api/qr', { method: 'POST', body: { name, type: 'url', mode, payload: { url }, tags: Array.isArray(args.tags) ? args.tags.slice(0, 12).map(String) : [] } });
      return { fait: true, id: qr.id, nom: qr.name, mode: qr.mode, cible: qr.target_url || url, short_id: qr.short_id || null,
        suite: 'Le visuel se télécharge depuis Smart Dynamic QR.', activite: `QR « ${name} » créé dans Smart Dynamic QR` };
    },
  },

  /* ═══ BANNETTE — écritures navigateur, déposées, jamais exécutées ici ═══ */
  {
    name: 'keystone_social_draft_post', title: 'Préparer un post', write: true, bannette: true, exec: 'browser', action: 'sm.compose_draft',
    description: "Met un brouillon de post dans le composer Social Manager, réseaux pré-cochés : en direct dans l'onglet Keystone s'il est ouvert, sinon déposé dans la bannette pour la prochaine ouverture. Rien n'est publié, jamais — le bouton Publier reste à l'utilisateur.",
    inputSchema: S({ text: str('texte du post (≤ 5000 caractères)'), networks: { type: 'array', items: { type: 'string' }, description: 'réseaux visés parmi facebook, instagram, linkedin, threads, telegram (facultatif)' } }, ['text']),
    routes: [{ method: 'POST', path: '/api/mcp/inbox' }],
    run: async (ctx, args) => {
      const text = String(args.text || '').trim();
      if (!text) throw new Error('Il faut le texte du post.');
      const targets = (Array.isArray(args.networks) ? args.networks : []).map(n => String(n).toLowerCase()).filter(n => SOCIAL_NETWORKS.includes(n));
      const proposal = { pad: 'O-SOC-001', kind: 'compose', payload: { text: text.slice(0, 5000), targets, append: false },
        summary: `Post à relire : « ${excerpt(text, 70)} »`, ou: 'le composer de Social Manager', reseaux: targets };
      return viaTabOrBannette(ctx, 'sm.compose_draft', { text: text.slice(0, 5000), networks: targets, append: false }, proposal);
    },
  },
  {
    name: 'keystone_ghostwriter_prepare_text', title: 'Envoyer un texte au Ghost Writer', write: true, bannette: true, exec: 'browser', action: 'gw.rewrite_text',
    description: "Ouvre le Ghost Writer avec un texte prêt à réécrire (3 variantes, l'utilisateur lance et choisit) : en direct dans l'onglet Keystone s'il est ouvert, sinon déposé dans la bannette. Pour « fais réécrire ça dans Keystone ».",
    inputSchema: S({ text: str('texte à faire réécrire (≤ 8000 caractères)') }, ['text']),
    routes: [{ method: 'POST', path: '/api/mcp/inbox' }],
    run: async (ctx, args) => {
      const text = String(args.text || '').trim();
      if (!text) throw new Error('Il faut le texte à réécrire.');
      const proposal = { pad: 'A-COM-005', kind: 'gw.rewrite', payload: { text: text.slice(0, 8000) }, summary: `Texte à réécrire : « ${excerpt(text, 70)} »`, ou: 'le Ghost Writer' };
      return viaTabOrBannette(ctx, 'gw.rewrite_text', { text: text.slice(0, 8000) }, proposal);
    },
  },
  {
    name: 'keystone_brainstorming_seed_session', title: 'Lancer un brainstorming', write: true, bannette: true, exec: 'browser', action: 'bs.start_session',
    description: "Pose un brief de brainstorming : en direct dans l'onglet Keystone s'il est ouvert (la séance se lance, le comité débat), sinon déposé dans la bannette pour que l'utilisateur la lance à l'ouverture (la séance consomme des conversations).",
    inputSchema: S({ brief: str('le sujet à faire débattre (≤ 2000 caractères)') }, ['brief']),
    routes: [{ method: 'POST', path: '/api/mcp/inbox' }],
    run: async (ctx, args) => {
      const brief = String(args.brief || '').trim();
      if (!brief) throw new Error('Il faut le sujet du brainstorming.');
      const proposal = { pad: 'A-COM-003', kind: 'bs.session_seed', payload: { brief: brief.slice(0, 2000) }, summary: `Brainstorming à lancer : « ${excerpt(brief, 70)} »`, ou: 'le Brainstorming' };
      return viaTabOrBannette(ctx, 'bs.start_session', { brief: brief.slice(0, 2000) }, proposal);
    },
  },
  {
    name: 'keystone_bannette_status', title: 'État de la bannette',
    description: "Les propositions déposées par l'assistant et encore en attente d'un clic de l'utilisateur dans Keystone (post, texte, brainstorming…) : pad, résumé, dates. Pour savoir si l'utilisateur a déjà traité ce qui a été préparé.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/mcp/inbox' }],
    run: async (ctx) => {
      const d = await ctx.call('/api/mcp/inbox');
      const items = d.items || [];
      if (!items.length) return { en_attente: 0, message: 'Bannette vide : tout ce qui a été préparé a été traité (ou rien n’a été déposé).' };
      return { en_attente: items.length, propositions: items.map(i => ({ id: i.id, application: PAD_NAMES[i.pad] || i.pad, resume: i.summary, depose_le: i.created_at, expire_le: i.expires_at })) };
    },
  },

  /* ═══════════════════════════════════════════════════════════════
     LE PONT (sprint 4) — exec:'browser' : l'outil n'a pas de route,
     il DÉLÈGUE à l'onglet Keystone ouvert l'action `action` du catalogue
     navigateur (app/bridge-actions.js) via ctx.bridge(action, args).
     Lectures : sans onglet → erreur claire (« ouvre Keystone »).
     Écritures visuelles (ouvrir un pad, préparer un formulaire) : idem.
     Les trois outils de bannette essaient d'abord l'onglet (en direct,
     avec l'anneau) et retombent sur la bannette sans lui.
     ═══════════════════════════════════════════════════════════════ */
  {
    name: 'keystone_bridge_status', title: 'Onglet Keystone ouvert ?',
    description: "Dit si un onglet Keystone du compte est ouvert et connecté au Pont (les outils navigateur — séances Brainstorming, bibliothèque Ghost Writer, composer Social, ouverture d'un pad — ne marchent qu'avec lui). À appeler avant d'annoncer qu'une donnée est inaccessible.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/mcp/bridge/presence' }],
    run: async (ctx) => {
      const p = await ctx.call('/api/mcp/bridge/presence');
      return { onglet_ouvert: !!p.online, onglets: p.tabs || 0, vu_le: p.last_seen || null,
        message: p.online ? 'Un onglet Keystone est en ligne : les outils navigateur s’exécutent en direct, avec l’anneau.' : 'Aucun onglet Keystone en ligne : les écritures navigateur iront en bannette, les lectures navigateur attendront l’ouverture de Keystone.' };
    },
  },
  {
    name: 'keystone_chain_status', title: 'Chaîne de contenu (onglet)', exec: 'browser', action: 'chain.status',
    description: "Où en est la chaîne de contenu Brainstorming → Ghost Writer → Social Manager dans l'onglet Keystone (étape en cours, séance et brouillons liés). Nécessite un onglet Keystone ouvert.",
    inputSchema: S(), routes: [],
    run: async (ctx) => ctx.bridge('chain.status', {}),
  },
  {
    name: 'keystone_brainstorming_sessions', title: 'Séances de brainstorming (onglet)', exec: 'browser', action: 'bs.list_sessions',
    description: "Les séances de brainstorming sauvegardées dans le navigateur : brief, mode, dates, tours, synthèse présente ou non. Onglet Keystone ouvert, ou reflet chiffré si l'utilisateur l'a activé (« Visible par mon assistant ») (sinon : demande d'ouvrir Keystone).",
    inputSchema: S(), routes: [],
    run: async (ctx) => ctx.bridge('bs.list_sessions', {}, { mirror: ['brainstorming', 'bs.list_sessions'] }),
  },
  {
    name: 'keystone_brainstorming_synthesis', title: 'Synthèse d’une séance (onglet)', exec: 'browser', action: 'bs.read_synthesis',
    description: "La synthèse d'une séance de brainstorming (positionnement, opportunités, risques, plan d'actions, idées). Par défaut la dernière séance synthétisée. Onglet Keystone ouvert, ou reflet chiffré si l'utilisateur l'a activé (« Visible par mon assistant »).",
    inputSchema: S({ session_id: str('id de séance (cf. keystone_brainstorming_sessions) ; défaut : la dernière avec synthèse') }), routes: [],
    run: async (ctx, args) => ctx.bridge('bs.read_synthesis', args.session_id ? { sessionId: String(args.session_id) } : {}, args.session_id ? {} : { mirror: ['brainstorming', 'bs.read_synthesis'] }),
  },
  {
    name: 'keystone_brainstorming_debate', title: 'Débat d’une séance (onglet)', exec: 'browser', action: 'bs.read_debate',
    description: "Les derniers tours de parole d'une séance de brainstorming (qui a dit quoi). Onglet Keystone ouvert, ou reflet chiffré si l'utilisateur l'a activé (« Visible par mon assistant »).",
    inputSchema: S({ session_id: str('id de séance ; défaut : la plus récente'), last_n: int('nombre de tours (défaut 10)') }), routes: [],
    run: async (ctx, args) => ctx.bridge('bs.read_debate', { ...(args.session_id ? { sessionId: String(args.session_id) } : {}), ...(args.last_n ? { lastN: clampInt(args.last_n, 1, 50, 10) } : {}) },
      (args.session_id || args.last_n) ? {} : { mirror: ['brainstorming', 'bs.read_debate'] }),
  },
  {
    name: 'keystone_ghostwriter_posts', title: 'Posts composés (onglet)', exec: 'browser', action: 'gw.list_posts',
    description: "L'archive des posts rédigés par le Ghost Writer en mode chaîne (texte, réseau visé, date), stockée dans le navigateur. Onglet Keystone ouvert, ou reflet chiffré si l'utilisateur l'a activé (« Visible par mon assistant »).",
    inputSchema: S(), routes: [],
    run: async (ctx) => ctx.bridge('gw.list_posts', {}, { mirror: ['ghostwriter', 'gw.list_posts'] }),
  },
  {
    name: 'keystone_ghostwriter_library', title: 'Bibliothèque Ghost Writer (onglet)', exec: 'browser', action: 'gw.list_variants',
    description: "Les variantes de texte enregistrées dans le Studio Ghost Writer (label, mode, date, extrait), stockées dans le navigateur. Onglet Keystone ouvert, ou reflet chiffré si l'utilisateur l'a activé (« Visible par mon assistant »).",
    inputSchema: S(), routes: [],
    run: async (ctx) => ctx.bridge('gw.list_variants', {}, { mirror: ['ghostwriter', 'gw.list_variants'] }),
  },
  {
    name: 'keystone_ghostwriter_drafts', title: 'Brouillons Ghost Writer (onglet)', exec: 'browser', action: 'gw.read_draft',
    description: "Le brouillon en cours du Studio Ghost Writer (texte + critères) et celui du Correcteur, s'ils existent. Onglet Keystone ouvert, ou reflet chiffré si l'utilisateur l'a activé (« Visible par mon assistant »).",
    inputSchema: S(), routes: [],
    run: async (ctx) => ctx.bridge('gw.read_draft', {}, { mirror: ['ghostwriter', 'gw.read_draft'] }),
  },
  {
    name: 'keystone_social_composer', title: 'Brouillon du composer Social (onglet)', exec: 'browser', action: 'sm.read_composer',
    description: "Ce qui attend dans le composer Social Manager : texte et réseaux cochés. Onglet Keystone ouvert, ou reflet chiffré si l'utilisateur l'a activé (« Visible par mon assistant »).",
    inputSchema: S(), routes: [],
    run: async (ctx) => ctx.bridge('sm.read_composer', {}, { mirror: ['social', 'sm.read_composer'] }),
  },
  {
    name: 'keystone_qr_followed', title: 'QR suivi sur le tableau de bord (onglet)', exec: 'browser', action: 'qr.followed',
    description: "Le QR code épinglé sur le tableau de bord Keystone (suivi à l'unité) et ses derniers chiffres. Nécessite un onglet Keystone ouvert.",
    inputSchema: S(), routes: [],
    run: async (ctx) => ctx.bridge('qr.followed', {}),
  },
  {
    name: 'keystone_os_open_pad', title: 'Ouvrir une application (onglet)', write: true, exec: 'browser', action: 'os.open_pad',
    description: "Ouvre une application Keystone à l'écran de l'utilisateur : brainstorming, ghostwriter, social, qr, sentinel, keynapse, smartagent, desk, book, keybrand, network, missive, brief prod. Nécessite un onglet Keystone ouvert. N'écrit rien.",
    inputSchema: S({ pad: str('brainstorming | ghostwriter | social | qr | sentinel | keynapse | smartagent | desk | book | keybrand | network | missive | brief prod') }, ['pad']), routes: [],
    run: async (ctx, args) => { const r = await ctx.bridge('os.open_pad', { pad: String(args.pad || '') }); return { ...(r || {}), activite: r && r.fait ? `${r.outil_ouvert} ouvert à l’écran` : undefined }; },
  },
  {
    name: 'keystone_qr_open', title: 'Ouvrir Smart Dynamic QR (onglet)', write: true, exec: 'browser', action: 'qr.open',
    description: "Ouvre Smart Dynamic QR à l'écran, sur la bibliothèque ou directement sur un QR nommé (même partiellement). Nécessite un onglet Keystone ouvert. N'écrit rien.",
    inputSchema: S({ name: str('nom (même partiel) du QR à ouvrir ; défaut : la bibliothèque') }), routes: [],
    run: async (ctx, args) => ctx.bridge('qr.open', args.name ? { name: String(args.name) } : {}),
  },
  {
    name: 'keystone_qr_prepare_url', title: 'Préparer un QR URL (onglet)', write: true, exec: 'browser', action: 'qr.prepare_url',
    description: "Ouvre le formulaire de création de Smart Dynamic QR pré-rempli (adresse cible, nom) : l'utilisateur vérifie et enregistre lui-même. Nécessite un onglet Keystone ouvert. Ne crée rien sans lui.",
    inputSchema: S({ url: str('adresse (https://…) que le QR ouvrira'), name: str('nom du QR (facultatif)') }, ['url']), routes: [],
    run: async (ctx, args) => {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('Adresse complète attendue (https://…).');
      return ctx.bridge('qr.prepare_url', { url, ...(args.name ? { name: String(args.name).slice(0, 80) } : {}) });
    },
  },
  {
    name: 'keystone_keynapse_open_bubble', title: 'Ouvrir une note Keynapse (onglet)', write: true, exec: 'browser', action: 'kn.open_bubble',
    description: "Ouvre Keynapse à l'écran, directement sur une bulle retrouvée par son titre (même partiel). Nécessite un onglet Keystone ouvert. N'écrit rien.",
    inputSchema: S({ title: str('titre (même partiel) de la bulle ; défaut : la constellation') }), routes: [],
    run: async (ctx, args) => ctx.bridge('kn.open_bubble', args.title ? { title: String(args.title) } : {}),
  },
  {
    name: 'keystone_desk_prepare_relance', title: 'Préparer une relance desK (onglet)', write: true, exec: 'browser', action: 'dk.prepare_relance',
    description: "Ouvre desK à l'écran sur l'inspecteur de l'article à relancer (titre ou contributeur, même partiels), relance prête ; l'utilisateur envoie lui-même. Nécessite un onglet Keystone ouvert.",
    inputSchema: S({ revue: str('nom (même partiel) de la revue ; inutile si une seule'), article: str('titre OU contributeur (même partiel) ; sinon la liste s’ouvre') }), routes: [],
    run: async (ctx, args) => ctx.bridge('dk.prepare_relance', { ...(args.revue ? { revue: String(args.revue) } : {}), ...(args.article ? { article: String(args.article) } : {}) }),
  },
  {
    name: 'keystone_keynapse_append_note', title: 'Ajouter une note libre à une bulle', write: true,
    description: "Ajoute une note libre (texte) à une bulle Keynapse existante, retrouvée par son titre (même partiel). Pour compléter une note sans en créer une nouvelle.",
    inputSchema: S({ title: str('titre (même partiel) de la bulle'), text: str('texte à ajouter (≤ 4000 caractères)') }, ['title', 'text']),
    routes: [{ method: 'GET', path: '/api/keynapse/state' }, { method: 'POST', path: '/api/keynapse/bubbles/:id/notes' }],
    run: async (ctx, args) => {
      const text = String(args.text || '').trim().slice(0, 4000);
      if (!text) throw new Error('Il faut un texte.');
      const { bubbles } = await ctx.call('/api/keynapse/state');
      const b = resolveByName(bubbles || [], args.title, { what: 'note', soloOk: false, empty: 'Aucune note dans Keynapse.', label: (x) => x.title });
      const { note } = await ctx.call(`/api/keynapse/bubbles/${encodeURIComponent(b.id)}/notes`, { method: 'POST', body: { body: text } });
      return { fait: true, id: note.id, bulle: b.title, extrait: excerpt(text, 120), activite: `Note ajoutée à « ${excerpt(b.title, 60)} » dans Keynapse` };
    },
  },

  /* ═══════════════════════════════════════════════════════════════
     LE MOTEUR GÉNÉRIQUE (sprint 6) — pads-formulaires de app/pads-data.js,
     sans code par pad (lib/mcp-forms.js). La recette est aussi servie en
     ressource MCP keystone://pad/<id>/prompt.
     ═══════════════════════════════════════════════════════════════ */
  {
    name: 'keystone_form_list', title: 'Mes formulaires (pads)',
    description: "Les pads-formulaires du Master Renderer disponibles pour ce compte (Notices VEFA, Annonces immo…) : identifiant, champs requis, plan, accès selon la licence, et l'adresse de leur recette (ressource MCP). Puis keystone_form_prompt ou keystone_form_fill.",
    inputSchema: S(),
    routes: [{ method: 'GET', path: '/api/catalog' }],
    run: async (ctx) => {
      const pads = await listFormPads(ctx);
      if (!pads.length) return { total: 0, message: 'Aucun pad-formulaire publié au K-Store pour l’instant.' };
      return { total: pads.length, formulaires: pads.map(p => ({ id: p.id, cle: p.padKey, titre: p.title, sous_titre: p.subtitle, categorie: p.category, plan_minimum: p.plan,
        accessible: p.accessible, ...(p.published ? {} : { publie: false }), ...(p.replacedBy ? { remplace_par: p.replacedBy } : {}),
        champs: p.fields.length, requis: p.fields.filter(f => f.required).map(f => f.id), recette_ia: !!p.system_prompt, export_document: p.doc_export ? p.doc_export.label : null,
        ressource: formUri(p.id) })) };
    },
  },
  {
    name: 'keystone_form_prompt', title: 'Recette et champs d’un formulaire',
    description: "La recette d'un pad-formulaire (son system prompt, avec les {{champs}} à substituer), la liste exacte de ses champs (type, options, requis) et son mode d'emploi. Génère toi-même avec cette recette — aucun crédit Keystone. pad : identifiant, clé ou titre (même partiel).",
    inputSchema: S({ pad: str('identifiant (O-IMM-002), clé (A2) ou titre (même partiel) du formulaire ; facultatif si un seul') }),
    routes: [{ method: 'GET', path: '/api/catalog' }],
    run: async (ctx, args) => {
      const p = await resolveFormPad(ctx, args.pad);
      if (!p.accessible) throw new Error(`« ${p.title} » n’est pas dans la licence de ce compte.`);
      return { id: p.id, titre: p.title, sous_titre: p.subtitle, ressource: formUri(p.id), mode_emploi: p.notice,
        champs: p.fields.map(f => ({ id: f.id, libelle: f.label, type: f.type, requis: !!f.required, ...(f.options ? { options: f.options } : {}), ...(f.placeholder ? { exemple: f.placeholder } : {}) })),
        schema_json: formSchema(p), recette: p.system_prompt || null, export_document: p.doc_export,
        conseil: 'Substitue les {{champs}} par les valeurs, génère, puis propose keystone_form_fill avec les mêmes valeurs pour que l’utilisateur retrouve le formulaire pré-rempli dans Keystone.' };
    },
  },
  {
    name: 'keystone_form_fill', title: 'Pré-remplir un formulaire', write: true, bannette: true, exec: 'browser', action: 'os.prefill_form',
    description: "Ouvre un pad-formulaire pré-rempli dans Keystone : en direct dans l'onglet ouvert, sinon déposé dans la bannette pour la prochaine ouverture. Les données sont validées strictement contre les champs du pad (requis, options, nombres) — rien n'est généré ni exporté sans l'utilisateur.",
    inputSchema: S({ pad: str('identifiant (O-IMM-002), clé (A2) ou titre du formulaire'), data: { type: 'object', additionalProperties: true, description: '{ champ: valeur } selon keystone_form_prompt (select = une option, multiselect = tableau d’options, number = nombre)' } }, ['pad', 'data']),
    routes: [{ method: 'GET', path: '/api/catalog' }, { method: 'POST', path: '/api/mcp/inbox' }],
    run: async (ctx, args) => {
      const p = await resolveFormPad(ctx, args.pad);
      if (!p.accessible) throw new Error(`« ${p.title} » n’est pas dans la licence de ce compte.`);
      const v = validateFormData(p, args.data);
      if (!v.ok) throw new Error(`Données refusées pour « ${p.title} » : ${v.errors.join(' ; ')}.`);
      const n = Object.keys(v.data).length;
      const proposal = { pad: p.id, kind: 'prefillData', payload: v.data, summary: `${p.title} à relire : ${n} champ${n > 1 ? 's' : ''} pré-rempli${n > 1 ? 's' : ''}`, ou: `le formulaire « ${p.title} »` };
      const out = await viaTabOrBannette(ctx, 'os.prefill_form', { padId: p.id, data: v.data }, proposal);
      out.formulaire = p.title; out.champs_valides = n;
      return out;
    },
  },

  /* ═══════════════════════════════════════════════════════════════
     SONDE MCP APPS (S7) — hors catalogue tant que MCP_APPS ≠ 'on'.
     Même donnée que keystone_qr_overview, plus `_meta.ui` qui désigne
     l'interface `ui://keystone/qr-card` (lib/mcp-apps.js). Un client qui
     ignore l'extension ne voit qu'une lecture de plus : le résultat JSON
     suffit au modèle. Lecture seule, une seule route, en GET.
     ═══════════════════════════════════════════════════════════════ */
  {
    name: 'keystone_qr_card', title: 'Carte de mes QR codes', gate: 'MCP_APPS',
    meta: { ui: { resourceUri: APPS_UI_URI, prefersBorder: true } },
    description: "Carte visuelle des Smart Dynamic QR : scans, visiteurs uniques, aujourd'hui, QR actifs, meilleurs QR et points à surveiller. Rend une interface dans la conversation si le client sait l'afficher ; sinon les mêmes chiffres en texte. period : 7d, 30d, 90d ou all (défaut 7d). Pour « montre-moi la carte de mes QR codes ».",
    inputSchema: S({ period: str('7d | 30d | 90d | all (défaut 7d)') }),
    routes: [{ method: 'GET', path: '/api/qr/overview' }],
    run: async (ctx, args) => {
      const period = ['7d', '30d', '90d', 'all'].includes(args.period) ? args.period : '7d';
      const data = await ctx.call(`/api/qr/overview?period=${period}`);
      const t = data.totals || {};
      const today = todayIso();
      const TREND = { up: 'en hausse', down: 'en baisse', flat: 'stable' };
      return {
        vue: 'carte_qr', periode: period,
        scans: t.scans_total || 0, visiteurs_uniques: t.unique || 0,
        qr_total: t.qr_total || 0, qr_actifs: t.qr_active || 0,
        aujourdhui: (data.byDay || []).find(d => d.day === today)?.cnt || 0,
        cette_semaine: t.week || 0,
        classement: (data.leaderboard || []).slice(0, 5).map(l => ({ nom: l.name, scans: l.scans, tendance: TREND[l.trend] || 'stable' })),
        a_surveiller: (data.watch || []).map(w => `${w.name} : ${w.note}`),
        mesure_le: new Date().toISOString(),
        ouvrir: APPS_APP_URL,
      };
    },
  },
];

/* ── Helpers partagés entre outils ── */
function host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return String(url || ''); } }

async function saResolve(ctx, ref) {
  const { agents } = await ctx.call('/api/smart-agent/agents');
  return resolveByName(agents || [], ref, { what: 'jumeau', empty: 'Aucun jumeau créé pour l’instant.', label: (a) => a.name });
}
async function kfForms(ctx) {
  const data = await ctx.call('/api/pulsa/forms');
  return Array.isArray(data.forms) ? data.forms : [];
}
const kfStatut = (s) => s === 'published' ? 'publié' : s === 'archived' ? 'archivé' : 'brouillon';
async function nkBoot(ctx) {
  const data = await ctx.call('/api/network/bootstrap');
  return { categories: Array.isArray(data.categories) ? data.categories : [],
           contacts: Array.isArray(data.contacts) ? data.contacts : [],
           activity: Array.isArray(data.activity) ? data.activity : [] };
}
/* desK — règles métier PURES partagées avec le pad (app/lib/desk-rules.js,
   zéro DOM / fetch / import). Import dynamique : le bundler wrangler
   l'embarque, et un échec d'import se voit à l'appel, pas au boot. */
let _desk = null;
async function desk() { if (!_desk) _desk = await import('../../../app/lib/desk-rules.js'); return _desk; }
async function dkResolvePub(ctx, ref) {
  const boot = await ctx.call('/api/desk/bootstrap');
  const pubs = boot.publications || [];
  const pub = resolveByName(pubs, ref, { what: 'revue', empty: 'Aucune revue dans desK pour l’instant.', label: (p) => p.name });
  return { pub, pubs };
}
function dkJalons(v) { if (v && typeof v === 'object') return v; try { return JSON.parse(v || '{}') || {}; } catch (_) { return {}; } }
function dkCurrentIssue(pub) {
  const issues = pub.issues || [];
  return issues.find(i => i.status === 'preparation' || i.status === 'production') || issues[0] || null;
}
function dkPagesOf(rules, artId, D, pub) {
  const pageById = {};
  for (const p of (D.pages || [])) pageById[p.id] = p;
  const ns = [];
  for (const s of (D.slots || [])) if (s.art_id === artId && pageById[s.page_id]) ns.push(pageById[s.page_id].n);
  return [...new Set(ns)].sort((a, b) => a - b).map(n => rules.dkPn(n, pub, D.pages));
}

/* ── Helpers des écritures (sprint 3) ── */
const KORTEX_TYPES    = ['fact', 'procedure', 'qa', 'case', 'rule', 'objection', 'definition'];   // = UNIT_TEMPLATES (routes/smart-agent.js)
const NK_KINDS        = ['person', 'company', 'place', 'group'];                                   // = KINDS (routes/network.js)
const NK_ACT_TYPES    = ['call', 'email', 'meeting', 'quote', 'doc', 'note', 'other'];             // = ACT_TYPES (routes/network.js)
const SOCIAL_NETWORKS = ['facebook', 'instagram', 'linkedin', 'threads', 'telegram'];
const PAD_NAMES = { 'O-SOC-001': 'Social Manager', 'A-COM-005': 'Ghost Writer', 'A-COM-003': 'Brainstorming', 'A-COM-001': 'Smart Dynamic QR' };
/* Dépôt d'une proposition dans la bannette (POST /api/mcp/inbox, JWT de
   l'appel) : le Worker n'applique rien, l'onglet Keystone le fera au clic. */
async function bannette(ctx, { pad, kind, payload, summary, ou, reseaux }) {
  const r = await ctx.call('/api/mcp/inbox', { method: 'POST', body: { pad, kind, payload, summary, tool: ctx.tool || null } });
  const out = { fait: true, depose: true, id: r.id, application: PAD_NAMES[pad] || pad, expire_le: iso(r.expires_at), en_attente: r.pending ?? undefined,
    message: `Déposé dans la bannette : s’appliquera dans ${ou} à la prochaine ouverture de Keystone — l’utilisateur relit, puis décide.`, activite: summary };
  if (reseaux) out.reseaux = reseaux.length ? reseaux : 'au choix de l’utilisateur';
  return out;
}

/* Pont d'abord, bannette sinon (sprint 4) : si un onglet est en ligne, l'action
   s'exécute en direct (anneau) ; sans onglet ou sans réponse, la proposition
   est déposée. Un onglet qui refuse (licence…) rend fait:false + raison. */
async function viaTabOrBannette(ctx, action, args, proposal) {
  let why = null;
  /* le repli DÉPOSE lui-même (ctx.bridge lie alors la notification push et
     l'ordre en file à cette proposition : même id, pas de doublon) */
  const live = ctx.bridge
    ? await ctx.bridge(action, args, { fallback: async (r) => { why = r; return bannette(ctx, proposal); } })
    : await bannette(ctx, proposal);
  if (live && typeof live === 'object' && live.depose) {
    if (why === 'timeout') live.message = 'L’onglet Keystone n’a pas répondu à temps : ' + live.message;
    return live;
  }
  if (live && typeof live === 'object') return { ...live, en_direct: true, activite: proposal.summary };
  return bannette(ctx, proposal);
}

/* Un outil « gaté » (gate:'VAR') n'existe que si env[VAR] === 'on'. */
const visible = (t, env) => !t.gate || (env && String(env[t.gate] || '').toLowerCase() === 'on');
export function mcpTool(name, env) { const t = MCP_TOOLS.find(x => x.name === name); return (t && visible(t, env)) ? t : null; }
export function mcpToolList(env) {
  /* `meta` → `_meta` : seule la sonde MCP Apps s'en sert aujourd'hui (elle y
     désigne son interface). Un client qui ne connaît pas l'extension ignore
     `_meta` : le champ est libre par la spec MCP. */
  return MCP_TOOLS.filter(t => visible(t, env)).map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
    annotations: { readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false },
    ...(t.meta ? { _meta: t.meta } : {}) }));
}
/* Écritures SERVEUR (bandeau d'activité) : write, hors bannette. */
export function mcpWriteToolNames() { return MCP_TOOLS.filter(t => t.write && !t.bannette).map(t => t.name); }
