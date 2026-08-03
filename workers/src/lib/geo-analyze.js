/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Analyse GEO (pur, sans dépendance Cloudflare)
   ─────────────────────────────────────────────────────────────
   Détection de citation / rang, sentiment, scoring de citabilité.
   AUCUN import runtime (pas de puppeteer, pas de bindings) → testable
   sous Node. Partagé par le run AUTO (clé API) et le mode MANUEL
   (copier-coller d'une IA web gratuite) de Sentinel.
   ═══════════════════════════════════════════════════════════════ */

// Sentiment indicatif (heuristique lexicale FR, autour de la mention).
const GEO_POS = ['recommand', 'excellent', 'meilleur', 'réputé', 'repute', 'incontournable', 'qualité', 'qualite', 'prisé', 'prise', 'populaire', 'apprécié', 'apprecie', 'idéal', 'ideal', 'référence', 'reference', 'renommé', 'renomme'];
const GEO_NEG = ['éviter', 'eviter', 'déçu', 'decu', 'mauvais', 'plainte', 'décevant', 'decevant', 'médiocre', 'mediocre', 'arnaque', 'fermé définitivement', 'ferme definitivement'];

export function sentiment(text, name) {
  const t = String(text || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  const i = n ? t.indexOf(n) : -1;
  const win = i >= 0 ? t.slice(Math.max(0, i - 160), i + n.length + 160) : t.slice(0, 320);
  let pos = 0, neg = 0;
  for (const w of GEO_POS) if (win.includes(w)) pos++;
  for (const w of GEO_NEG) if (win.includes(w)) neg++;
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

// L'établissement est-il cité dans la réponse de l'IA ? (nommé / sourcé / rang approx.)
export function detectCitation(text, sources, businessName, host) {
  const t = String(text || '').toLowerCase();
  const name = String(businessName || '').trim().toLowerCase();
  const hostBare = String(host || '').replace(/^www\./, '').toLowerCase();
  let cited = false;
  if (name && name.length >= 2 && t.includes(name)) cited = true;
  if (!cited && hostBare && t.includes(hostBare)) cited = true;
  let sourced = false;
  if (hostBare) { for (const s of (sources || [])) { if (String(s.uri || '').toLowerCase().includes(hostBare)) { sourced = true; break; } } }
  let rank = null;
  if (cited && name) {
    const segs = String(text || '').split(/\n+|(?:\d+[.)]\s)|(?:[•\-]\s)/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < segs.length; i++) { if (segs[i].toLowerCase().includes(name)) { rank = i + 1; break; } }
    if (rank && rank > 10) rank = null;
  }
  return { cited, sourced, rank };
}

// Score d'une cellule (1 question × 1 moteur) : cité #1 = 100, cité = 65-85, sourcé seul = 25.
export function cellScore(c) {
  if (c.cited) { if (c.rank === 1) return 100; if (c.rank && c.rank <= 3) return 85; if (c.rank && c.rank <= 6) return 65; return 75; }
  return c.sourced ? 25 : 0;
}

// Score de citabilité global (0-100) sur toutes les cellules réussies.
export function geoScore(results) {
  const cells = [];
  for (const r of (results || [])) for (const c of ((r && r.engines) || [])) if (!c.error) cells.push(c);
  if (!cells.length) return null;
  return Math.round(cells.reduce((a, c) => a + cellScore(c), 0) / cells.length);
}

// Extrait les URLs d'un texte collé (pour le signal « sourcé » en mode manuel).
export function extractUrls(text) {
  const out = []; const seen = new Set();
  const re = /https?:\/\/[^\s)<>"'\]]+/gi; let m;
  while ((m = re.exec(String(text || ''))) && out.length < 8) {
    const uri = m[0].replace(/[.,;:!?]+$/, '');
    if (!seen.has(uri)) { seen.add(uri); out.push({ title: '', uri }); }
  }
  return out;
}

// Découpe UNE réponse d'IA collée (mode manuel « un seul bloc ») en segments par
// question, via les marqueurs « ### QUESTION N » (lenient : #, *, [, Q/Question,
// numéro). Renvoie [{prompt, text}] mappé sur `prompts`, ou null si aucun
// marqueur exploitable (l'appelant analyse alors le bloc entier en un seul tenant).
export function splitManualAnswer(answer, prompts) {
  const text = String(answer || '');
  const re = /^[ \t>*#[]*q(?:uestion)?[ \t]*#?[ \t]*(\d+)\b[ \t:.)\-\]*]*/gim;
  const marks = []; let m;
  while ((m = re.exec(text))) { marks.push({ n: parseInt(m[1], 10), contentStart: re.lastIndex, lineStart: m.index }); if (re.lastIndex === m.index) re.lastIndex++; }
  if (!marks.length) return null;
  const entries = [];
  for (let i = 0; i < marks.length; i++) {
    const end = (i + 1 < marks.length) ? marks[i + 1].lineStart : text.length;
    const seg = text.slice(marks[i].contentStart, end).trim();
    const idx = marks[i].n - 1;
    const prompt = (idx >= 0 && idx < (prompts || []).length) ? prompts[idx] : `Question ${marks[i].n}`;
    if (seg) entries.push({ prompt, text: seg });
  }
  return entries.length ? entries : null;
}

// Mode MANUEL : à partir des réponses collées (1 par question), construit la
// structure `results` (compatible cockpit) en réutilisant detectCitation/sentiment.
// Aucune clé, aucun crédit — l'utilisateur a interrogé l'IA lui-même.
export function analyzeManual(entries, { engine, businessName, host }) {
  const eng = engine || 'autre';
  const results = [];
  for (const e of (entries || [])) {
    const prompt = String((e && e.prompt) || '').trim();
    if (!prompt) continue;
    const text = String((e && e.text) || '').trim();
    if (!text) { results.push({ prompt, engines: [] }); continue; }
    const sources = extractUrls(text);
    const det = detectCitation(text, sources, businessName, host);
    results.push({ prompt, engines: [{
      engine: eng, cited: det.cited, sourced: det.sourced, rank: det.rank,
      sentiment: det.cited ? sentiment(text, businessName) : null,
      snippet: text.slice(0, 280), sources: sources.slice(0, 4),
    }] });
  }
  return results;
}

// ═══ S14.3 — présence dans les SOURCES que les IA citent ═══════════════════
// Leçon du test Perplexity (Mas des Bouteillans, 2026-08-03) : sur « quel est
// le meilleur X à Y », les IA ne citent pas les meilleurs X — elles citent
// les PAGES QUI LISTENT des X (annuaire de l'office de tourisme, cité 3/3).
// Le vrai levier GEO n'est donc pas sur le site du client : c'est d'être
// présent dans ces sources-là. Sentinel les connaît déjà (elles sont dans
// les réponses stockées) — ce module les agrège et vérifie la présence.

// Agrège les domaines cités dans les résultats d'un run GEO, triés par
// fréquence. Gemini (grounding) sert des URI de redirection — le titre
// porte alors le domaine réel ; on le préfère quand il y ressemble.
export function topCitedDomains(results, max = 4) {
  const counts = new Map();   // domaine → { n, uri }
  for (const r of results || []) {
    for (const cell of (r.engines || [])) {
      for (const s of (cell.sources || [])) {
        let domain = '';
        const t = String(s.title || '').trim().toLowerCase();
        if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(t)) domain = t.replace(/^www\./, '');
        else { try { domain = new URL(s.uri).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) {} }
        if (!domain) continue;
        const e = counts.get(domain) || { n: 0, uri: s.uri };
        e.n++; counts.set(domain, e);
      }
    }
  }
  return [...counts.entries()]
    .map(([domain, e]) => ({ domain, citations: e.n, uri: e.uri }))
    .sort((a, b) => b.citations - a.citations)
    .slice(0, max);
}

// L'établissement figure-t-il dans une page source ? Nom normalisé (accents,
// casse, espaces) cherché dans le TEXTE, ou domaine du client dans le HTML.
const _norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
export function presenceMatch(html, businessName, host) {
  const raw = String(html || '');
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  if (h && raw.toLowerCase().includes(h)) return true;
  const name = _norm(businessName);
  if (name.length < 4) return false;                       // nom trop court → pas de conclusion
  const text = _norm(raw.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ').replace(/<[^>]+>/g, ' '));
  return text.includes(name);
}
