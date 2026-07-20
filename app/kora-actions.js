/* ═══════════════════════════════════════════════════════════════
   KORA — Catalogue d'actions V1 (lectures) + V1.1 (écritures sûres)
   ───────────────────────────────────────────────────────────────
   Le cœur de l'agent (KORA_BRIEF §2) : un catalogue d'actions bien
   nommées, scopées par pad. V1 = la chaîne de contenu (Brainstorming,
   Ghost Writer, Social Manager) + l'état de la chaîne elle-même.
   V1.2 (18-19/07) = + Smart Dynamic QR, Sentinel, Keynapse (même
   moule : lectures API/localStorage, écritures = préparer/ouvrir).
   V1.3 (20/07, K-8) = + Smart Agent (jumeaux de savoir-faire, MAX
   only) — 4 lectures, aucune écriture (pad de configuration fine,
   pas de préparer/ouvrir qui aille plus vite qu'un clic).

   RÈGLES (KORA_BRIEF Annexe B) :
   · Module INERTE AU CHARGEMENT : zéro import statique de pads.
     Lectures = localStorage/sessionStorage + endpoints existants ;
     écritures = imports DYNAMIQUES dans run() des passerelles que
     les pads s'échangent déjà (openTool, openBrainstorming…).
   · Chaque action visible déclare `target` = le sélecteur de ce
     qu'elle touche (l'anneau kora-ring se posera dessus).
   · mode:'read' | 'write'. Les écritures V1.1 PRÉPARENT et OUVRENT,
     rien de plus : publier/programmer/supprimer n'existent pas ici,
     et détruire/trancher n'y entreront JAMAIS (§7).
   · Isolation : préfixe kora_, ce module n'apprend rien aux pads.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const KORA_API = (typeof window !== 'undefined' && window.__KS_API_BASE__) ||
  'https://keystone-os-api.keystone-os.workers.dev';

/* ── Aides internes ── */
function _jwt() { try { return localStorage.getItem('ks_jwt') || ''; } catch (e) { return ''; } }
function _ls(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (e) { return fallback; }
}
function _ss(key, fallback) {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (e) { return fallback; }
}
function _excerpt(text, max = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
/* Dates en français FINI : le modèle recopie, il ne « traduit » plus
   (test réel 18/07 : les ISO lui faisaient sortir « 17 avril 223 à 17h4 »). */
function _frDate(v) {
  if (!v) return null;
  /* date pure « YYYY-MM-DD » (ex. printed_at) : jamais d'heure fantôme
     (new Date('2026-07-15') = minuit UTC → « à 2h00 » à Paris, revue 19/07) */
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d0 = new Date(v + 'T00:00:00');
    return isNaN(d0) ? v : d0.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return String(v);
  const txt = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const hm = d.getHours() || d.getMinutes()
    ? ' à ' + String(d.getHours()) + 'h' + String(d.getMinutes()).padStart(2, '0') : '';
  return txt + hm;
}
/* SQLite datetime('now') stocke « YYYY-MM-DD HH:MM:SS » UTC SANS T ni Z
   (qr_redirects.created_at) : parsé tel quel, new Date le croit LOCAL →
   heure fausse, jour faux près de minuit. Même normalisation que le
   worker (qr.js:647). Les ISO avec T/Z passent inchangés. */
function _sqlUtc(v) {
  return (v && typeof v === 'string' && !/[TZ]/.test(v)) ? v.replace(' ', 'T') + 'Z' : v;
}
async function _api(path, { auth = true } = {}) {
  const headers = {};
  if (auth) {
    const token = _jwt();
    if (!token) throw new Error('Non connecté : ouvre Keystone et connecte-toi (ks_jwt absent).');
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${KORA_API}${path}`, { headers });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

/* ── LE CATALOGUE ──
   { id, pad, mode, label, desc, target, params:[{name,type,required,desc}], run } */
export const KORA_ACTIONS = [

  /* ═══ CHAÎNE DE CONTENU (transverse) ═══ */
  {
    id: 'chain.status', pad: 'chaine', mode: 'read',
    label: 'Où en est la chaîne de contenu',
    desc: "État de la chaîne Brainstorming → Ghost Writer → Social : étape courante, réseau visé, origine. Vide si aucune chaîne active (TTL 6 h).",
    target: '.ks-chain',
    params: [],
    run: async () => {
      const chain = _ss('ks_content_chain', null);
      if (!chain || !chain.ts || Date.now() - chain.ts > 6 * 3600 * 1000)
        return { active: false, message: 'Aucune chaîne de contenu active.' };
      return { active: true, step: chain.step, network: chain.network || null,
               origin: chain.origin || null, depuis: _frDate(chain.ts) };
    },
  },

  /* ═══ BRAINSTORMING ═══ */
  {
    id: 'bs.list_sessions', pad: 'brainstorming', mode: 'read',
    label: 'Lister les séances de brainstorming',
    desc: 'Bibliothèque des séances sauvegardées (une séance est sauvée au moment de sa synthèse) : brief, mode, dates, nombre de tours, synthèse présente ou non.',
    target: '#wr-feed',
    params: [],
    run: async () => {
      const sessions = _ls('ks_brainstorming_sessions', []);
      return {
        total: sessions.length,
        seances: sessions.map(s => ({
          id: s.id, brief: _excerpt(s.brief, 120), mode: s.mode || 'debat',
          debut: _frDate(s.started_at), maj: _frDate(s.updated_at),
          tours: Array.isArray(s.history) ? s.history.length : 0,
          synthese: !!s.synthesis,
        })),
      };
    },
  },
  {
    id: 'bs.read_synthesis', pad: 'brainstorming', mode: 'read',
    label: 'Lire la synthèse d’une séance',
    desc: 'La synthèse qui tranche : positionnement, opportunités, risques, plan d’actions (et top d’idées en mode post-ideas). Par défaut : la séance synthétisée la plus récente.',
    target: '#wr-synthesis-drawer',
    params: [{ name: 'sessionId', type: 'string', required: false, desc: 'id de séance (défaut : la dernière avec synthèse)' }],
    run: async (args = {}) => {
      const sessions = _ls('ks_brainstorming_sessions', []);
      const withSynth = sessions.filter(s => s.synthesis);
      const s = args.sessionId
        ? sessions.find(x => x.id === args.sessionId)
        : withSynth.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
      if (!s) throw new Error('Aucune séance trouvée' + (args.sessionId ? ` pour l’id ${args.sessionId}.` : ' avec une synthèse.'));
      if (!s.synthesis) throw new Error(`La séance « ${_excerpt(s.brief, 60)} » n’a pas encore de synthèse.`);
      const sy = s.synthesis;
      return {
        seance: { id: s.id, brief: _excerpt(s.brief, 120), date: _frDate(s.synthesizedAt || s.updated_at) },
        positionnement: sy.positioning || null,
        opportunites: sy.opportunities || [],
        risques: sy.risks || [],
        plan_actions: sy.next_actions || [],
        idees: sy.ideation || sy.ideas || null,
      };
    },
  },
  {
    id: 'bs.read_debate', pad: 'brainstorming', mode: 'read',
    label: 'Relire le débat d’une séance',
    desc: 'Les derniers tours de parole d’une séance (agents + utilisateur). Par défaut : la séance la plus récente, 10 derniers tours.',
    target: '#wr-feed',
    params: [
      { name: 'sessionId', type: 'string', required: false, desc: 'id de séance (défaut : la plus récente)' },
      { name: 'lastN', type: 'number', required: false, desc: 'nombre de tours (défaut 10)' },
    ],
    run: async (args = {}) => {
      const sessions = _ls('ks_brainstorming_sessions', []);
      const s = args.sessionId
        ? sessions.find(x => x.id === args.sessionId)
        : sessions.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
      if (!s) throw new Error('Aucune séance trouvée.');
      const n = Math.max(1, Math.min(50, args.lastN || 10));
      const history = Array.isArray(s.history) ? s.history : [];
      return {
        seance: { id: s.id, brief: _excerpt(s.brief, 120) },
        tours_total: history.length,
        tours: history.slice(-n).map(h => ({
          qui: h.agent_id === 'user' ? 'utilisateur' : h.agent_id,
          texte: _excerpt(h.content, 300), quand: _frDate(h.timestamp),
        })),
      };
    },
  },
  {
    id: 'bs.roster_prefs', pad: 'brainstorming', mode: 'read',
    label: 'Voir le comité d’agents préféré',
    desc: 'Préférences du comité de brainstorming : mode auto ou manuel, agents choisis, invitation du Gest (expert Kortex).',
    target: '.wr-agents-row',
    params: [],
    run: async () => {
      const roster = _ls('ks_brainstorming_roster', null);
      const off = (() => { try { return localStorage.getItem('ks_brainstorm_roster') === 'off'; } catch (e) { return false; } })();
      return {
        selecteur_actif: !off,
        mode: roster?.mode || 'auto',
        agents_manuels: roster?.manualRoster || [],
        gest_invite: !!roster?.inviteGest,
        gest_agent: roster?.gestAgentId || null,
      };
    },
  },

  /* ═══ GHOST WRITER ═══ */
  {
    id: 'gw.list_posts', pad: 'ghostwriter', mode: 'read',
    label: 'Lister les posts composés',
    desc: 'Archive des posts rédigés en mode chaîne (texte, réseau visé, date) — le livrable rédactionnel de la chaîne de contenu.',
    target: '#gw-archive',
    params: [],
    run: async () => {
      const archive = _ls('ks_gw_compose_archive', []);
      return {
        total: archive.length,
        posts: archive.map(p => ({ id: p.id, reseau: p.network || null,
          date: _frDate(p.ts), extrait: _excerpt(p.text, 200) })),
      };
    },
  },
  {
    id: 'gw.list_variants', pad: 'ghostwriter', mode: 'read',
    label: 'Lister la bibliothèque de variantes',
    desc: 'Variantes de texte enregistrées dans le Studio Ghost Writer (label, mode de rédaction, date).',
    target: '.gw-lib-panel',
    params: [],
    run: async () => {
      const lib = _ls('ks_ghostwriter_library', []);
      return {
        total: lib.length,
        variantes: lib.map(v => ({ uid: v.uid, label: v.label || null, mode: v.modeLabel || null,
          date: _frDate(v.date), extrait: _excerpt(v.text, 200) })),
      };
    },
  },
  {
    id: 'gw.read_draft', pad: 'ghostwriter', mode: 'read',
    label: 'Lire les brouillons en cours',
    desc: 'Le brouillon du Studio (texte + critères de rédaction) et celui du Correcteur, s’ils existent.',
    target: '.gw-source',
    params: [],
    run: async () => {
      const studio = _ls('ks_ghostwriter_studio_draft', null);
      const proof = _ls('ks_gw_proof_draft', null);
      return {
        studio: studio ? { mode: studio.mode || null, extrait: _excerpt(studio.data?.text, 300),
          criteres: { action: studio.data?.action || null, ton: studio.data?.tone || null,
            audience: studio.data?.audience || null, intention: studio.data?.intent || null,
            longueur: studio.data?.lengthTarget || null } } : null,
        correcteur: proof ? { mode: proof.mode || null, extrait: _excerpt(proof.text, 300) } : null,
      };
    },
  },
  {
    id: 'gw.quota', pad: 'ghostwriter', mode: 'read',
    label: 'Consulter le quota d’écriture IA',
    desc: 'Quota Ghost Writer du compte : utilisé, plafond, restant, plan. (Nécessite d’être connecté.)',
    target: '#gw-status',
    params: [],
    run: async () => {
      const q = await _api('/api/ghostwriter/quota');
      return { plan: q.plan || null, utilise: q.used ?? null, plafond: q.max ?? null,
               restant: q.remaining ?? null, illimite: !!q.unlimited, periode: q.period || null };
    },
  },

  /* ═══ SOCIAL MANAGER ═══ */
  {
    id: 'sm.upcoming_posts', pad: 'social', mode: 'read',
    label: 'Quels posts partent bientôt',
    desc: 'Les publications programmées dans la fenêtre donnée (défaut 7 jours) : date, réseaux visés, extrait.',
    target: '[data-slot="queue"]',
    params: [{ name: 'days', type: 'number', required: false, desc: 'fenêtre en jours (défaut 7)' }],
    run: async (args = {}) => {
      const days = Math.max(1, Math.min(90, args.days || 7));
      const data = await _api('/api/social/posts?status=scheduled');
      const horizon = Date.now() + days * 86400e3;
      const posts = (data.posts || [])
        .filter(p => p.scheduledAt && new Date(p.scheduledAt).getTime() <= horizon)
        .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
      return {
        fenetre_jours: days, total: posts.length,
        posts: posts.map(p => ({ id: p.id, quand: _frDate(p.scheduledAt), reseaux: p.targets || [],
          extrait: _excerpt(p.excerpt, 160), medias: p.mediaCount || 0 })),
      };
    },
  },
  {
    id: 'sm.recent_results', pad: 'social', mode: 'read',
    label: 'Résultats des dernières publications',
    desc: 'Les posts déjà publiés (ou en échec) sur les réseaux sociaux : combien, quand, quel statut par réseau, avec lien quand il existe. Répond à « combien de posts ai-je faits / publiés ? », « mes dernières publications ».',
    target: '[data-slot="queue"]',
    params: [{ name: 'limit', type: 'number', required: false, desc: 'nombre de posts (défaut 10)' }],
    run: async (args = {}) => {
      const limit = Math.max(1, Math.min(50, args.limit || 10));
      const data = await _api('/api/social/posts');
      const posts = (data.posts || []).filter(p => p.status !== 'scheduled').slice(0, limit);
      return {
        total: posts.length,
        posts: posts.map(p => ({ id: p.id, statut: p.status, quand: _frDate(p.updatedAt || p.createdAt),
          extrait: _excerpt(p.excerpt, 160),
          par_reseau: (p.results || []).map(r => ({ reseau: r.platform, statut: r.status,
            url: r.url || null, erreur: r.error || null })) })),
      };
    },
  },
  {
    id: 'sm.accounts_health', pad: 'social', mode: 'read',
    label: 'Santé des comptes connectés',
    desc: 'Réseaux sociaux connectés : statut (connecté / expiré) et échéance de jeton, avec alerte quand elle approche (moins de 7 jours).',
    target: '[data-slot="acct-alert"]',
    params: [],
    run: async () => {
      const data = await _api('/api/social/accounts');
      const soon = Date.now() + 7 * 86400e3;
      return {
        total: (data.accounts || []).length,
        comptes: (data.accounts || []).map(a => ({ reseau: a.platform, nom: a.display_name || null,
          statut: a.status, expire_le: _frDate(a.expires_at),
          expire_bientot: !!(a.expires_at && new Date(a.expires_at).getTime() <= soon) })),
      };
    },
  },
  {
    id: 'sm.post_insights', pad: 'social', mode: 'read',
    label: 'Statistiques d’un post publié',
    desc: 'Les métriques d’un post (par réseau) quand la plateforme les fournit.',
    target: '.sm-q-insights',
    params: [{ name: 'id', type: 'string', required: true, desc: 'id du post (cf. sm.recent_results)' }],
    run: async (args = {}) => {
      if (!args.id) throw new Error('Paramètre requis : id du post.');
      const data = await _api(`/api/social/posts/insights?id=${encodeURIComponent(args.id)}`);
      return { id: data.id, stats: data.insights || [] };
    },
  },
  {
    id: 'sm.read_composer', pad: 'social', mode: 'read',
    label: 'Lire le brouillon du composer',
    desc: 'Ce qui attend dans le composer Social Manager : texte et réseaux cochés (les médias ne sont pas persistés).',
    target: '#sm-text',
    params: [],
    run: async () => {
      const draft = _ls('ks_social_manager_draft_v1', null);
      if (!draft || !(draft.text || '').trim())
        return { brouillon: false, message: 'Composer vide.' };
      return { brouillon: true, extrait: _excerpt(draft.text, 300), reseaux: draft.targets || [] };
    },
  },
  {
    id: 'sm.network_caps', pad: 'social', mode: 'read',
    label: 'Contraintes par réseau',
    desc: 'Capacités de chaque réseau branché : longueur max, hashtags, médias autorisés, vidéo. (Endpoint public, sans connexion.)',
    target: '[data-slot="nets"]',
    params: [],
    run: async () => {
      const data = await _api('/api/social/registry', { auth: false });
      return {
        reseaux: (data.platforms || []).map(p => ({ id: p.id, nom: p.label,
          texte_max: p.text?.maxLength ?? null, hashtags_max: p.text?.maxHashtags ?? null,
          medias: !!p.media?.enabled, media_requis: !!p.media?.required,
          video: !!p.media?.videoEnabled })),
      };
    },
  },

  /* ═══ SMART DYNAMIC QR (V1.2 — 1er pad hors chaîne) ═══
     Particularité (inventaire 18/07) : la flotte ne vit PAS en
     localStorage (_cachedQrs = état mémoire du module, sdqr.js:53) —
     toutes les lectures passent par le worker. Tenant : _authTenant
     (qr.js:148) gère lui-même admin→'default', rien à câbler ici.
     /r/:shortId (hot-path prod, 530+ scans imprimés) : JAMAIS touché. */
  {
    id: 'qr.list', pad: 'sdqr', mode: 'read',
    label: 'Lister mes QR codes',
    desc: "La flotte Smart Dynamic QR : nom, type (url, vcard, wifi…), mode (statique, dynamique, smart), statut, dossier, scans totaux, destination. Répond à « mes QR codes », « combien de QR j'ai ».",
    target: '.sdqr-qr-grid',
    params: [],
    run: async () => {
      const data = await _api('/api/qr');
      const qrs = data.qrs || [];
      const out = {
        total: qrs.length,
        actifs: qrs.filter(q => (q.status || 'active') === 'active').length,
        /* statique : scans null (pas 0 — rien n'est suivi) ; la destination
           d'un statique URL vit dans payload.url, pas dans qr_redirects */
        qrs: qrs.map(q => ({ id: q.id, nom: q.name || '(sans nom)', type: q.qr_type || 'url',
          mode: q.mode || 'dynamic', statut: q.status || 'active', dossier: q.folder || null,
          scans: q.mode === 'static' ? null : (q.scans_total || 0),
          destination: q.target_url || q.payload?.url || null, cree: _frDate(q.created_at) })),
      };
      if (qrs.some(q => q.mode === 'static'))
        out.note = 'Les QR statiques ne suivent pas les scans (aucun comptage, volontairement).';
      return out;
    },
  },
  {
    id: 'qr.scans_overview', pad: 'sdqr', mode: 'read',
    label: 'Vue d’ensemble des scans',
    desc: "Les scans de tous mes QR : total, uniques, aujourd'hui, cette semaine, classement des meilleurs, à surveiller. Répond à « les scans de mes QR », « combien de scans », « quel QR marche le mieux », « ça a scanné aujourd'hui ? ».",
    target: '.sdqr-tab[data-view="stats"]',
    params: [{ name: 'period', type: 'string', required: false, desc: '7d, 30d, 90d ou all (défaut 7d)' }],
    run: async (args = {}) => {
      const period = ['7d', '30d', '90d', 'all'].includes(args.period) ? args.period : '7d';
      const data = await _api(`/api/qr/overview?period=${period}`);
      const t = data.totals || {};
      /* le serveur agrège par date UTC (qr.js:602) — approximation locale OK */
      const today = new Date().toISOString().slice(0, 10);
      const TREND = { up: 'en hausse', down: 'en baisse', flat: 'stable' };
      const out = {
        periode: period === 'all' ? 'depuis le début' : `${parseInt(period, 10)} derniers jours`,
        scans: t.scans_total || 0, visiteurs_uniques: t.unique || 0,
        qr_total: t.qr_total || 0, qr_actifs: t.qr_active || 0,
        aujourdhui: (data.byDay || []).find(d => d.day === today)?.cnt || 0,
        cette_semaine: t.week || 0,
        classement: (data.leaderboard || []).map(l => ({ nom: l.name, scans: l.scans,
          tendance: TREND[l.trend] || 'stable' })),
        a_surveiller: (data.watch || []).map(w => `${w.name} : ${w.note}`),
      };
      /* qr.js:593-598 : en 7d, le filtre de période exclut la semaine
         précédente → week_delta vaut mécaniquement +100 %. On ne sert
         l'évolution que quand le serveur a vu les DEUX semaines ; null
         explicite sinon (un champ absent tente le modèle de le combler). */
      out.evolution_semaine = period !== '7d'
        ? (t.week_delta > 0 ? '+' : '') + (t.week_delta || 0) + ' %' : null;
      return out;
    },
  },
  {
    id: 'qr.stats_one', pad: 'sdqr', mode: 'read',
    label: 'Statistiques d’un QR précis',
    desc: "Les stats détaillées d'UN QR retrouvé par son nom : scans aujourd'hui / cette semaine / total, visiteurs uniques, meilleur créneau (jour + heure), pays, appareils. Répond à « les stats du QR … », « il fait combien de scans, le QR … ? ».",
    target: '#sdqr-stats-body',
    params: [
      { name: 'name', type: 'string', required: true, desc: 'nom (même partiel) du QR' },
      { name: 'period', type: 'string', required: false, desc: '7d, 30d, 90d ou all (défaut 30d)' },
    ],
    run: async (args = {}) => {
      const ref = String(args.name || '').trim();
      if (!ref) throw new Error('Il me faut le nom du QR.');
      const { qrs } = await _api('/api/qr');
      const found = _qrByName(qrs || [], ref);
      if (!found.match) {
        if (found.candidates.length)
          throw new Error(`Plusieurs QR correspondent à « ${ref} » : ${found.candidates.join(' · ')}. Précise le nom.`);
        throw new Error(`Aucun QR nommé « ${ref} » dans la flotte.`);
      }
      const q = found.match;
      if (q.mode === 'static')
        return { qr: q.name, mode: 'statique',
                 info: 'QR statique : aucun scan n’est tracké (par design, RGPD natif).' };
      const period = ['7d', '30d', '90d', 'all'].includes(args.period) ? args.period : '30d';
      const s = await _api(`/api/qr/${encodeURIComponent(q.id)}/stats?period=${period}`);
      const t = s.totals || {};
      return {
        qr: q.name, periode: period === 'all' ? 'depuis le début' : `${parseInt(period, 10)} derniers jours`,
        scans: t.total || 0, visiteurs_uniques: t.unique || 0,
        aujourdhui: t.today || 0, cette_semaine: t.week || 0,
        meilleur_creneau: _qrBestSlot(s.heatmap),
        pays: (s.byCountry || []).slice(0, 3).map(c => ({ pays: c.country, scans: c.cnt })),
        appareils: (s.byDevice || []).map(d => ({ appareil: d.device, scans: d.cnt })),
        cree: _frDate(_sqlUtc(s.meta?.created_at)), imprime: _frDate(s.meta?.printed_at),
      };
    },
  },
  {
    id: 'qr.followed', pad: 'sdqr', mode: 'read',
    label: 'Le QR suivi sur le tableau de bord',
    desc: "Le QR épinglé au tableau de bord (menu « Suivre sur le tableau de bord ») et ses scans. Répond à « le QR que je suis », « mon QR épinglé, il en est où ? ».",
    target: '.sdqr-qr-grid',
    params: [],
    run: async () => {
      /* écrit par le menu ⋯ de la bibliothèque : { id: short_id, name } (sdqr.js:565) */
      const f = _ls('ks_sdqr_followed', null);
      if (!f || !f.id) return { suivi: false, message: 'Aucun QR suivi sur le tableau de bord.' };
      const { qrs } = await _api('/api/qr');
      const q = (qrs || []).find(x => x.short_id === f.id);
      if (!q) return { suivi: true, nom: f.name || null,
                       message: 'Le QR suivi n’existe plus dans la flotte.' };
      let scans_7_jours = null, tendance = null;
      try {
        const o = await _api('/api/qr/overview?period=7d');
        const lb = (o.leaderboard || []).find(l => l.short_id === f.id);
        if (lb) { scans_7_jours = lb.scans;
                  tendance = ({ up: 'en hausse', down: 'en baisse', flat: 'stable' })[lb.trend] || 'stable'; }
        else {
          /* le leaderboard est tronqué au top 8 (qr.js:627) : un QR suivi
             en 9e position scanne peut-être — on va chercher SES stats
             plutôt que de laisser croire « pas de données » */
          const s7 = await _api(`/api/qr/${encodeURIComponent(q.id)}/stats?period=7d`);
          scans_7_jours = s7.totals?.week ?? null;
        }
      } catch (e) { /* tendance facultative : les totaux suffisent */ }
      return { suivi: true, nom: q.name || '(sans nom)', statut: q.status || 'active',
               scans_total: q.scans_total || 0, scans_7_jours, tendance,
               destination: q.target_url || null, cree: _frDate(q.created_at) };
    },
  },

  /* ═══ SENTINEL (pad O-GEO-001 — audit web avec suivi, 19/07/2026) ═══
     Endpoints en or : GET /api/sentinel/sites (la flotte : état + score) et
     GET /sites/:id/cockpit (tout : 7 axes, findings, GEO, mots-clés,
     tendances). Résolution d'un site PAR NOM comme les QR (_sntByName) ;
     particularité : la plupart des comptes n'ont QU'UN site (limite plan
     Starter = 1) → le paramètre site est optionnel, un site unique se
     résout tout seul. Dates SQLite UTC → _frDate(_sqlUtc()). */
  {
    id: 'snt.fleet', pad: 'sentinel', mode: 'read',
    label: 'État de mes sites surveillés',
    desc: "Mes sites sous surveillance Sentinel : en ligne / hors ligne, disponibilité 24 h, temps de réponse, score d'audit global, date du dernier audit. Répond à « mon site est en ligne ? », « mes sites vont bien ? », « Sentinel dit quoi ? ».",
    target: '.snt-app .ws-topbar-title',
    params: [],
    run: async () => {
      const d = await _sntApi('/sites');
      const sites = d.sites || [];
      if (!sites.length)
        return { total: 0, message: 'Aucun site surveillé pour l’instant — ajoute ton site dans Sentinel pour lancer la surveillance.' };
      return {
        total: sites.length, limite_du_plan: d.limit ?? null,
        sites: sites.map(s => ({
          nom: s.label || _sntHost(s.url), url: s.url,
          plateforme: ({ wix: 'Wix', wordpress: 'WordPress', custom: 'sur-mesure' })[s.platform] || null,
          /* null = jamais vérifié (site tout neuf) — pas « hors ligne » */
          en_ligne: s.last_checked_at ? (s.last_ok === 1 || s.last_ok === true) : null,
          /* null tant qu'aucun check en 24 h (site tout neuf) — pas 0 */
          disponibilite_24h: s.uptime24h != null ? s.uptime24h + ' %' : null,
          temps_reponse_ms: s.last_ms ?? null,
          verifie_le: _frDate(_sqlUtc(s.last_checked_at)),
          pannes_consecutives: s.consecutive_fails || 0,
          score_audit: s.last_score ?? null,
          audit_du: _frDate(_sqlUtc(s.last_audit_at)),
        })),
        note: sites.some(s => s.last_score == null)
          ? 'score_audit null = jamais audité — l’action snt.run_audit lance l’audit.' : undefined,
      };
    },
  },
  {
    id: 'snt.site_report', pad: 'sentinel', mode: 'read',
    label: 'Rapport complet d’un site',
    desc: "Le rapport Sentinel d'UN site : score global et par axe (SEO, sécurité, performance, dispo…), points à corriger priorisés, visibilité IA, tendances. Répond à « qu'est-ce qui cloche sur mon site ? », « mon score SEO ? ».",
    target: '.snt-app .ws-topbar-title',
    params: [
      { name: 'site', type: 'string', required: false, desc: 'nom ou adresse (même partiels) ; inutile si un seul site surveillé' },
    ],
    run: async (args = {}) => {
      const site = await _sntResolve(args.site);
      const { cockpit: c } = await _sntApi(`/sites/${encodeURIComponent(site.id)}/cockpit`);
      const a = c.audit;
      const out = {
        site: site.label || _sntHost(site.url), url: site.url,
        en_ligne: c.site.last_checked_at ? (c.site.last_ok === 1 || c.site.last_ok === true) : null,
        verifie_le: _frDate(_sqlUtc(c.site.last_checked_at)),
        disponibilite_30j: c.uptime30d != null ? c.uptime30d + ' %' : null,
        tendance_disponibilite: ({ up: 'en hausse', down: 'en baisse', stable: 'stable' })[c.uptimeTrend] || 'stable',
        https: !!(c.ssl && c.ssl.https),
      };
      if (!a) {
        out.audit = null;
        out.message = 'Ce site n’a pas encore été audité — l’action snt.run_audit lance l’audit complet (environ une minute).';
        return out;
      }
      out.score_global = a.score ?? null;
      /* delta en POINTS vs l'audit d'il y a ~7 j (déjà calculé serveur) */
      out.evolution_7j = c.scoreTrend != null ? (c.scoreTrend > 0 ? '+' : '') + c.scoreTrend + ' pts' : null;
      out.audit_du = _frDate(_sqlUtc(a.created_at));
      const AXES_FR = { disponibilite: 'Disponibilité', performance: 'Performance', seo: 'SEO technique',
                        securite: 'Sécurité', accessibilite: 'Accessibilité', presence: 'Présence locale', keywords: 'Mots-clés' };
      out.axes = {};
      for (const [k, label] of Object.entries(AXES_FR))
        if (a.scores && a.scores[k] != null) out.axes[label] = a.scores[k];
      const SEV_ORD = { high: 0, medium: 1, low: 2 };
      const SEV_FR = { high: 'élevé', medium: 'moyen', low: 'faible' };
      out.points_a_corriger = (a.findings || [])
        .slice().sort((x, y) => (SEV_ORD[x.sev] ?? 3) - (SEV_ORD[y.sev] ?? 3))
        .slice(0, 6)
        .map(f => ({ gravite: SEV_FR[f.sev] || f.sev, axe: AXES_FR[f.axis] || f.axis,
                     probleme: f.title, conseil: _excerpt(f.detail, 160) }));
      const restants = (a.findings || []).length - out.points_a_corriger.length;
      if (restants > 0) out.points_a_corriger_en_plus = restants;
      /* GEO : servi SEULEMENT si un relevé existe — un score null sur une
         surface non configurée tenterait le modèle de l'expliquer en inventant */
      if (c.geo && c.geo.configured && c.geo.score != null)
        out.visibilite_ia = { score: c.geo.score, releve_du: _frDate(_sqlUtc(c.geo.run_at)) };
      else if (c.geo && c.geo.enabled)
        out.visibilite_ia = { configuree: false, info: 'La visibilité IA se configure dans le panneau du site (Sentinel).' };
      if (c.gsc && c.gsc.connected && c.gsc.score != null)
        out.mots_cles_google = { score: c.gsc.score, releve_du: _frDate(_sqlUtc(c.gsc.run_at)) };
      return out;
    },
  },

  /* ═══ KEYNAPSE (pad O-Keyn-001 — notes en bulles, 19/07/2026) ═══
     Pas d'endpoint « recherche » côté serveur : GET /state renvoie TOUTE
     la constellation (zones+bulles+liens, plafond 2000 bulles) — le tri se
     fait ici, côté client, comme pour SDQR/Sentinel. Résolution d'une bulle
     PAR TITRE (_knResolve, même patron que _sntResolve/_qrByName) : exact
     d'abord, partiel ensuite, accents ignorés. Dates : created_at/updated_at
     des bulles = SQLite _sqlUtc ; `at` des rappels est DÉJÀ un ISO complet
     (keynapse.js:702, _sqlUtc no-op dessus — sûr par construction). */
  {
    id: 'kn.search', pad: 'keynapse', mode: 'read',
    label: 'Chercher dans mes notes',
    desc: "Cherche un mot-clé dans le titre ou le texte de mes bulles Keynapse : zone, avancement des tâches, nombre de rappels. Répond à « qu'est-ce que j'ai noté sur… », « cherche … dans mes notes ».",
    target: '.kyn-app .ws-topbar-title',
    params: [{ name: 'query', type: 'string', required: true, desc: 'mot ou expression à chercher' }],
    run: async (args = {}) => {
      const q = String(args.query || '').trim();
      if (!q) throw new Error('Il me faut un mot-clé à chercher.');
      const { zones, bubbles } = await _knApi('/state');
      const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const n = norm(q);
      const zoneName = id => (zones || []).find(z => z.id === id)?.name || null;
      const hits = (bubbles || []).filter(b => norm(b.title).includes(n) || norm(b.description).includes(n));
      if (!hits.length) return { trouve: 0, message: `Rien trouvé pour « ${q} » dans tes notes.` };
      return {
        trouve: hits.length,
        notes: hits.slice(0, 8).map(b => ({
          titre: b.title, zone: zoneName(b.zone_id),
          extrait: b.description ? _excerpt(b.description, 160) : null,
          modifie_le: _frDate(_sqlUtc(b.updated_at)),
        })),
        en_plus: hits.length > 8 ? hits.length - 8 : undefined,
      };
    },
  },
  {
    id: 'kn.list_reminders', pad: 'keynapse', mode: 'read',
    label: 'Mes rappels Keynapse',
    desc: "Mes rappels posés sur des notes Keynapse : à venir et en retard, avec la note concernée, l'échéance et la répétition. Répond à « quels sont mes rappels ? », « j'ai des rappels en retard ? ».",
    target: '.kyn-app .ws-topbar-title',
    params: [],
    run: async () => {
      const { reminders } = await _knApi('/reminders');
      const list = reminders || [];
      if (!list.length) return { total: 0, message: 'Aucun rappel posé dans Keynapse.' };
      const now = Date.now();
      const REPEAT_FR = { daily: 'chaque jour', weekly: 'chaque semaine', monthly: 'chaque mois' };
      const shaped = list.map(r => ({
        note: r.bubble_title, libelle: r.label || null,
        echeance: _frDate(r.at), en_retard: !r.notified_at && Date.parse(r.at) < now,
        repetition: REPEAT_FR[r.repeat] || null,
      }));
      return {
        total: shaped.length,
        en_retard: shaped.filter(r => r.en_retard).length,
        rappels: shaped.slice(0, 10),
        en_plus: shaped.length > 10 ? shaped.length - 10 : undefined,
      };
    },
  },
  {
    id: 'kn.read_bubble', pad: 'keynapse', mode: 'read',
    label: 'Lire une note précise',
    desc: "Le détail d'UNE bulle Keynapse retrouvée par son titre : zone, texte, tâches (faites/restantes), notes libres, nombre de photos/dessins/mémos vocaux, rappels. Répond à « qu'est-ce qu'il y a dans ma note … ? ».",
    target: '.kyn-app .ws-topbar-title',
    params: [{ name: 'title', type: 'string', required: true, desc: 'titre (même partiel) de la bulle' }],
    run: async (args = {}) => {
      const b = await _knResolve(args.title);
      const d = await _knApi(`/bubbles/${encodeURIComponent(b.id)}`);
      const todos = d.todos || [];
      return {
        titre: d.bubble.title, zone: b.zoneName,
        texte: d.bubble.description ? _excerpt(d.bubble.description, 300) : null,
        taches: todos.length ? { faites: todos.filter(t => t.done).length, total: todos.length,
                                  restantes: todos.filter(t => !t.done).map(t => t.label).slice(0, 5) } : null,
        notes_libres: (d.notes || []).slice(0, 3).map(n => _excerpt(n.body, 200)),
        photos_dessins: (d.media || []).length,
        memos_vocaux: (d.audios || []).length,
        rappels: (d.reminders || []).map(r => ({ echeance: _frDate(r.at), libelle: r.label || null })),
        modifie_le: _frDate(_sqlUtc(d.bubble.updated_at)),
      };
    },
  },

  /* ═══ SMART AGENT (pad O-AGT-001 — jumeaux de savoir-faire, K-8 20/07/2026) ═══
     MAX only en beta : le worker répond 403 « Smart Agent est réservé au
     plan MAX pendant la beta. » sur un plan inférieur — _saApi restitue ce
     message tel quel (mêmes vertus que _sntApi/_knApi), pas de garde ici.
     Résolution d'un jumeau PAR NOM, même patron que Sentinel (_sntResolve) :
     un seul jumeau se résout tout seul sans référence. Dates SQLite UTC
     (agents/gaps/liens) → _frDate(_sqlUtc()) ; expires_at d'un lien est une
     date PURE (YYYY-MM-DD), _frDate la gère déjà sans heure fantôme. */
  {
    id: 'sa.list_agents', pad: 'smartagent', mode: 'read',
    label: 'Lister mes jumeaux Smart Agent',
    desc: "Mes jumeaux de savoir-faire : nom, statut (en ligne, en pause, brouillon), mission, trous de savoir ouverts (total et cette semaine). Répond à « mes agents », « combien de jumeaux j'ai », « quel agent a des trous ? ».",
    target: '.sa-app .ws-topbar-title',
    params: [],
    run: async () => {
      const { agents } = await _saApi('/agents');
      if (!agents.length)
        return { total: 0, message: 'Aucun jumeau créé pour l’instant — Smart Agent en crée un en quelques minutes.' };
      const STATUT_FR = { published: 'en ligne', paused: 'en pause', draft: 'brouillon' };
      return {
        total: agents.length,
        jumeaux: agents.map(a => ({
          nom: a.name, statut: STATUT_FR[a.status] || a.status,
          mission: a.config?.identity?.mission ? _excerpt(a.config.identity.mission, 160) : null,
          trous_ouverts: a.gaps_open || 0, trous_semaine: a.gaps_week || 0,
        })),
      };
    },
  },
  {
    id: 'sa.gaps', pad: 'smartagent', mode: 'read',
    label: 'Trous de savoir d’un jumeau',
    desc: "Les questions auxquelles CE jumeau n'a pas su répondre : combien de fois demandées, si c'est récent (7 derniers jours). Répond à « qu'est-ce que mon agent ne sait pas répondre ? », « les trous de … ».",
    target: '.sa-app .ws-topbar-title',
    params: [{ name: 'name', type: 'string', required: false, desc: 'nom (même partiel) du jumeau ; inutile si un seul jumeau' }],
    run: async (args = {}) => {
      const agent = await _saResolve(args.name);
      const { gaps } = await _saApi(`/gaps?agent=${encodeURIComponent(agent.id)}`);
      if (!gaps.length)
        return { jumeau: agent.name, total: 0, message: 'Aucun trou ouvert — ce jumeau répond à tout ce qu’on lui a demandé.' };
      const now = Date.now();
      /* déjà triés hits DESC, last_asked_at DESC côté serveur (smart-agent.js) —
         le top 10 EST la plus fréquente/récente, aucun tri à refaire ici */
      const shaped = gaps.map(g => ({
        question: g.question, demandee: g.hits,
        recente: Date.parse(_sqlUtc(g.last_asked_at)) >= now - 7 * 86400e3,
        derniere_fois: _frDate(_sqlUtc(g.last_asked_at)),
      }));
      return {
        jumeau: agent.name, total: shaped.length,
        cette_semaine: shaped.filter(g => g.recente).length,
        trous: shaped.slice(0, 10),
        en_plus: shaped.length > 10 ? shaped.length - 10 : undefined,
      };
    },
  },
  {
    id: 'sa.kortex_overview', pad: 'smartagent', mode: 'read',
    label: 'État du coffre de savoir d’un jumeau',
    desc: "Combien de fiches dans le coffre Kortex d'UN jumeau, par statut et par type (fait, procédure, question-réponse…). Répond à « combien de fiches a mon agent ? », « l'état de son coffre ».",
    target: '.sa-app .ws-topbar-title',
    params: [{ name: 'name', type: 'string', required: false, desc: 'nom (même partiel) du jumeau ; inutile si un seul jumeau' }],
    run: async (args = {}) => {
      const agent = await _saResolve(args.name);
      const { units, counts } = await _saApi(`/kortex/units?agent=${encodeURIComponent(agent.id)}`);
      if (!counts.total)
        return { jumeau: agent.name, total: 0, message: 'Coffre vide — aucune fiche de savoir pour l’instant.' };
      /* tally par type SUR LA PAGE reçue (plafond serveur 500 fiches, kortex/
         units:83) — les compteurs de statut, eux, viennent d'un GROUP BY exact
         et restent fiables même au-delà du plafond (revue adverse K-8) */
      const TYPE_FR = { fact: 'fait', procedure: 'procédure', qa: 'question-réponse',
        case: 'cas vécu', rule: 'règle', objection: 'objection', definition: 'définition' };
      const parType = {};
      for (const u of units) { const l = TYPE_FR[u.type] || u.type; parType[l] = (parType[l] || 0) + 1; }
      const out = {
        jumeau: agent.name, total: counts.total,
        validees: counts.validated, brouillon: counts.draft,
        quarantaine: counts.quarantine, perimees: counts.expired,
        par_type: parType,
      };
      if (units.length < counts.total)
        out.note = 'Détail par type limité aux 500 dernières fiches — les totaux par statut, eux, sont exacts.';
      return out;
    },
  },
  {
    id: 'sa.public_usage', pad: 'smartagent', mode: 'read',
    label: 'Usage du lien public d’un jumeau',
    desc: "Le lien public d'UN jumeau, s'il est publié : questions posées aujourd'hui/au total, actif ou révoqué, échéance. Répond à « combien de gens ont parlé à mon agent ? », « mon lien public marche encore ? ».",
    target: '.sa-app .ws-topbar-title',
    params: [{ name: 'name', type: 'string', required: false, desc: 'nom (même partiel) du jumeau ; inutile si un seul jumeau' }],
    run: async (args = {}) => {
      const agent = await _saResolve(args.name);
      if (agent.status !== 'published')
        return { jumeau: agent.name, publie: false, message: 'Ce jumeau n’est pas publié — aucun lien public pour l’instant.' };
      const { links } = await _saApi(`/agents/${encodeURIComponent(agent.id)}/links`);
      const active = (links || []).filter(l => l.status === 'active');
      if (!active.length)
        return { jumeau: agent.name, publie: true, message: 'Publié, mais aucun lien actif — aucun accès public en ce moment.' };
      return {
        jumeau: agent.name, publie: true,
        liens: active.map(l => ({
          questions_aujourdhui: l.usage_today || 0, questions_total: l.usage_total || 0,
          plafond_jour: l.max_per_day, expire_le: _frDate(l.expires_at), url: l.url,
        })),
      };
    },
  },

  /* ═══════════════════════════════════════════════════════════════
     V1.1 — LES ÉCRITURES SÛRES (sprint « Kora agit », 18/07/2026)
     Rien d'irréversible, rien ne part vers l'extérieur : préparer,
     préremplir, ouvrir. Publier/programmer/supprimer restent derrière
     la ligne rouge (§7) — ces verbes n'existent pas ici.
     Imports DYNAMIQUES à l'exécution : le module reste inerte au
     chargement, et on suit les passerelles que les pads s'échangent
     déjà entre eux (cartographie 18/07, fichier:ligne dans chaque run).
     ═══════════════════════════════════════════════════════════════ */
  {
    id: 'sm.compose_draft', pad: 'social', mode: 'write',
    label: 'Préparer un post dans le composer',
    desc: "Met un texte dans le composer Social Manager (réseaux cochés si fournis) et ouvre l'outil. NE PUBLIE PAS — le bouton Publier reste à l'utilisateur. Répond à « prépare-moi un post sur… », « mets ça dans le composer ».",
    target: '#sm-text',
    params: [
      { name: 'text', type: 'string', required: true, desc: 'le texte du post' },
      { name: 'networks', type: 'array', required: false, desc: 'réseaux visés parmi facebook, instagram, linkedin, threads, telegram' },
      { name: 'append', type: 'boolean', required: false, desc: 'true = ajouter au brouillon existant au lieu de le remplacer' },
    ],
    run: async (args = {}) => {
      const text = String(args.text || '').trim();
      if (!text) throw new Error('Il me faut le texte du post.');
      _guardGwModal();
      const targets = _validNetworks(args.networks);
      const { openTool } = await import('./ui-renderer.js');
      /* revue 18/07 — faux succès sous gating : si la licence n'a pas
         l'outil, openTool ouvre le paywall et n'écrit RIEN. On le dit. */
      if (!(await _padAccessible('O-SOC-001'))) {
        openTool('O-SOC-001');
        return { fait: false, raison: 'Le Social Manager n’est pas dans la licence — sa fiche est ouverte à l’écran.' };
      }
      /* filet : l'ancien brouillon est sauvegardé avant remplacement */
      const prev = _ls('ks_social_manager_draft_v1', null);
      if (prev && (prev.text || '').trim() && args.append !== true) {
        try { localStorage.setItem('kora_sm_prev_draft', JSON.stringify(prev)); } catch (e) { /* plein */ }
      }
      /* openTool relaie opts.compose à O-SOC-001 (ui-renderer.js:2235) */
      openTool('O-SOC-001', { compose: { text, targets, append: args.append === true } });
      return { fait: true, outil_ouvert: 'Social Manager',
               texte: _excerpt(text, 200), reseaux: targets.length ? targets : 'inchangés',
               rappel: 'Rien n’est publié : le bouton Publier reste à l’utilisateur.' };
    },
  },
  {
    id: 'gw.rewrite_text', pad: 'ghostwriter', mode: 'write',
    label: 'Envoyer un texte au Ghost Writer',
    desc: "Ouvre le Ghost Writer avec un texte prêt à réécrire (3 variantes) — l'utilisateur choisit et lance lui-même. Répond à « fais réécrire ça », « améliore ce texte ».",
    target: '#gw-source',
    params: [{ name: 'text', type: 'string', required: true, desc: 'le texte à faire réécrire' }],
    run: async (args = {}) => {
      const text = String(args.text || '').trim();
      if (!text) throw new Error('Il me faut le texte à réécrire.');
      /* revue 18/07 — un modal GW déjà ouvert ignore l'appel (garde
         _openModal) MAIS l'appel muterait sa source : on s'arrête AVANT */
      if (document.getElementById('gw-overlay'))
        throw new Error('Le Ghost Writer est déjà ouvert — ferme-le d’abord, puis redemande-moi.');
      const gw = await import('./ghostwriter.js');
      const { isChainActive } = await import('./lib/content-chain.js');
      /* chaîne active → entrée chaîne (cohérente, sans flag) ; sinon
         entrée standard, gardée par un flag (no-op silencieux qu'on
         transforme en refus clair, sans jargon) */
      if (isChainActive()) {
        gw.openGhostwriterChained(text);
      } else {
        if (typeof gw.isGhostwriterEnabled === 'function' && !gw.isGhostwriterEnabled())
          throw new Error('Le service de réécriture n’est pas activé sur ce poste.');
        gw.openGhostwriter(text);
      }
      return { fait: true, outil_ouvert: 'Ghost Writer', texte: _excerpt(text, 200),
               rappel: 'La réécriture se lance d’un clic — le choix de la variante reste à l’utilisateur.' };
    },
  },
  {
    id: 'bs.start_session', pad: 'brainstorming', mode: 'write',
    label: 'Lancer un brainstorming avec un brief',
    desc: "Lance une séance de brainstorming sur un sujet — le comité débat aussitôt (la séance consomme ses crédits IA). Répond à « lance un brainstorming sur… ».",
    target: '#wr-input',
    params: [{ name: 'brief', type: 'string', required: true, desc: 'le sujet à faire débattre' }],
    run: async (args = {}) => {
      const brief = String(args.brief || '').trim();
      if (!brief) throw new Error('Il me faut le sujet du brainstorming.');
      _guardGwModal();
      /* revue 18/07 — rouvrir écraserait une séance en cours (le shell
         est réécrit) : on protège le travail de l'utilisateur */
      if (document.querySelector('#wr-fullscreen.open'))
        throw new Error('Une séance de brainstorming est déjà ouverte — termine-la ou ferme-la, puis redemande-moi.');
      /* import direct comme le fait Social Manager (social-manager.js:815) :
         le routage standard openTool jette les opts (ui-renderer.js:2246).
         PAS de mode passé → défaut 'exploration' (un mode inconnu
         retomberait sur post-ideas et poserait une chaîne par erreur). */
      const { openBrainstorming } = await import('./brainstorming.js');
      openBrainstorming({ brief });
      /* elle fonce (19/07) : le clic de lancement est le sien — coach de
         brief géré comme dans chain.start (2e clic = lancement).
         Pause visible AVANT d'envoyer (retour 19/07 : « le champ ne se
         remplit pas » — en fait il se vide à l'instant même où il se
         remplit, le clic suivait sans délai) : on VOIT le brief posé
         (§6 « on voit Kora travailler »), puis il part. */
      await new Promise(r => setTimeout(r, 500));
      const send = document.getElementById('wr-send');
      send?.click();
      if (document.querySelector('#wr-fullscreen .wr-brief-coach') && document.getElementById('wr-feed-empty'))
        send?.click();
      const lancee = !!document.querySelector('#wr-fullscreen.open') && !document.getElementById('wr-feed-empty');
      return { fait: true, outil_ouvert: 'Brainstorming', brief: _excerpt(brief, 200),
               seance: lancee ? 'lancée — le comité débat' : 'brief posé — lancement à l’écran',
               rappel: lancee ? 'La synthèse arrive en fin de tour de table.' : null };
    },
  },
  {
    id: 'chain.start', pad: 'chaine', mode: 'write',
    label: 'Démarrer la chaîne de contenu',
    desc: "Lance et PILOTE la chaîne Brainstorming→Ghost Writer→Social : Kora démarre, fait les relais ; l'utilisateur choisit l'idée puis publie. LA voie pour RÉDIGER. Répond à « rédige-moi un article/post sur… », « démarre la chaîne ».",
    target: '#wr-chain-slot',
    params: [
      { name: 'network', type: 'string', required: false, desc: 'facebook, instagram, linkedin, threads ou telegram — si déjà connu' },
      { name: 'brief', type: 'string', required: false, desc: 'le sujet, si déjà connu' },
    ],
    run: async (args = {}) => {
      const nets = _validNetworks([args.network]);
      if (args.network && !nets.length)
        throw new Error(`Réseau inconnu : ${args.network}. Choix : facebook, instagram, linkedin, threads, telegram.`);
      _guardGwModal();
      if (document.querySelector('#wr-fullscreen.open'))
        throw new Error('Une séance de brainstorming est déjà ouverte — termine-la ou ferme-la, puis redemande-moi.');
      const { setChain } = await import('./lib/content-chain.js');
      const { openBrainstorming } = await import('./brainstorming.js');
      /* sans réseau : la séance post-ideas affiche son sélecteur (natif) */
      setChain({ step: 'ideas', origin: 'kora', network: nets[0] || null });
      const opts = { mode: 'post-ideas' };
      if (String(args.brief || '').trim()) opts.brief = String(args.brief).trim();
      /* auto-ancrage (fix immobilier 19/07, révisé 2 fois) : si le sujet EST
         Keystone, la description officielle _KEYSTONE_FACTS est TOUJOURS posée
         en source — 3e retour Stéphane (« l'article invente encore de
         l'immobilier, malgré le Gest actif ») : le Gest seul ne suffit pas.
         Son Kortex ne contient que des fiches d'APPS individuelles
         (ingest-apps-to-kortex.mjs) — rien qui dise ce que Keystone EST
         globalement, ni le « n'est PAS de l'immobilier » ; sur un angle
         « présentation », le retrieval peut même faire no-hits → plus AUCUN
         ancrage nulle part (ni débat, ni Ghost Writer). La source statique
         est le plancher factuel (worker : DOSSIER SOURCE) ; le Gest s'y
         AJOUTE quand il est résoluble (fiches réelles, DOSSIER MAISON) au
         lieu de la remplacer. */
      let ancree = null;
      if (opts.brief && _isKeystoneTopic(opts.brief)) {
        opts.source = { text: _KEYSTONE_FACTS, title: 'À propos de Keystone', ref: 'Keystone OS — description officielle du produit' };
        ancree = 'la séance est ancrée sur la description officielle de Keystone';
        const gestId = await _resolveKeystoneGest();
        if (gestId) {
          opts.inviteGest = true; opts.gestAgentId = gestId;
          ancree += ', et le Conseiller Keystone (savoir maison réel) débat à la table';
        }
      }
      openBrainstorming(opts);
      /* ELLE FONCE (décision Stéphane 19/07) : Kora LANCE la séance — les
         seuls gestes humains de la chaîne sont choisir l'idée et publier.
         Brief < 60 car. : le coach intercepte UNE fois par page
         (brainstorming.js:608, flag consommé) → le 2e clic lance ; le
         coach s'adresse aux humains, Kora est l'autrice du brief. */
      let lancee = false;
      if (opts.brief) {
        /* pause visible AVANT d'envoyer (même leçon que bs.start_session,
           revue 19/07) : le brief se voit posé avant de partir */
        await new Promise(r => setTimeout(r, 500));
        const send = document.getElementById('wr-send');
        send?.click();
        if (document.querySelector('#wr-fullscreen .wr-brief-coach') && document.getElementById('wr-feed-empty'))
          send?.click();
        lancee = !!document.querySelector('#wr-fullscreen.open') && !document.getElementById('wr-feed-empty');
        if (lancee) {
          const { koraChainPilot } = await import('./kora-chain.js');
          koraChainPilot({ brief: opts.brief });
        }
      }
      return { fait: true, chaine: 'démarrée', reseau: nets[0] || 'à choisir dans l’outil',
               seance: lancee ? 'lancée — le comité débat, Kora fera les relais' : 'ouverte — brief à poser puis lancer à l’écran',
               brief: opts.brief ? _excerpt(opts.brief, 200) : null,
               ancrage: ancree,   // null, ou « …le Conseiller Keystone… » / « …description officielle… »
               rappel: lancee
                 ? 'Deux gestes restent à l’utilisateur : choisir l’idée à la synthèse, puis publier.'
                 : 'La séance se lance à l’écran.' };
    },
  },
  {
    id: 'chain.pick_idea', pad: 'chaine', mode: 'write',
    label: 'Choisir l’idée à rédiger',
    desc: "Quand les idées du brainstorming sont affichées (synthèse), valide CELLE que l'utilisateur désigne — numéro 1-5 ou ses mots — et le Ghost Writer prend le relais. Répond à « la 2 », « prends celle sur… », « la première ».",
    target: '#wr-synthesis-drawer',
    params: [{ name: 'choice', type: 'string', required: true, desc: 'numéro (1-5) ou mots de l’idée choisie par l’utilisateur' }],
    run: async (args = {}) => {
      const btns = [...document.querySelectorAll('#wr-synthesis-drawer .wr-idea-relay')];
      if (!btns.length)
        throw new Error('Aucune idée affichée pour l’instant — elles apparaissent à la synthèse de la séance.');
      if (document.getElementById('gw-overlay'))
        throw new Error('Le Ghost Writer est déjà ouvert — ferme-le d’abord, puis redis-moi ton choix.');
      const raw = String(args.choice || '').trim();
      if (!raw) throw new Error(`Dis-moi laquelle : son numéro (1-${btns.length}) ou ses mots.`);
      let btn = null;
      const numMatch = /^\d+$/.test(raw) ? [raw, raw] : raw.match(/\b([1-9])\b/);
      const num = numMatch ? parseInt(numMatch[1], 10) : null;
      if (num && num >= 1 && num <= btns.length) btn = btns[num - 1];
      if (!btn) {
        const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const n = norm(raw);
        const hits = btns.filter(b => norm(b.dataset.idea || '').includes(n));
        if (hits.length === 1) btn = hits[0];
        else if (hits.length > 1)
          throw new Error(`Plusieurs idées correspondent — donne le numéro (1-${btns.length}).`);
      }
      if (!btn) throw new Error(`Je ne retrouve pas cette idée — donne son numéro (1-${btns.length}).`);
      const idee = btn.dataset.idea || '';
      /* = le clic « Rédiger » de la carte : setChain('write') +
         openGhostwriterChained(idée) (brainstorming.js:1638/1172) */
      btn.click();
      /* le pilote prend (ou garde) la main : il composera puis enverra
         au composer — prochains arrêts humains : aucun avant Publier */
      const { koraChainPilot, koraChainPhase } = await import('./kora-chain.js');
      if (!koraChainPhase()) koraChainPilot({ phase: 'idee' });
      return { fait: true, idee: _excerpt(idee, 160),
               suite: 'Ghost Writer ouvert — je compose le post puis je l’envoie au composer ; tu n’auras plus qu’à publier.' };
    },
  },
  {
    id: 'chain.cancel', pad: 'chaine', mode: 'write',
    label: 'Arrêter de suivre la chaîne',
    desc: "Arrête le pilotage auto de la chaîne (Kora ne clique/n'entoure plus rien) — ne supprime ni ne publie rien, l'utilisateur reprend la main où ça en est. Répond à « annule », « arrête », « laisse tomber », « stop la chaîne ».",
    target: '.ks-chain',
    params: [],
    run: async () => {
      /* revue 19/07 (retour Stéphane) : sans cette action, le modèle
         répondait « c'est annulé » sans RIEN faire (aucune action du
         catalogue pour ça) — l'anneau restait allumé, le pilote tournait
         toujours. 2e retour (« le trait tourne toujours sur Publier ») :
         on ne gate PLUS l'arrêt sur koraChainPhase() (une lecture de phase
         périmée sautait koraChainStop) — on arrête TOUJOURS. koraChainStop
         bumpe la génération (tue tout timer, cf. kora-chain.js) et efface
         les anneaux. */
      const { koraChainPhase, koraChainStop } = await import('./kora-chain.js');
      const wasRunning = !!koraChainPhase();
      koraChainStop();
      /* filet : efface aussi les anneaux + repose l'état depuis LA MÊME
         instance kora.js que la boucle — couvre le cas où le pilote n'a
         jamais tourné dans cette session (_kora null dans _stop) mais où
         un anneau traînerait malgré tout. */
      try { const k = await import('./kora.js'); k.koraClearRings(); k.koraState('repos'); } catch (e) { /* galet absent */ }
      /* la séance de brainstorming, elle, reste ouverte (on ne ferme rien) :
         chain.start/bs.start_session refuseront de relancer tant qu'elle
         l'est (garde existante) — d'où l'indice. */
      const encoreOuvert = !!document.querySelector('#wr-fullscreen.open');
      if (!wasRunning)
        return { fait: true, suivi: false,
                 message: 'Je ne suivais aucune chaîne — j’ai quand même tout remis au repos.' };
      return { fait: true, suivi: true,
               message: 'J’arrête de suivre — rien n’est supprimé ni publié, tu reprends la main où ça en est.'
                 + (encoreOuvert ? ' Ferme la fenêtre du brainstorming si tu veux repartir sur un autre sujet.' : '') };
    },
  },
  {
    id: 'os.open_pad', pad: 'os', mode: 'write',
    label: 'Ouvrir un outil',
    desc: "Ouvre un outil du catalogue : brainstorming, ghostwriter, social, qr, sentinel, keynapse ou smartagent. Répond à « ouvre-moi le Social Manager ».",
    target: '.ws-app',
    params: [{ name: 'pad', type: 'string', required: true, desc: 'brainstorming | ghostwriter | social | qr | sentinel | keynapse | smartagent' }],
    run: async (args = {}) => {
      const KORA_PADS = {
        brainstorming: ['A-COM-003', 'le Brainstorming'], ghostwriter: ['A-COM-005', 'le Ghost Writer'],
        social: ['O-SOC-001', 'le Social Manager'],
        'ghost writer': ['A-COM-005', 'le Ghost Writer'], 'social manager': ['O-SOC-001', 'le Social Manager'],
        qr: ['A-COM-001', 'Smart Dynamic QR'], sdqr: ['A-COM-001', 'Smart Dynamic QR'],
        'qr codes': ['A-COM-001', 'Smart Dynamic QR'], 'smart dynamic qr': ['A-COM-001', 'Smart Dynamic QR'],
        sentinel: ['O-GEO-001', 'Sentinel'], audit: ['O-GEO-001', 'Sentinel'],
        keynapse: ['O-Keyn-001', 'Keynapse'], notes: ['O-Keyn-001', 'Keynapse'],
        smartagent: ['O-AGT-001', 'le Smart Agent'], 'smart agent': ['O-AGT-001', 'le Smart Agent'],
        jumeaux: ['O-AGT-001', 'le Smart Agent'], kortex: ['O-AGT-001', 'le Smart Agent'],
      };
      const key = String(args.pad || '').trim().toLowerCase();
      const entry = KORA_PADS[key];
      if (!entry) throw new Error(`Outil inconnu : ${args.pad}. Choix : brainstorming, ghostwriter, social, qr, sentinel, keynapse, smartagent.`);
      _guardGwModal();
      const [padId, nom] = entry;
      /* openTool = LA porte gated (licence + Living Layer, ui-renderer.js:2192) */
      const { openTool } = await import('./ui-renderer.js');
      if (!(await _padAccessible(padId))) {
        openTool(padId);
        return { fait: false, raison: `${nom} n’est pas dans la licence — sa fiche est ouverte à l’écran.` };
      }
      openTool(padId);
      return { fait: true, outil_ouvert: nom };
    },
  },

  /* ═══ SMART DYNAMIC QR — écritures sûres (V1.2) ═══ */
  {
    id: 'qr.open', pad: 'sdqr', mode: 'write',
    label: 'Ouvrir Smart Dynamic QR',
    desc: "Ouvre l'outil Smart Dynamic QR — directement sur la fiche d'un QR si un nom est donné. Répond à « ouvre mes QR codes », « montre-moi le QR … ».",
    target: '.sdqr-topbar',
    params: [{ name: 'name', type: 'string', required: false, desc: 'nom du QR à ouvrir (défaut : la bibliothèque)' }],
    run: async (args = {}) => {
      _guardGwModal();
      _guardSdqrCreate();
      const ref = String(args.name || '').trim();
      let opts = {}, extra = {};
      if (ref) {
        const { qrs } = await _api('/api/qr');
        const found = _qrByName(qrs || [], ref);
        if (!found.match) {
          if (found.candidates.length)
            throw new Error(`Plusieurs QR correspondent à « ${ref} » : ${found.candidates.join(' · ')}. Précise le nom.`);
          throw new Error(`Aucun QR nommé « ${ref} » — je peux ouvrir la bibliothèque si tu veux.`);
        }
        /* openSDQR relaie opts.editId = ouverture directe de la fiche (sdqr.js:238) */
        opts = { editId: found.match.id };
        extra = { qr: found.match.name };
      }
      return _openSdqrHonest(opts, extra);
    },
  },
  {
    id: 'qr.prepare_url', pad: 'sdqr', mode: 'write',
    label: 'Préparer un QR code URL',
    desc: "Ouvre la création d'un QR avec l'adresse (et le nom) préremplis — rien n'est créé, l'utilisateur enregistre. UNIQUEMENT si l'utilisateur a donné l'adresse ; sinon demande-la-lui, ne l'invente jamais. Répond à « prépare-moi un QR vers … ».",
    target: '#sdqr-content',
    params: [
      { name: 'url', type: 'string', required: true, desc: 'l’adresse (https://…) que le QR ouvrira' },
      { name: 'name', type: 'string', required: false, desc: 'nom du QR' },
    ],
    run: async (args = {}) => {
      /* Un humain tape « protein-keystone.com », pas « https://protein-keystone.com » :
         sans schéma, new URL() jette et l'action échouait sur une demande
         parfaitement claire (dogfood 20/07). On préfixe https:// quand le
         schéma manque — jamais http (on ne dégrade pas une adresse). */
      let raw = String(args.url || '').trim();
      if (raw && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
      let u = null;
      try { u = new URL(raw); } catch (e) { /* invalide */ }
      if (!u || !/^https?:$/.test(u.protocol) || !/\./.test(u.hostname))
        throw new Error('Il me faut une adresse web valide (par exemple protein-keystone.com).');
      _guardGwModal();
      _guardSdqrCreate();
      /* openSDQR relaie createUrl/presetName (sdqr.js:250, deep-link Smart Agent) */
      const opts = { createUrl: u.href };
      if (String(args.name || '').trim()) opts.presetName = String(args.name).trim();
      return _openSdqrHonest(opts, { url: u.href,
        rappel: 'Formulaire prérempli — rien n’est créé : le design et l’enregistrement restent à l’utilisateur.' });
    },
  },
  {
    id: 'snt.run_audit', pad: 'sentinel', mode: 'write',
    label: 'Relancer l’audit d’un site',
    desc: "Relance MAINTENANT l'audit complet Sentinel d'un site (~1 minute) et donne le nouveau score — le bouton « Auditer » du pad, rien d'irréversible. Répond à « re-vérifie mon site », « relance l'audit », « j'ai corrigé, re-teste ».",
    target: '.snt-app .ws-topbar-title',
    params: [
      { name: 'site', type: 'string', required: false, desc: 'nom ou adresse (même partiels) ; inutile si un seul site surveillé' },
    ],
    run: async (args = {}) => {
      const site = await _sntResolve(args.site);
      const ancien = site.last_score ?? null;
      /* 1. check rapide (dispo + alertes de transition, sentinel.js:816) —
         best-effort : un check qui échoue n'empêche pas l'audit */
      let check = null;
      try { const r = await _sntApi(`/sites/${encodeURIComponent(site.id)}/check`, { method: 'POST' }); check = r.check || null; }
      catch (e) { /* l'audit tranchera */ }
      /* 2. audit complet — long (crawl multi-pages + CWV) : même timeout
         que le bouton du pad (sentinel.js:686) */
      await _sntApi(`/sites/${encodeURIComponent(site.id)}/audit`, { method: 'POST', timeout: 70000 });
      /* 3. relecture du cockpit → score frais + points saillants */
      const { cockpit: c } = await _sntApi(`/sites/${encodeURIComponent(site.id)}/cockpit`);
      const a = c.audit || {};
      const SEV_ORD = { high: 0, medium: 1, low: 2 };
      const SEV_FR = { high: 'élevé', medium: 'moyen', low: 'faible' };
      return {
        fait: true, site: site.label || _sntHost(site.url),
        en_ligne: check ? !!check.ok : (c.site.last_ok === 1 || c.site.last_ok === true),
        score_global: a.score ?? null,
        /* évolution vs le score d'AVANT cette relance (lu à la résolution) */
        evolution: (ancien != null && a.score != null)
          ? ((a.score - ancien > 0 ? '+' : '') + (a.score - ancien) + ' pts') : null,
        points_a_corriger: (a.findings || [])
          .slice().sort((x, y) => (SEV_ORD[x.sev] ?? 3) - (SEV_ORD[y.sev] ?? 3))
          .slice(0, 3)
          .map(f => ({ gravite: SEV_FR[f.sev] || f.sev, probleme: f.title })),
        rappel: 'Le rapport détaillé (axes, correctifs clé en main) est dans Sentinel, panneau du site.',
      };
    },
  },
  {
    id: 'kn.open_bubble', pad: 'keynapse', mode: 'write',
    label: 'Ouvrir une note dans Keynapse',
    desc: "Ouvre Keynapse — directement sur la fiche d'une bulle si un titre est donné. Rien n'est créé ni modifié. Répond à « ouvre ma note … dans Keynapse », « montre-moi la bulle … ».",
    target: '.kyn-app .ws-topbar-title',
    params: [{ name: 'title', type: 'string', required: false, desc: 'titre (même partiel) de la bulle à ouvrir' }],
    run: async (args = {}) => {
      _guardGwModal();
      const opts = {};
      let ref = null;
      if (String(args.title || '').trim()) {
        /* résolution AVANT ouverture : un titre inconnu doit le dire plutôt
           qu'ouvrir Keynapse vide sur une fiche qui n'apparaîtra jamais */
        const b = await _knResolve(args.title);
        opts.bubbleId = b.id; ref = b.title;
      }
      const { openTool } = await import('./ui-renderer.js');
      openTool('O-Keyn-001', opts);
      if (!document.querySelector('.kyn-app'))
        return { fait: false, raison: 'Keynapse n’est pas dans la licence — sa fiche est ouverte à l’écran.' };
      return { fait: true, outil_ouvert: 'Keynapse', note: ref };
    },
  },
  {
    id: 'kn.create_note', pad: 'keynapse', mode: 'write',
    label: 'Ajouter une note dans une bulle',
    desc: "Ajoute un texte dans les notes libres d'UNE bulle Keynapse existante, retrouvée par son titre — n'invente ni le titre de la bulle ni le texte, demande-les si absents. Répond à « note ça dans ma bulle … », « ajoute cette remarque à … ».",
    target: '.kyn-app .ws-topbar-title',
    params: [
      { name: 'title', type: 'string', required: true, desc: 'titre (même partiel) de la bulle où noter' },
      { name: 'text', type: 'string', required: true, desc: 'le texte à ajouter' },
    ],
    run: async (args = {}) => {
      const text = String(args.text || '').trim();
      if (!text) throw new Error('Il me faut le texte à noter.');
      const b = await _knResolve(args.title);
      const r = await _knApi(`/bubbles/${encodeURIComponent(b.id)}/notes`, { method: 'POST', body: { body: text } });
      return { fait: true, note: b.title, ajoute: _excerpt(r.note?.body || text, 160),
               rappel: 'Ajouté aux notes libres de la bulle — visible en l’ouvrant dans Keynapse.' };
    },
  },
];

/* ── Ancrage « c'est quoi Keystone » (fix immobilier, 19/07) ──
   Sans source, Mistral Small INVENTE ce qu'est Keystone quand on lui
   demande d'en faire la promo (hallucination immobilière constatée :
   « annonces, contrats de réservation »). On injecte donc la
   description OFFICIELLE comme source du débat + de Ghost Writer.
   FAITS condensés depuis app/lib/keystone-doc.js (DOC_SECTIONS) — la
   source de vérité ; garder ce texte cohérent avec elle. */
const _KEYSTONE_FACTS =
  "Keystone (Keystone OS) est un espace de travail modulaire édité par Protein Studio. " +
  "Il réunit des outils métier dans une seule application web : au lieu de jongler entre plusieurs applis et abonnements, " +
  "l'utilisateur active uniquement ce dont il a besoin, comme des applications sur un téléphone (le K-Store ajoute ou retire les outils selon la formule). " +
  "L'intelligence artificielle est INCLUSE dans l'abonnement (compteur mensuel équitable, pas de facturation à la consommation, pas de jeton à racheter). " +
  "Conçu « local d'abord » et souverain : les clés et les données métier restent dans le navigateur de l'utilisateur, sur son appareil ; " +
  "seul le profil (prénom, photo, préférences) est synchronisé, chiffré ; conforme RGPD avec droit à l'oubli. " +
  "C'est une application web installable (PWA), consultable hors connexion pour l'essentiel — rien à télécharger sur un store. " +
  "Formules : Démo, Starter, Pro et Max (accès complet). Produit actuellement en beta accompagnée. " +
  "Les outils incluent notamment : une chaîne de contenu (Brainstorming multi-agents → Ghost Writer → Social Manager), " +
  "des QR codes dynamiques traçables (Smart Dynamic QR), des notes en constellation (Keynapse), un audit de visibilité web souverain (Sentinel), " +
  "une charte graphique vivante partageable (Key Brand), un chemin de fer de rédaction pour la presse (desK), des flipbooks autoportés (booK), " +
  "un réseau relationnel anti-CRM (networK), un partage de secret chiffré usage-unique (Missive/Sceau), des gabarits d'impression aux normes (Brief Prod). " +
  "IMPORTANT : Keystone n'est PAS un logiciel spécialisé dans l'immobilier ni dans un métier unique — c'est un OS d'outils métier, généraliste et modulaire.";

/* Résout le Gest « Conseiller Keystone » = le Smart Agent dont le Kortex
   contient les fiches réelles des apps (ingest-apps-to-kortex.mjs). Le
   convoquer donne à la chaîne le VRAI savoir maison (retrieval, toujours
   à jour) plutôt qu'un résumé figé. Renvoie l'id de l'agent, ou null si :
   plan non-MAX (403), agent absent, ou erreur → l'appelant retombe alors
   sur _KEYSTONE_FACTS (texte statique). Nom résolu (pas d'id en dur : un
   agent recréé changerait d'id). */
async function _resolveKeystoneGest() {
  try {
    const data = await _api('/api/smart-agent/agents');   // 403 non-MAX → throw → null
    const agents = Array.isArray(data.agents) ? data.agents : [];
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    /* « Conseiller Keystone » d'abord ; à défaut tout agent « keystone » */
    const hit = agents.find(a => norm(a.name).includes('conseiller keystone'))
             || agents.find(a => norm(a.name).includes('keystone'));
    return hit?.id || null;
  } catch (e) { return null; }
}

/* Le brief porte-t-il sur Keystone lui-même (auto-promo) ? Alors on ancre.
   Ancré sur « keystone » (signal net) + quelques tournures autoréférentielles
   explicites — on préfère rater un cas ambigu (« notre app » seul) que d'ancrer
   à tort un sujet client qui n'a rien à voir. */
function _isKeystoneTopic(brief) {
  const n = String(brief || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\bkeystone\b/.test(n) || /protein studio/.test(n)) return true;
  return /\b(notre|mon|ma|nos|mes)\s+(app|application|appli|produit|outil|logiciel|plateforme|os|solution|saas)\b/.test(n)
      && /\b(promo|promouv|promeus|vend|présent|present|lance|met[s]? en avant|vitrine|pitch)/.test(n);
}

/* réseaux valides du moteur de diffusion (social-handoff.js:19) */
function _validNetworks(input) {
  const KNOWN = ['facebook', 'instagram', 'linkedin', 'threads', 'telegram'];
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  return [...new Set(arr.map(n => String(n || '').trim().toLowerCase()).filter(n => KNOWN.includes(n)))];
}

/* Retrouver UN QR par son nom (exact d'abord, partiel ensuite), accents
   ignorés. Ambigu ou introuvable → { match:null, candidates } pour que
   Kora demande une précision au lieu d'ouvrir le mauvais QR. */
function _qrByName(qrs, ref) {
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const n = norm(ref);
  if (!n) return { match: null, candidates: [] };
  const exact = qrs.filter(q => norm(q.name) === n);
  if (exact.length === 1) return { match: exact[0], candidates: [] };
  const part = exact.length ? exact : qrs.filter(q => norm(q.name).includes(n));
  if (part.length === 1) return { match: part[0], candidates: [] };
  /* discriminant (dossier/type) : deux QR au même nom resteraient
     indistinguables dans le message « précise le nom » */
  const cand = part.map(q => (q.name || '(sans nom)') +
    (q.folder ? ` (dossier ${q.folder})` : q.qr_type ? ` (${q.qr_type})` : ''));
  return { match: null, candidates: cand.slice(0, 6) };
}

/* Meilleur créneau de la heatmap jour×heure. Le serveur stocke ts en UTC
   (qr.js:1017) et la conversion locale se fait côté client, comme dans la
   heatmap du pad (_renderHeatmap). */
function _qrBestSlot(heatmap) {
  if (!Array.isArray(heatmap) || !heatmap.length) return null;
  const best = heatmap.reduce((a, b) => (b.cnt > a.cnt ? b : a));
  if (!best || !best.cnt) return null;
  /* MÊME formule d'arrondi que la heatmap du pad (sdqr.js:4530) — sinon
     le créneau annoncé peut contredire d'1 h la grille affichée à l'écran */
  const off = -Math.round(new Date().getTimezoneOffset() / 60);
  let hour = best.hour + off, dow = best.dow;
  if (hour >= 24) { hour -= 24; dow = (dow + 1) % 7; }
  if (hour < 0)  { hour += 24; dow = (dow + 6) % 7; }
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  return `${JOURS[dow]} vers ${hour}h`;
}

/* Rouvrir SDQR réécrit tout son shell (openSDQR fait panel.innerHTML =,
   sdqr.js:221) : une CRÉATION en cours serait perdue. Seule la vue
   création est détectable (classe --create) — la navigation interne du
   pad re-rend pareil, on n'est pas plus destructeur que lui. */
function _guardSdqrCreate() {
  if (document.querySelector('#sdqr-fullscreen.open .sdqr-content--create'))
    throw new Error('Une création de QR est en cours — termine-la ou ferme-la, puis redemande-moi.');
}

/* Ouverture SDQR honnête : openTool tranche SEUL l'accès (licence + essai
   gratuit + admin, ui-renderer.js:2216-2223) — on CONSTATE le résultat au
   DOM au lieu de le prédire (revue 19/07 : _padAccessible ignorait l'essai
   → faux « pas dans la licence » et opts jetés pour un compte en essai).
   openSDQR pose la classe .open de façon synchrone (sdqr.js:222). */
async function _openSdqrHonest(opts, extra = {}) {
  const { openTool } = await import('./ui-renderer.js');
  openTool('A-COM-001', opts);
  if (document.querySelector('#sdqr-fullscreen.open'))
    return { fait: true, outil_ouvert: 'Smart Dynamic QR', ...extra };
  return { fait: false, raison: 'Smart Dynamic QR n’est pas dans la licence — sa fiche est ouverte à l’écran.' };
}

/* ── Sentinel — accès API + résolution d'un site ──
   _api (GET-only) ne suffit pas ici : l'audit est un POST long (70 s comme
   le bouton du pad) et le serveur renvoie des messages d'erreur utiles
   (limite de plan, site introuvable) qu'on veut restituer tels quels. */
async function _sntApi(path, opts = {}) {
  const token = _jwt();
  if (!token) throw new Error('Non connecté : ouvre Keystone et connecte-toi (ks_jwt absent).');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
  let res;
  try {
    res = await fetch(`${KORA_API}/api/sentinel${path}`, {
      method: opts.method || 'GET',
      headers: { 'Authorization': `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw (e && e.name === 'AbortError')
      ? new Error('Sentinel met trop de temps à répondre — réessaie dans un instant.') : e;
  }
  clearTimeout(timer);
  let data = {};
  try { data = await res.json(); } catch (e) { /* corps vide */ }
  if (!res.ok) throw new Error(data.error || `Sentinel ${path} → ${res.status}`);
  return data;
}
function _sntHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return String(url || ''); }
}
/* Un site par nom (label) OU par adresse — exact d'abord, partiel ensuite,
   accents ignorés. Particularité vs _qrByName : la plupart des comptes n'ont
   QU'UN site (limite Starter = 1) → sans référence, un site unique se résout
   seul ; plusieurs sites sans référence → on liste, on ne devine pas. */
