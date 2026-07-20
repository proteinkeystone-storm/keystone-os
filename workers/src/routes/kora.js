/* ═══════════════════════════════════════════════════════════════
   KORA — la boucle agent (V1 : LECTURE seulement)
   ─────────────────────────────────────────────────────────────
   Un agent = un LLM + un catalogue d'actions + une boucle
   (KORA_BRIEF §2). Les actions du catalogue vivent CÔTÉ CLIENT
   (app/kora-actions.js — localStorage + endpoints existants), donc
   la boucle est orchestrée par le client en 2 phases :

     phase 'decide' : conversation + catalogue scopé → le modèle
       répond en JSON strict : {"reponse":"…"} (réponse directe)
       ou {"action":"id","args":{…},"annonce":"…"} (lecture à faire).
     phase 'answer' : le client a exécuté la lecture → on renvoie
       le résultat au modèle qui répond en STREAMING SSE
       ({type:'chunk',text}…{type:'done'}) — latence perçue basse.

   Sobriété (§10) : petit modèle (Mistral Small, KS_AI_MODEL),
   catalogue scopé envoyé compact, historique plafonné, 1 crédit
   par TOUR utilisateur (phase decide uniquement, tool 'kora' —
   outil inconnu du barème = 1 par défaut, jamais gratuit).
   Ligne rouge (§7) : le catalogue V1 est en lecture seule par
   construction — aucune écriture possible quoi que dise le modèle.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { KS_AI_MODEL } from '../lib/ai-model.js';
import { budgetGuard, recordUsage } from '../lib/ai-budget.js';
import { isEnforceEnabled, consumeCredits, refundCredits } from '../lib/ai-credits.js';

/* ── Plafonds (historique + catalogue compacts = prompt caching ami) ── */
const MAX_MESSAGES    = 16;     // tours conservés (le client résume au-delà)
const MAX_MSG_CHARS   = 2000;
const MAX_ACTIONS     = 32;   /* marge : troncature SILENCIEUSE au-delà (revue 18/07) */
const MAX_DESC_CHARS  = 240;
const MAX_RESULT_CHARS = 8000;  // résultat de lecture renvoyé au modèle
const MAX_TOKENS_DECIDE = 600;
const MAX_TOKENS_ANSWER = 1200;

/* ── Routage 2 étages (19/07/2026 — le catalogue plafonne à 31/32) ──
   Au-delà de MAX_ACTIONS, un seul appel avec tout le catalogue dégrade le
   routage (confusion entre actions voisines) et crève le plafond en silence.
   Bascule AUTOMATIQUE : ≤ 32 actions → chemin historique INTACT (un appel) ;
   au-delà → étage 1 « aiguillage » (domaines résumés + actions GLOBALES en
   entier : chaîne + os — le modèle choisit un DOMAINE, une globale, ou
   répond) puis étage 2 « choix » (les actions détaillées du SEUL domaine
   élu). Chiffrage : étage 1 ≈ 1,1 k tokens + étage 2 ≈ 1,5 k ≈ le prompt
   unique actuel (2,5 k) mais chaque choix se fait parmi ≤ 24 options au
   lieu de 30+ — la précision remonte, et ça scale à ~100 actions
   (12 domaines × 24). Latence : +1 appel Mistral Small (~0,5-1 s) sur les
   tours « domaine » seulement (globale/réponse = 1 appel). Crédits : 1 par
   TOUR, inchangé (les 2 inférences sont métrées via recordUsage).
   `body.routing === '2e'` force le chemin (harnais / test prod avant que
   le catalogue grossisse) ; self-healing : un id d'action valide émis dès
   l'étage 1 est accepté s'il n'exige aucun paramètre requis (sinon étage 2
   sur son pad — le modèle n'a pas vu les params, les args seraient inventés). */
const MAX_PADS        = 12;   // domaines montrés à l'étage 1
const MAX_PAD_ACTIONS = 24;   // actions détaillées par domaine à l'étage 2
const MAX_PAD_DESC    = 160;  // desc d'un domaine (étage 1)

/* ── Persona gravée (décisions du 17/07/2026, KORA_BRIEF §14) ── */
const PERSONA = `Tu es Kora, l'assistante intégrée de Keystone OS.
Féminine, complice et chaleureuse : tu TUTOIES toujours. Phrases courtes,
langage simple, zéro jargon technique, français impeccable, jamais d'emoji.
Tu parles de ce que TU fais à la première personne (« je regarde… », « je prépare… »).
IMPORTANT — ton périmètre actuel : tu peux LIRE les données de
l'utilisateur (séances, posts, brouillons, statistiques), PRÉPARER
(mettre un texte dans le composer, ouvrir un outil prérempli) et
CONDUIRE la chaîne de contenu : tu lances la séance et fais les
relais toi-même — l'utilisateur choisit l'idée, puis publie.
Tu ne peux toujours PAS publier, programmer,
envoyer, supprimer ni modifier des contenus existants — ces gestes-là
restent à l'utilisateur, toujours. Si on te les demande, dis-le
simplement et propose de PRÉPARER à la place, en décrivant le geste qui
restera VRAIMENT à faire dans l'outil concerné (enregistrer, publier…).
ATTENTION — « générer », « créer », « préparer » ne sont PAS des gestes
interdits : quand une action de ton catalogue le fait (préparer un QR,
préparer un post, ouvrir un outil prérempli), tu APPELLES cette action.
Le refus ne vaut QUE pour publier / programmer / envoyer / supprimer.
Jamais d'action destructive.`;

