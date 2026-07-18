/* ═══════════════════════════════════════════════════════════════
   KORA — Catalogue d'actions V1 (lectures) + V1.1 (écritures sûres)
   ───────────────────────────────────────────────────────────────
   Le cœur de l'agent (KORA_BRIEF §2) : un catalogue d'actions bien
   nommées, scopées par pad. V1 = la chaîne de contenu (Brainstorming,
   Ghost Writer, Social Manager) + l'état de la chaîne elle-même.

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
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return String(v);
  const txt = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const hm = d.getHours() || d.getMinutes()
    ? ' à ' + String(d.getHours()) + 'h' + String(d.getMinutes()).padStart(2, '0') : '';
  return txt + hm;
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
    label: 'Ouvrir un brainstorming avec un brief',
    desc: "Ouvre le Brainstorming avec le brief prérempli — la séance ne démarre qu'au clic de l'utilisateur (elle consomme des crédits IA). Répond à « lance un brainstorming sur… ».",
    target: '#wr-input',
    params: [{ name: 'brief', type: 'string', required: true, desc: 'le sujet à faire débattre' }],
    run: async (args = {}) => {
      const brief = String(args.brief || '').trim();
      if (!brief) throw new Error('Il me faut le sujet du brainstorming.');
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
      return { fait: true, outil_ouvert: 'Brainstorming', brief: _excerpt(brief, 200),
               rappel: 'Brief prérempli — le lancement de la séance reste à l’utilisateur.' };
    },
  },
  {
    id: 'chain.start', pad: 'chaine', mode: 'write',
    label: 'Démarrer la chaîne de contenu',
    desc: "Lance la chaîne Brainstorming → Ghost Writer → Social pour un réseau donné : pose l'état de chaîne et ouvre l'étape idées (brief prérempli si fourni). Répond à « démarre la chaîne pour LinkedIn ».",
    target: '#wr-chain-slot',
    params: [
      { name: 'network', type: 'string', required: true, desc: 'facebook, instagram, linkedin, threads ou telegram' },
      { name: 'brief', type: 'string', required: false, desc: 'le sujet, si déjà connu' },
    ],
    run: async (args = {}) => {
      const nets = _validNetworks([args.network]);
      if (!nets.length) throw new Error(`Réseau inconnu : ${args.network}. Choix : facebook, instagram, linkedin, threads, telegram.`);
      if (document.querySelector('#wr-fullscreen.open'))
        throw new Error('Une séance de brainstorming est déjà ouverte — termine-la ou ferme-la, puis redemande-moi.');
      const { setChain } = await import('./lib/content-chain.js');
      const { openBrainstorming } = await import('./brainstorming.js');
      setChain({ step: 'ideas', origin: 'kora', network: nets[0] });
      const opts = { mode: 'post-ideas' };
      if (String(args.brief || '').trim()) opts.brief = String(args.brief).trim();
      openBrainstorming(opts);
      return { fait: true, chaine: 'démarrée', reseau: nets[0], etape: 'idées (Brainstorming)',
               brief: opts.brief ? _excerpt(opts.brief, 200) : null };
    },
  },
  {
    id: 'os.open_pad', pad: 'os', mode: 'write',
    label: 'Ouvrir un outil',
    desc: "Ouvre un outil de la chaîne de contenu : brainstorming, ghostwriter ou social. Répond à « ouvre-moi le Social Manager ».",
    target: '.ws-app',
    params: [{ name: 'pad', type: 'string', required: true, desc: 'brainstorming | ghostwriter | social' }],
    run: async (args = {}) => {
      const KORA_PADS = {
        brainstorming: ['A-COM-003', 'le Brainstorming'], ghostwriter: ['A-COM-005', 'le Ghost Writer'],
        social: ['O-SOC-001', 'le Social Manager'],
        'ghost writer': ['A-COM-005', 'le Ghost Writer'], 'social manager': ['O-SOC-001', 'le Social Manager'],
      };
      const key = String(args.pad || '').trim().toLowerCase();
      const entry = KORA_PADS[key];
      if (!entry) throw new Error(`Outil inconnu : ${args.pad}. Choix : brainstorming, ghostwriter, social.`);
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
];

/* réseaux valides du moteur de diffusion (social-handoff.js:19) */
function _validNetworks(input) {
  const KNOWN = ['facebook', 'instagram', 'linkedin', 'threads', 'telegram'];
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  return [...new Set(arr.map(n => String(n || '').trim().toLowerCase()).filter(n => KNOWN.includes(n)))];
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