async function _sntResolve(ref) {
  const d = await _sntApi('/sites');
  const sites = d.sites || [];
  if (!sites.length)
    throw new Error('Aucun site surveillé — ajoute d’abord ton site dans Sentinel.');
  const r = String(ref || '').trim();
  if (!r) {
    if (sites.length === 1) return sites[0];
    throw new Error(`Plusieurs sites surveillés : ${sites.map(s => s.label || _sntHost(s.url)).join(' · ')}. Dis-moi lequel.`);
  }
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const n = norm(r);
  const names = s => [norm(s.label), norm(_sntHost(s.url)), norm(s.url)];
  const exact = sites.filter(s => names(s).includes(n));
  if (exact.length === 1) return exact[0];
  const part = exact.length ? exact : sites.filter(s => names(s).some(x => x && x.includes(n)));
  if (part.length === 1) return part[0];
  if (part.length > 1)
    throw new Error(`Plusieurs sites correspondent à « ${r} » : ${part.map(s => s.label || _sntHost(s.url)).join(' · ')}. Précise.`);
  throw new Error(`Aucun site « ${r} » dans la surveillance. Sites suivis : ${sites.map(s => s.label || _sntHost(s.url)).join(' · ')}.`);
}

/* ── Keynapse — accès API + résolution d'une bulle ──
   Même patron que _sntApi : GET-only insuffisant (create_note est un POST). */