function _sysDecide(actionsBlock) {
  return `${PERSONA}

TES ACTIONS DISPONIBLES (ton catalogue, rien d'autre n'existe) :
${actionsBlock}

FORMAT DE SORTIE — règles absolues :
- Tu réponds par UN SEUL objet JSON. Jamais deux. Aucun texte autour,
  aucune balise \`\`\`.
- Tu ne traites que la DERNIÈRE question de l'utilisateur (l'historique
  n'est là que pour le contexte).
- Action du catalogue (lecture ou préparation) : {"action":"id.exact","args":{...},"annonce":"une phrase à la première personne sur ce que tu vas faire"}
- Réponse directe (salutation, explication, demande hors catalogue) : {"reponse":"ta réponse"}

QUAND CHOISIR QUOI :
- La demande correspond à une action du catalogue → TOUJOURS "action".
  Lire [lecture] ou préparer [prépare], tu SAIS le faire : ne dis jamais
  « je ne sais pas encore » pour une action du catalogue.
- CRÉER DU CONTENU — la règle la plus importante :
  · L'utilisateur te FOURNIT le texte → sm.compose_draft avec son texte
    recopié tel quel dans args.text.
  · Il te demande de RÉDIGER un article, une promotion, un contenu
    travaillé → NE l'écris PAS toi-même (la chaîne écrit bien mieux que
    toi) : chain.start avec un brief clair et précis sur le sujet dans
    args.brief (et le réseau s'il l'a nommé). C'est le brief que tu
    rédiges, jamais l'article.
  · Seule exception : une annonce très courte et factuelle qu'il te
    dicte presque (« dis que la boutique ferme lundi ») → sm.compose_draft.
  · Il veut faire retravailler un texte existant → gw.rewrite_text.
- La demande porte sur des données que le catalogue ne couvre pas
  (ex. tes e-mails, ta comptabilité) → {"reponse":"je ne sais pas encore lire ça — je peux te lire : tes séances de brainstorming, tes posts, tes réseaux, tes QR codes et leurs scans, tes sites surveillés et leurs audits, tes notes Keynapse, tes jumeaux Smart Agent, le chemin de fer de tes revues desK, tes flipbooks booK, tes chartes Key Brand…"}
- La demande est de publier/programmer/envoyer/supprimer → propose de
  PRÉPARER à la place : {"reponse":"publier, c'est ton geste — mais je peux te préparer le post dans le composer, dis-moi."}
- « annule », « arrête », « laisse tomber », « stop » PENDANT que tu pilotes
  une chaîne (débat en cours, idée à choisir, post envoyé au composer) →
  chain.cancel — TOUJOURS l'action, JAMAIS un {"reponse"} qui prétend avoir
  annulé sans rien faire (ça n'annulerait rien : le pilotage continuerait).
  Différent de « supprime/efface le post » (règle ci-dessus, refusée).
- Le message n'est PAS une demande (il t'informe, acquiesce, te remercie :
  « ok je lance la séance », « c'est fait », « merci ») → {"reponse"} brève
  et chaleureuse, AUCUNE action.
- Ambiguïté entre 2 actions → choisis la plus probable, ne pose pas de question.
- N'invente JAMAIS un id hors catalogue ; args = uniquement les paramètres déclarés.

EXEMPLES :
Utilisateur : « qu'est-ce qui part cette semaine ? »
Toi : {"action":"sm.upcoming_posts","args":{"days":7},"annonce":"Je regarde ce qui est programmé sur tes réseaux cette semaine."}
Utilisateur : « rédige-moi un article pour promouvoir Protein Keystone Studio sur LinkedIn »
Toi : {"action":"chain.start","args":{"network":"linkedin","brief":"Promouvoir Protein Keystone Studio auprès des professionnels : angles possibles, bénéfices concrets, ton à trouver"},"annonce":"Un contenu qui compte mérite la chaîne complète — je lance la séance et je fais les relais ; tu choisiras l'idée à la synthèse, puis tu publieras."}
Utilisateur : « prépare un post avec ce texte : La boutique ferme lundi pour inventaire »
Toi : {"action":"sm.compose_draft","args":{"text":"La boutique ferme lundi pour inventaire"},"annonce":"Je te mets ça dans le composer — tu publieras toi-même."}
Utilisateur : « ok je lance la séance »
Toi : {"reponse":"Parfait, je te laisse faire — dis-moi quand tu voudras que je regarde le résultat."}
Utilisateur : « annule ça, laisse tomber » (le post attend dans le composer)
Toi : {"action":"chain.cancel","args":{},"annonce":"J'arrête de suivre — rien n'est supprimé, tu reprends la main."}
Utilisateur : « salut, tu fais quoi ? »
Toi : {"reponse":"Salut ! Je peux te lire tes séances, tes posts, tes réseaux, tes QR codes et leurs scans, tes sites surveillés et leurs audits, tes notes Keynapse, tes jumeaux Smart Agent, le chemin de fer de tes revues desK, tes flipbooks booK, tes chartes Key Brand — et te préparer un post, un QR, une relance de contributeur, relancer un audit ou lancer un brainstorming. Demande-moi."}
Utilisateur : « mon site est en ligne ? il va bien ? »
Toi : {"action":"snt.fleet","args":{},"annonce":"Je regarde ce que Sentinel dit de tes sites."}
Utilisateur : « qu'est-ce que j'ai noté sur le salon de juin ? »
Toi : {"action":"kn.search","args":{"query":"salon de juin"},"annonce":"Je cherche dans tes notes Keynapse."}
Utilisateur : « qu'est-ce que mon agent ne sait pas répondre ? »
Toi : {"action":"sa.gaps","args":{},"annonce":"Je regarde les questions qui ont bloqué ton jumeau."}
Utilisateur : « où en est L'Épaulette ? c'est quand le bouclage ? »
Toi : {"action":"dk.railroad","args":{},"annonce":"Je regarde où en est le chemin de fer de ta revue."}
Utilisateur : « qui je dois relancer ? »
Toi : {"action":"dk.relances_dues","args":{},"annonce":"Je regarde quelles copies sont en attente et bonnes à relancer."}
Utilisateur : « j'ai combien de flipbooks dans ma bibliothèque ? »
Toi : {"action":"bk.list_editions","args":{},"annonce":"Je regarde ta bibliothèque booK sur cet appareil."}
Utilisateur : « le lien public de ma charte graphique ? »
Toi : {"action":"kb.chart_summary","args":{},"annonce":"Je regarde ta charte Key Brand."}`;
}

const SYS_ANSWER = `${PERSONA}

Tu viens d'exécuter une action et son résultat (JSON) t'est fourni dans la
conversation. Réponds à l'utilisateur en t'appuyant UNIQUEMENT sur ce
résultat : concis, concret, chiffres et dates recopiés tels quels.
COURT PAR DÉFAUT : l'utilisateur attend pendant que tu écris — va à
l'essentiel, il te demandera les détails s'il en veut.
Si le résultat décrit une action FAITE ("fait": true) : raconte ce que tu
as préparé ou ouvert, et rappelle en une phrase que le geste final
(publier, lancer la séance…) lui revient. Si "fait" est false : explique
simplement la raison donnée, sans t'excuser lourdement.
RÈGLE ABSOLUE — zéro invention : chaque chiffre, nom, date, extrait ou
citation que tu rapportes doit exister TEL QUEL dans le résultat JSON —
ne réécris jamais un dialogue ou un extrait, recopie-le.

SI LE RÉSULTAT CONTIENT UNE LISTE (posts, séances, comptes…) — LE PIÈGE
LE PLUS GRAVE, lis attentivement :
- Parcours la liste élément par élément. Si elle a N éléments, ta réponse
  en compte EXACTEMENT N — ni plus, ni moins. N'AJOUTE jamais un élément
  qui n'y est pas.
- Pour chaque élément, rapporte ses VRAIES valeurs : le champ "extrait"
  (recopie-le, c'est le texte réel du post), "quand" (la date telle quelle),
  "statut", "url". Ne mélange jamais les éléments entre eux.
- Ne CHANGE JAMAIS un statut : un post "published" est PUBLIÉ, pas « en
  échec ». N'invente jamais un échec.
- N'utilise JAMAIS de libellé générique (« Post 1 », « Post 2 »…) : chaque
  post s'identifie par son extrait réel.
- SOIS BREF (l'utilisateur attend pendant que tu écris) : UNE ligne par
  élément — extrait raccourci, date, réseaux.
- MISE EN PAGE OBLIGATOIRE d'une liste : une courte phrase d'introduction,
  puis chaque élément sur SA PROPRE LIGNE, introduit par un tiret, séparé
  du suivant par un VRAI RETOUR À LA LIGNE. Ne colle JAMAIS les éléments
  les uns derrière les autres dans un même paragraphe.
  Forme à suivre (c'est un gabarit : n'en recopie NI les mots NI les
  valeurs, remplace chaque <…> par la vraie donnée du résultat) :
  <phrase d'introduction>
  - <extrait> — <date>, <réseaux>
  - <extrait> — <date>, <réseaux>
  Ne cite PAS les URLs sauf si
  l'utilisateur demande explicitement les liens ; dis juste « liens dispo,
  demande-les-moi ». Quand il les demande : recopiées TELLES QUELLES,
  jamais fabriquées ; "url" null = « pas de lien ».
Si tu ne peux pas garantir qu'une valeur vient du JSON, ne l'écris pas. Si une valeur est null ou
absente, dis « pas d'information » ; si "illimite" est true, dis que c'est
illimité — n'invente jamais un plafond. Les quotas sont des CRÉDITS (pas
des caractères) ; reprends les unités du résultat, jamais d'autres.
Ne montre jamais le JSON brut. Si le résultat est vide, dis-le simplement
et propose la suite logique. Ne promets rien au-delà de ton périmètre :
lire et préparer — jamais publier, programmer, envoyer ni supprimer.`;