async function _knApi(path, opts = {}) {
  const token = _jwt();
  if (!token) throw new Error('Non connecté : ouvre Keystone et connecte-toi (ks_jwt absent).');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
  let res;
  try {
    res = await fetch(`${KORA_API}/api/keynapse${path}`, {
      method: opts.method || 'GET',
      headers: { 'Authorization': `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw (e && e.name === 'AbortError')
      ? new Error('Keynapse met trop de temps à répondre — réessaie dans un instant.') : e;
  }
  clearTimeout(timer);
  let data = {};
  try { data = await res.json(); } catch (e) { /* corps vide */ }
  if (!res.ok) throw new Error(data.error || `Keynapse ${path} → ${res.status}`);
  return data;
}
/* Une bulle par TITRE — exact d'abord, partiel ensuite, accents ignorés.
   Contrairement à Sentinel (souvent 1 seul site), une constellation a
   TOUJOURS plusieurs bulles : référence vide → erreur (jamais de choix
   automatique). Renvoie aussi le nom de zone (affichage) et zone_id. */
async function _knResolve(ref) {
  const r = String(ref || '').trim();
  if (!r) throw new Error('Il me faut le titre de la bulle.');
  const { zones, bubbles } = await _knApi('/state');
  const list = bubbles || [];
  if (!list.length) throw new Error('Aucune note dans Keynapse pour l’instant.');
  const zoneName = id => (zones || []).find(z => z.id === id)?.name || null;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const n = norm(r);
  const exact = list.filter(b => norm(b.title) === n);
  const withZone = b => ({ ...b, zoneName: zoneName(b.zone_id) });
  if (exact.length === 1) return withZone(exact[0]);
  const part = exact.length ? exact : list.filter(b => norm(b.title).includes(n));
  if (part.length === 1) return withZone(part[0]);
  if (part.length > 1)
    throw new Error(`Plusieurs notes correspondent à « ${r} » : ${part.slice(0, 6).map(b => b.title).join(' · ')}. Précise le titre.`);
  throw new Error(`Aucune note « ${r} » dans Keynapse.`);
}

/* ── Smart Agent — accès API + résolution d'un jumeau ──
   Même patron que _sntApi/_knApi : GET-only insuffisant (le worker est aussi
   la porte du gating MAX — data.error restitue son message tel quel, ex.
   « Smart Agent est réservé au plan MAX pendant la beta. »). */
async function _saApi(path, opts = {}) {
  const token = _jwt();
  if (!token) throw new Error('Non connecté : ouvre Keystone et connecte-toi (ks_jwt absent).');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
  let res;
  try {
    res = await fetch(`${KORA_API}/api/smart-agent${path}`, {
      method: opts.method || 'GET',
      headers: { 'Authorization': `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw (e && e.name === 'AbortError')
      ? new Error('Smart Agent met trop de temps à répondre — réessaie dans un instant.') : e;
  }
  clearTimeout(timer);
  let data = {};
  try { data = await res.json(); } catch (e) { /* corps vide */ }
  if (!res.ok) throw new Error(data.error || `Smart Agent ${path} → ${res.status}`);
  return data;
}
/* Un jumeau par NOM — même patron que _sntResolve (la plupart des comptes
   n'en ont qu'un ou deux) : sans référence, un jumeau unique se résout seul ;
   plusieurs sans référence → on liste, on ne devine pas. */
async function _saResolve(ref) {
  const { agents } = await _saApi('/agents');
  if (!agents.length)
    throw new Error('Aucun jumeau créé pour l’instant — Smart Agent en crée un en quelques minutes.');
  const r = String(ref || '').trim();
  if (!r) {
    if (agents.length === 1) return agents[0];
    throw new Error(`Plusieurs jumeaux : ${agents.map(a => a.name).join(' · ')}. Dis-moi lequel.`);
  }
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const n = norm(r);
  const exact = agents.filter(a => norm(a.name) === n);
  if (exact.length === 1) return exact[0];
  const part = exact.length ? exact : agents.filter(a => norm(a.name).includes(n));
  if (part.length === 1) return part[0];
  if (part.length > 1)
    throw new Error(`Plusieurs jumeaux correspondent à « ${r} » : ${part.map(a => a.name).join(' · ')}. Précise.`);
  throw new Error(`Aucun jumeau « ${r} ». Jumeaux existants : ${agents.map(a => a.name).join(' · ')}.`);
}

/* Le modal Ghost Writer vit à z-index 99999 : tout outil ouvert pendant
   qu'il est affiché apparaîtrait DERRIÈRE lui (retour test réel 18/07 —
   « elle n'a pas ouvert brainstorming ») — et le fermer perdrait les
   variantes en cours. On refuse poliment. */
function _guardGwModal() {
  if (document.getElementById('gw-overlay'))
    throw new Error('Le Ghost Writer est ouvert — ferme-le d’abord (ses variantes ne survivraient pas), puis redemande-moi.');
}

/* même sémantique que la garde d'openTool (ui-renderer.js:2216) —
   pour dire la VÉRITÉ quand la licence n'a pas l'outil (revue 18/07) */
async function _padAccessible(padId) {
  try {
    const { getOwnedIds, getLifetimeIds, isAdminUser } = await import('./pads-loader.js');
    if (isAdminUser()) return true;
    const owned = getOwnedIds();
    if (owned === null) return true;                       // sentinelle « tout possédé »
    return owned.includes(padId) || getLifetimeIds().includes(padId);
  } catch (e) { return true; }                             // au doute, openTool tranchera
}

/* ── Méta des domaines (routage 2 étages, 19/07/2026) ──
   Une ligne de ROUTAGE par pad pour l'étage 1 du worker (aiguillage) :
   le modèle choisit un domaine sur ces résumés AVANT de voir le détail.
   `global:true` = actions montrées EN ENTIER dès l'étage 1 (transverses).
   Inerte tant que le catalogue ≤ 32 actions (le worker garde alors le
   chemin historique à un appel) — mais envoyé dès maintenant pour que la
   bascule soit automatique quand un pad s'ajoutera. Desc ≤ 160 car. */
export const KORA_PAD_META = [
  { pad: 'chaine', global: true },
  { pad: 'os',     global: true },
  { pad: 'brainstorming', label: 'Brainstorming',
    desc: 'séances de réflexion multi-agents : lire séances, synthèses et débats, préférences du comité, lancer une séance sur un brief' },
  { pad: 'ghostwriter', label: 'Ghost Writer',
    desc: 'rédaction IA : posts composés, variantes, brouillons, quota d’écriture, faire réécrire un texte existant' },
  { pad: 'social', label: 'Social Manager',
    desc: 'réseaux sociaux : posts programmés et publiés, santé des comptes, stats d’un post, contraintes par réseau, préparer un post dans le composer' },
  { pad: 'sdqr', label: 'Smart Dynamic QR',
    desc: 'QR codes : flotte, scans et stats (globales, par QR, QR suivi), ouvrir un QR, préparer un QR vers une adresse' },
  { pad: 'sentinel', label: 'Sentinel',
    desc: 'sites web surveillés : en ligne/hors ligne, disponibilité, rapport d’audit (scores, points à corriger), relancer un audit' },
  { pad: 'keynapse', label: 'Keynapse',
    desc: 'notes en bulles : chercher un mot-clé, rappels à venir/en retard, détail d’une note, ouvrir une note, y ajouter du texte' },
  { pad: 'smartagent', label: 'Smart Agent',
    desc: 'jumeaux de savoir-faire (plan Max) : liste des agents, trous de savoir, état du coffre Kortex, usage du lien public' },
];

/* ── Exécution ── */
export function koraActionsForPad(pad) {
  return KORA_ACTIONS.filter(a => a.pad === pad);
}
export function koraAction(id) {
  return KORA_ACTIONS.find(a => a.id === id) || null;
}
export async function runKoraAction(id, args = {}) {
  const action = koraAction(id);
  if (!action) return { ok: false, id, error: `Action inconnue : ${id}` };
  try {
    const data = await action.run(args);
    return { ok: true, id, pad: action.pad, target: action.target, data };
  } catch (e) {
    return { ok: false, id, pad: action.pad, error: e?.message || String(e) };
  }
}