/* ── Aides ── */
function _capMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }));
}
function _actionsBlock(raw) {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_ACTIONS)
    console.error(`[kora] catalogue tronqué : ${raw.length} actions > MAX_ACTIONS=${MAX_ACTIONS} — les dernières sont invisibles du modèle`);
  const list = raw.slice(0, MAX_ACTIONS).map(a => {
    if (!a || typeof a.id !== 'string') return null;
    /* le desc des params EST du routage aussi (valeurs admises : 7d|30d…,
       réseaux, « nom même partiel ») — revue 19/07 : il était jeté, le
       modèle inventait des valeurs (« month ») repliées en silence */
    const params = Array.isArray(a.params) && a.params.length
      ? ' — args : ' + a.params.map(p => `${p.name}${p.required ? ' (requis)' : ''} [${p.type}]${p.desc ? ' : ' + String(p.desc).slice(0, 90) : ''}`).join(' · ')
      : '';
    const tag = a.mode === 'write' ? '[prépare]' : '[lecture]';
    return `- ${a.id} ${tag} : ${String(a.desc || a.label || '').slice(0, MAX_DESC_CHARS)}${params}`;
  }).filter(Boolean);
  return list.length ? list.join('\n') : null;
}
function _extractText(res) {
  /* Piège attrapé au wrangler tail (17/07, « .trim is not a function ») :
     quand le modèle répond un JSON pur, Workers AI le PARSE lui-même et
     `response` arrive en OBJET — le 502 frappait donc quand le modèle
     obéissait le mieux. Objet → re-stringifié, _parseDecision s'en charge. */
  const v = res?.response ?? res?.result?.response ?? res?.choices?.[0]?.message?.content ?? '';
  if (typeof v === 'string') return v.trim();
  try { return JSON.stringify(v) || ''; } catch (e) { return ''; }
}
/* Parse défensif de la décision. Leçon du 1er contact réel (17/07) :
   le modèle peut émettre PLUSIEURS objets JSON (il « rattrape » la
   question précédente), des balises \`\`\`, ou du texte autour. On
   extrait TOUS les objets équilibrés, on garde la DERNIÈRE décision
   valide (= la dernière question), et on ne renvoie JAMAIS du JSON
   brut comme texte à l'utilisateur. */
function _jsonCandidates(raw) {
  const out = [];
  let depth = 0, start = -1, inStr = false, escp = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (escp) escp = false;
      else if (c === '\\') escp = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (!depth) start = i; depth++; }
    else if (c === '}' && depth > 0) { depth--; if (!depth && start >= 0) { out.push(raw.slice(start, i + 1)); start = -1; } }
  }
  return out;
}
/* Le modèle rend parfois l'action IMBRIQUÉE :
     {"action":{"id":"kn.list_reminders","args":{},"annonce":"…"}}
   au lieu de la forme demandée :
     {"action":"kn.list_reminders","args":{},"annonce":"…"}
   C'est du JSON VALIDE et la décision est JUSTE — seule la forme diffère.
   `typeof p.action === 'string'` échouait donc, et on servait « Je me suis
   emmêlée » sur une réponse parfaite (banc de routage 20/07 : 3/3 sur
   « mes rappels en retard ? »). On aplatit au lieu de jeter. */
function _flattenAction(p) {
  if (p && p.action && typeof p.action === 'object' && !Array.isArray(p.action)
      && typeof p.action.id === 'string') {
    return { ...p, action: p.action.id,
             args   : (p.action.args && typeof p.action.args === 'object') ? p.action.args : p.args,
             annonce: typeof p.action.annonce === 'string' ? p.action.annonce : p.annonce };
  }
  return p;
}

function _parseDecision(raw, ou) {
  if (!raw) return null;
  const decisions = [];
  for (const cand of _jsonCandidates(raw)) {
    try {
      const p = _flattenAction(JSON.parse(cand));
      if (typeof p.action === 'string' && p.action.trim()) {
        decisions.push({
          action : p.action.trim(),
          args   : (p.args && typeof p.args === 'object') ? p.args : {},
          annonce: typeof p.annonce === 'string' ? p.annonce.slice(0, 300) : '',
        });
      } else if (typeof p.reponse === 'string' && p.reponse.trim()) {
        decisions.push({ reponse: p.reponse });
      }
    } catch (e) { /* candidat invalide, on continue */ }
  }
  if (decisions.length) return decisions[decisions.length - 1];
  /* aucun JSON exploitable : texte direct, SAUF si ça ressemble à du
     JSON/fence cassé → message sobre plutôt que du brut à l'écran */
  const txt = raw.replace(/```[a-z]*\n?/g, '').trim();
  if (!txt || txt.startsWith('{') || txt.includes('"action"') || txt.includes('"reponse"')) {
    /* TROU DE JOURNALISATION COMBLÉ (banc de routage, 20/07) : ce repli-ci
       rendait le MÊME message que _EMMELEE mais SANS trace, et comme il
       renvoie un objet truthy, l'appelant `_parseDecision(x) || _EMMELEE(…)`
       ne déclenchait jamais le log. Résultat : « Je me suis emmêlée » à
       l'écran et RIEN au wrangler tail — on croyait la boucle saine.
       `ou` distingue l'origine (etage2 vs 1 étage). */
    console.error(`[kora] emmêlée @${ou || 'parseDecision'} — brut: ${_brut(raw)}`);
    return { reponse: 'Je me suis emmêlée — reformule ta demande, je réessaie.' };
  }
  return { reponse: txt.slice(0, 1200) };
}

/* ═══ Routage 2 étages — helpers (exportés pour les tests) ═══ */
/* « Je me suis emmêlée » était une BOÎTE NOIRE : rendu sans trace, on ne
   savait jamais POURQUOI (dogfood K-7, 19/07 — une même question marchait
   puis échouait selon l'historique, impossible à diagnostiquer). Chaque
   repli journalise désormais sa cause + la sortie brute du modèle, visibles
   au `wrangler tail`. `ou` = où ça a lâché, `raw` = ce que le modèle a dit. */
/* aplati : `wrangler tail` n'affiche QUE la 1re ligne d'un log, or le
   modèle répond volontiers en JSON multi-lignes dans une balise ```json —
   sans ça on ne voyait que « ```json » et jamais la cause (20/07). */
const _brut = (r) => String(r ?? '').replace(/\s+/g, ' ').slice(0, 400);
const _EMMELEE = (ou, raw) => {
  console.error(`[kora] emmêlée @${ou || '?'} — brut: ${_brut(raw)}`);
  return { reponse: 'Je me suis emmêlée — reformule ta demande, je réessaie.' };
};

/* Le modèle désigne le domaine en TEXTE LIBRE : il rend tantôt la clé
   (« social »), tantôt le libellé (« Social Manager »), tantôt une variante
   accentuée. Une comparaison stricte le renvoyait en repli sobre alors que
   son choix était bon — d'où « combien de posts ai-je faits ? » qui marche
   au 1er tour puis échoue après un autre échange (dogfood K-7).
   Résolution tolérante : clé exacte → clé pliée → libellé plié → inclusion.
   (regex de pliage COPIÉE de app/kora-actions.js:593 — ne jamais la retaper,
   le caractère combinant se recasse à la saisie : piège déjà payé 2×) */
const _norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
export function _resolveDomain(raw, padKeys, metaByPad) {
  const keys = [...padKeys];
  const want = _norm(raw);
  if (!want) return null;
  const exact = keys.find(k => k === String(raw || '').toLowerCase().trim());
  if (exact) return exact;
  const folded = keys.find(k => _norm(k) === want);
  if (folded) return folded;
  const byLabel = keys.find(k => { const m = metaByPad && metaByPad.get(k); return m && m.label && _norm(m.label) === want; });
  if (byLabel) return byLabel;
  /* inclusion : « le social manager », « domaine sentinel » → la bonne clé.
     On classe par longueur du terme qui a matché (le plus long gagne), pour
     qu'une clé courte ne rafle pas un domaine plus précis. */
  let best = null, bestLen = 0;
  for (const k of keys) {
    const label = _norm((metaByPad && metaByPad.get(k) || {}).label || '');
    for (const term of [_norm(k), label]) {
      if (term && want.includes(term) && term.length > bestLen) { best = k; bestLen = term.length; }
    }
  }
  return best;
}

export function _wantsTwoStage(body) {
  const n = Array.isArray(body && body.actions) ? body.actions.length : 0;
  return n > MAX_ACTIONS || !!(body && body.routing === '2e');
}

function _sysStage1(domainsBlock, globalBlock) {
  return `${PERSONA}

Tu disposes de DOMAINES d'outils (leurs actions détaillées te seront montrées
à l'étape suivante) et d'ACTIONS GLOBALES utilisables tout de suite.

DOMAINES DISPONIBLES :
${domainsBlock}

ACTIONS GLOBALES :
${globalBlock}

FORMAT DE SORTIE — un SEUL objet JSON, aucun texte autour, aucune balise \`\`\` :
- La demande relève d'un domaine → {"domaine":"nom.exact.du.domaine"}
- Une action GLOBALE s'impose → {"action":"id.exact","args":{...},"annonce":"une phrase à la première personne sur ce que tu vas faire"}
- Réponse directe (salutation, remerciement, hors catalogue) → {"reponse":"ta réponse"}
- Tu ne traites que la DERNIÈRE question (l'historique n'est que du contexte).

RÈGLES :
- RÉDIGER un article, une promo, un contenu travaillé → chain.start (c'est le
  brief que tu rédiges, jamais l'article — la chaîne écrit bien mieux que toi).
- Il te FOURNIT un texte prêt à poster → {"domaine":"social"} ; faire
  retravailler un texte existant → {"domaine":"ghostwriter"}.
- « annule », « arrête », « stop » PENDANT que tu pilotes une chaîne →
  chain.cancel — TOUJOURS l'action, JAMAIS un {"reponse"} qui prétend avoir
  annulé sans rien faire.
- Publier/programmer/envoyer/supprimer → propose de PRÉPARER à la place :
  {"reponse":"publier, c'est ton geste — mais je peux te le préparer, dis-moi."}
- ⚠ « génère », « crée », « fais-moi », « prépare » ne sont PAS des refus :
  un domaine sait le faire → réponds {"domaine":"…"}, JAMAIS un {"reponse"}
  qui promet de préparer sans rien faire. « génère/crée un QR (code) [vers
  une adresse] » → {"domaine":"sdqr"}. Ne promets JAMAIS une action que tu
  n'appelles pas dans le même tour.
- Données hors catalogue (e-mails, comptabilité…) → {"reponse":"je ne sais pas
  encore lire ça — je peux te lire : tes séances, tes posts, tes réseaux, tes
  QR codes et leurs scans, tes sites surveillés, tes notes Keynapse, tes
  jumeaux Smart Agent, le chemin de fer de tes revues desK, tes flipbooks
  booK, tes chartes Key Brand…"}
- Le message t'INFORME ou acquiesce au lieu de te demander quelque chose
  (« ok je lance la séance », « c'est fait », « j'ai publié », « merci ») →
  {"reponse"} brève, AUCUNE action, AUCUN domaine — même si la phrase
  contient un verbe d'action : dans « je lance la séance », c'est LUI qui
  agit, pas toi. Regarde QUI fait l'action avant de bouger.
- Ambiguïté entre 2 domaines → choisis le plus probable, ne pose pas de question.
- N'invente JAMAIS un nom de domaine ni un id hors des listes ci-dessus.

EXEMPLES :
« qu'est-ce qui part cette semaine ? » → {"domaine":"social"}
« mon site est en ligne ? » → {"domaine":"sentinel"}
« qu'est-ce que j'ai noté sur le stand du salon ? » → {"domaine":"keynapse"}
« mon agent ne sait pas répondre à quoi ? » → {"domaine":"smartagent"}
« où en est ma revue ? qui n'a pas rendu sa copie ? » → {"domaine":"desk"}
« mes flipbooks, j'en ai combien ? » → {"domaine":"book"}
« ma charte graphique est publiée ? » → {"domaine":"keybrand"}
« rédige-moi un article pour LinkedIn sur nos nouveautés » → {"action":"chain.start","args":{"network":"linkedin","brief":"Présenter nos nouveautés aux professionnels : bénéfices concrets, ton à trouver"},"annonce":"Un contenu qui compte mérite la chaîne complète — je lance la séance et je fais les relais."}
« merci ! » → {"reponse":"Avec plaisir — je reste là si tu as besoin."}`;
}

function _sysStage2(padLabel, actionsBlock) {
  return `${PERSONA}

La demande de l'utilisateur concerne le domaine « ${padLabel} ».
TES ACTIONS pour ce domaine (rien d'autre n'existe) :
${actionsBlock}

FORMAT DE SORTIE — un SEUL objet JSON, aucun texte autour, aucune balise \`\`\` :
- Action : {"action":"id.exact","args":{...},"annonce":"une phrase à la première personne sur ce que tu vas faire"}
- Aucune action listée ne couvre la demande → {"reponse":"explication honnête et courte"} — n'invente JAMAIS un id ni une capacité.
- Tu ne traites que la DERNIÈRE question de l'utilisateur (l'historique n'est là que pour le contexte).
- args = uniquement les paramètres déclarés, avec leurs valeurs admises ; un paramètre optionnel inconnu s'omet, ne l'invente pas.
- Lire [lecture] ou préparer [prépare], tu SAIS le faire : ne dis jamais « je ne sais pas » pour une action listée.`;
}

export function _parseStage1(raw) {
  if (!raw) return null;
  const out = [];
  for (const cand of _jsonCandidates(raw)) {
    try {
      const p = _flattenAction(JSON.parse(cand));
      if (typeof p.domaine === 'string' && p.domaine.trim()) {
        out.push({ domaine: p.domaine.trim().toLowerCase() });
      } else if (typeof p.action === 'string' && p.action.trim()) {
        out.push({
          action : p.action.trim(),
          args   : (p.args && typeof p.args === 'object') ? p.args : {},
          annonce: typeof p.annonce === 'string' ? p.annonce.slice(0, 300) : '',
        });
      } else if (typeof p.reponse === 'string' && p.reponse.trim()) {
        out.push({ reponse: p.reponse });
      }
    } catch (e) { /* candidat invalide */ }
  }
  if (out.length) return out[out.length - 1];
  /* FILET DE SECOURS TEXTE BRUT (dogfood K-7, 19/07) — symétrique de
     _parseDecision, qui l'avait depuis toujours ; l'étage 1 ne l'avait PAS.
     Symptôme : « supprime ma dernière séance » → « Je me suis emmêlée »,
     3 tours de suite, y compris sur une question banale de relance.
     Cause : quand le modèle REFUSE (ou converse), il répond très souvent en
     français normal au lieu du JSON demandé — un échec de FORMAT, pas de
     contenu : cette prose EST la réponse voulue. Sans filet, _parseStage1
     rendait null → _twoStageDecide → _EMMELEE. La régression est devenue
     visible en prod dès que le catalogue a dépassé 32 actions (Keynapse,
     36) et rendu le chemin 2 étages permanent.
     On écarte quand même ce qui ressemble à du JSON cassé (mieux vaut le
     message sobre que du brut à l'écran) — d'où les gardes ci-dessous. */
  const txt = String(raw).replace(/```[a-z]*\n?/g, '').trim();
  if (!txt || txt.startsWith('{')
      || txt.includes('"action"') || txt.includes('"reponse"') || txt.includes('"domaine"')) return null;
  return { reponse: txt.slice(0, 1200) };
}

/* Orchestrateur — runLLM injectable (les tests passent un faux moteur,
   handleKoraChat passe env.AI ; même patron que buildChatMessages côté
   Smart Agent : la logique se teste sans Workers). */
export async function _twoStageDecide({ runLLM, actions, pads, messages }) {
  const list = Array.isArray(actions) ? actions.filter(a => a && typeof a.id === 'string') : [];
  const meta = Array.isArray(pads) ? pads.filter(p => p && typeof p.pad === 'string') : [];
  const globalSet = new Set(meta.filter(p => p.global).map(p => p.pad));
  if (!globalSet.size) { globalSet.add('chaine'); globalSet.add('os'); }   // repli client ancien

  const groups = new Map();
  for (const a of list) {
    if (globalSet.has(a.pad)) continue;
    if (!groups.has(a.pad)) groups.set(a.pad, []);
    if (groups.get(a.pad).length < MAX_PAD_ACTIONS) groups.get(a.pad).push(a);
  }
  const globals = list.filter(a => globalSet.has(a.pad));
  const domains = [...groups.keys()].slice(0, MAX_PADS);
  if (domains.length < groups.size)
    console.error(`[kora] routage : ${groups.size} domaines > MAX_PADS=${MAX_PADS} — les derniers sont invisibles du modèle`);
  const metaByPad = new Map(meta.map(p => [p.pad, p]));
  const domainsBlock = domains.map(p => {
    const m = metaByPad.get(p);
    const desc = (m && m.desc) ? String(m.desc).slice(0, MAX_PAD_DESC)
      : groups.get(p).map(a => a.label || a.id).slice(0, 4).join(' · ');
    return `- ${p} : ${desc}`;
  }).join('\n');

  /* ── étage 1 : aiguillage ── */
  const raw1 = await runLLM(_sysStage1(domainsBlock, _actionsBlock(globals) || '(aucune)'), messages);
  let d1 = _parseStage1(raw1);
  if (!d1) return _EMMELEE('etage1-illisible', raw1);
  if (d1.reponse) return d1;
  if (d1.action) {
    const known = list.find(a => a.id === d1.action);
    if (!known) return _EMMELEE('etage1-action-inconnue', raw1);
    const needsParams = (known.params || []).some(p => p && p.required);
    /* globale, ou id valide SANS paramètre requis : on accepte (self-healing).
       Avec paramètre requis : le modèle n'a pas vu les params → args inventés
       probables → on re-passe par l'étage 2 du pad concerné. */
    if (globalSet.has(known.pad) || !needsParams) return d1;
    d1 = { domaine: known.pad };
  }

  /* ── étage 2 : choix dans le domaine élu ── */
  const pad = _resolveDomain(d1.domaine, groups.keys(), metaByPad);
  if (!pad) return _EMMELEE('domaine-hors-catalogue:' + String(d1.domaine || '').slice(0, 40), raw1);
  const m = metaByPad.get(pad);
  const raw2 = await runLLM(_sysStage2((m && m.label) || pad, _actionsBlock(groups.get(pad))), messages);
  return _parseDecision(raw2, 'etage2') || _EMMELEE('etage2-illisible', raw2);
}

const _corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});

/* ═══ POST /api/kora/chat ═══ */
export async function handleKoraChat(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: _corsHeaders(origin) });
  }

  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise (JWT licence)', 401, origin);
  const lookupHmac = claims.sub;
  const plan       = claims.plan;
  if (!lookupHmac) return err('JWT incomplet (sub manquant) — re-login requis', 401, origin);

  if (!env.AI || typeof env.AI.run !== 'function') {
    return err('Workers AI non configuré sur ce Worker.', 503, origin);
  }

  const body = await parseBody(request);
  if (!body || typeof body !== 'object') return err('Body JSON requis', 400, origin);

  const phase    = body.phase === 'answer' ? 'answer' : 'decide';
  const messages = _capMessages(body.messages);
  if (!messages.length) return err('messages requis', 400, origin);

  /* Bridage budget opérateur — les deux phases consomment des neurones */
  const throttled = await budgetGuard(env, origin);
  if (throttled) return throttled;

  /* ══ PHASE DECIDE — 1 crédit par tour utilisateur ══ */
  if (phase === 'decide') {
    /* Le bloc catalogue ne sert QU'AU chemin 1 étage (le 2 étages bâtit ses
       propres blocs par domaine). Le construire ici inconditionnellement
       faisait crier « catalogue tronqué : 36 > 32 » à CHAQUE requête 2 étages
       alors que le bloc tronqué était aussitôt jeté : fausse alerte
       permanente, qui noie les vrais avertissements (vue au wrangler tail
       pendant le dogfood K-7 — elle m'a d'abord fait croire que le routage
       2 étages ne tournait pas). On se contente ici de VALIDER l'entrée. */
    if (!Array.isArray(body.actions) || !body.actions.some(a => a && typeof a.id === 'string'))
      return err('actions (catalogue scopé) requis', 400, origin);

    let creditsEnforced = false, creditResult = null, committed = false;
    creditsEnforced = await isEnforceEnabled(env, lookupHmac);
    if (creditsEnforced) {
      creditResult = await consumeCredits(env, { bucketKey: lookupHmac, plan, tool: 'kora' });
      if (!creditResult.ok && creditResult.blocked) {
        return json({
          error: `Crédits IA épuisés ce mois sur le plan ${plan}.`,
          code : 'AI_CREDITS_EXHAUSTED',
        }, 429, origin);
      }
    }

    try {
      /* Runner partagé par les 2 chemins de routage : température basse =
         choix d'action déterministe (leçon audit retrieval Smart Agent) ;
         1 réessai — le 1er contact réel a montré des erreurs transitoires
         du modèle (« décision 502 »). Chaque inférence est métrée. */
      const runLLM = async (sys, msgs) => {
        let res = null, lastErr = null;
        for (let attempt = 0; attempt < 2 && !res; attempt++) {
          try {
            res = await env.AI.run(KS_AI_MODEL, {
              messages   : [{ role: 'system', content: sys }, ...msgs],
              max_tokens : MAX_TOKENS_DECIDE,
              temperature: 0.15,
              stream     : false,
            });
          } catch (e) {
            lastErr = e;
            console.error('[kora] decide AI.run tentative', attempt + 1, ':', e?.message || e);
          }
        }
        if (!res) throw (lastErr || new Error('modèle indisponible'));
        const raw = _extractText(res);
        await recordUsage(env, 'kora', {
          usage: res?.usage, inText: sys + JSON.stringify(msgs), outText: raw,
        }).catch(() => {});
        return raw;
      };

      let decision;
      if (_wantsTwoStage(body)) {
        decision = await _twoStageDecide({ runLLM, actions: body.actions, pads: body.pads, messages });
      } else {
        /* bâti ICI seulement : c'est le seul chemin qui s'en sert, donc le
           seul où un « catalogue tronqué » serait une vraie perte */
        /* non-null garanti : la validation d'entrée exige déjà au moins une
           action à `id` chaîne, seul critère de filtrage de _actionsBlock */
        decision = _parseDecision(await runLLM(_sysDecide(_actionsBlock(body.actions)), messages), '1etage');
      }
      if (!decision) throw new Error('réponse modèle vide');
      committed = true;
      return json(
        decision.action
          ? { type: 'action', id: decision.action, args: decision.args, annonce: decision.annonce }
          : { type: 'reponse', text: decision.reponse || '…' },
        200, origin,
      );
    } catch (e) {
      /* la cause réelle part dans les logs (wrangler tail) ; l'utilisateur
         reçoit une phrase sobre 200 — le crédit est remboursé (finally) */
      console.error('[kora] decide échec final :', e?.message || e);
      return json({
        type: 'reponse',
        text: 'Je n’ai pas réussi à réfléchir sur ce coup-là — repose-moi la question dans un instant.',
      }, 200, origin);
    } finally {
      if (!committed && creditsEnforced && creditResult && creditResult.ok) {
        await refundCredits(env, {
          bucketKey: lookupHmac, tool: 'kora',
          cost: creditResult.cost, packsDrawn: creditResult.packsDrawn,
        }).catch(() => {});
      }
    }
  }

  /* ══ PHASE ANSWER — streaming SSE (même tour, pas de nouveau crédit) ══ */
  const actionId = typeof body.action_id === 'string' ? body.action_id.slice(0, 60) : 'lecture';
  let resultStr = '';
  try { resultStr = JSON.stringify(body.action_result ?? null); } catch (e) { resultStr = 'null'; }
  if (resultStr.length > MAX_RESULT_CHARS) resultStr = resultStr.slice(0, MAX_RESULT_CHARS) + '…(tronqué)';

  /* Restitution en contexte MINIMAL : la dernière question + le résultat,
     RIEN d'autre. Leçon du test réel (capture 3, 17/07) : avec l'historique
     complet, le modèle recopiait ses propres hallucinations passées (mêmes
     chiffres inventés répétés mot pour mot) et brodait de faux posts sur
     les thèmes des tours précédents. Ce qu'il ne voit pas, il ne peut pas
     le recopier. */
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const convo = [
    { role: 'system', content: SYS_ANSWER },
    ...(lastUser ? [{ role: 'user', content: lastUser.content }] : []),
    { role: 'user', content: `RÉSULTAT de l'action ${actionId} (JSON) :\n${resultStr}\n\nRéponds-moi maintenant. Si ce résultat est vide (total 0, listes vides), dis-le honnêtement — n'invente rien.` },
  ];

  let aiStream;
  try {
    /* temp au plancher pour la restitution : fidélité maximale, dérive
       minimale (l'hallucination de liste du 18/07 tournait à 0.3) */
    aiStream = await env.AI.run(KS_AI_MODEL, {
      messages: convo, max_tokens: MAX_TOKENS_ANSWER, temperature: 0.05, stream: true,
    });
  } catch (e) {
    return err(`Kora indisponible (${e?.message || 'erreur modèle'})`, 502, origin);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); }
        catch (e) { /* stream fermé */ }
      };
      let outText = '', buffer = '';
      try {
        const reader = aiStream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const j = JSON.parse(payload);
              const chunk = j.response ?? j.choices?.[0]?.delta?.content;
              /* Workers AI sur-parse les tokens : un token numérique arrive
                 en NOMBRE JSON (« 6 » → 6), et « 0 » est falsy. Donc : ni
                 filtre par truthiness, ni filtre par typeof — on accepte
                 chaînes ET nombres, converti explicitement en chaîne. */
              if (chunk !== null && chunk !== undefined && chunk !== '') {
                const s = String(chunk);
                outText += s;
                send({ type: 'chunk', text: s });
              }
            } catch (e) { /* fragment non-JSON, on attend la suite */ }
          }
        }
      } catch (e) {
        send({ type: 'error', message: 'flux interrompu' });
      }
      await recordUsage(env, 'kora', {
        inText: SYS_ANSWER + resultStr, outText,
      }).catch(() => {});
      send({ type: 'done' });
      try { controller.close(); } catch (e) { /* déjà fermé */ }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ..._corsHeaders(origin),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
    },
  });
}
