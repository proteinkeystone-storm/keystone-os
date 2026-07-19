#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Ingestion des fiches d'apps (_ai-context/apps/*.md) → Kortex de
   « Conseiller Keystone ». Génère un .sql (kortex_units + FTS) à
   exécuter via `wrangler d1 execute keystone-os --remote --file`.

   Écrit direct en base (pas d'API : pas de token dispo) → on
   reproduit fidèlement handleKortexUnitCreate :
   - status='validated', source_kind='import', source_ref='apps:<slug>'
   - agent_id + vault_id = Conseiller Keystone
   - body = JSON du gabarit ; body_text = [title, ...valeurs].join('\n')
   - miroir FTS (unit_id, title, body_text)
   Vectorize (embeddings) NON peuplé ici → retrieval lexical (FTS) OK
   d'emblée ; POST /kortex/reindex (avec token) rattrape le sémantique.
   ═══════════════════════════════════════════════════════════════ */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT      = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPS_DIR  = join(ROOT, '_ai-context', 'apps');
const OUT_SQL   = join(ROOT, 'scripts', '.ingest-apps-kortex.sql');
// Fiches GLOBALES « Keystone OS » (fix 19/07, « l'article invente encore de
// l'immobilier ») : le coffre ne contenait QUE des fiches par-app — rien qui
// dise ce que Keystone EST globalement → sur un angle « présentation de
// Keystone », le grounding du Gest ramenait des miettes d'apps (ou rien).
// Source : les sections produit/offres/gouvernance de KEYSTONE_OS_CONTEXT.md.
// SQL SÉPARÉ et idempotent (DELETE par source_ref d'abord) : le .sql principal
// a déjà été exécuté en prod — le rejouer dupliquerait les 169 fiches d'apps.
const CTX_FILE       = join(ROOT, '_ai-context', 'KEYSTONE_OS_CONTEXT.md');
const OUT_SQL_GLOBAL = join(ROOT, 'scripts', '.ingest-keystone-global.sql');

const TENANT   = 'default';
const AGENT_ID = '4c2691e8-085b-409b-af80-f8ca441c96db';   // Conseiller Keystone
const VAULT_ID = 'e1dccc3c-7656-4957-bd07-7421857b696c';   // son coffre privé

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
const clip   = (s, n) => (s.length > n ? s.slice(0, n) : s);

// body_text = titre + valeurs des champs (ordre du gabarit), comme validateUnit.
function makeFiche(app, type, title, fields) {
  const values = Object.values(fields).map(v => String(v).trim()).filter(Boolean);
  const body_text = [title, ...values].join('\n');
  return {
    id: randomUUID(), type,
    title: clip(title, 200),
    body: JSON.stringify(fields),
    body_text: clip(body_text, 8000),
    source_ref: `apps:${app.slug}`,
  };
}

// ── Parse un .md d'app en fiches typées ──────────────────────────
function parseApp(slug, md) {
  const lines = md.split('\n');
  const appName = (md.match(/^#\s+(.+)$/m)?.[1] || slug).trim();
  const app = { slug, name: appName };
  const fiches = [];

  let mode = null;          // 'howto' | 'faq' | 'context' | 'other'
  let ctxTitle = null;      // sous-section ### courante (mode context)
  let ctxBuf = [];
  const flushCtx = () => {
    const text = ctxBuf.join(' ').replace(/\s+/g, ' ').trim();
    if (ctxTitle && text.length > 40) {
      fiches.push(makeFiche(app, 'fact', `${appName} — ${ctxTitle}`, { statement: text }));
    }
    ctxTitle = null; ctxBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    // « En une phrase. » → definition
    const oneLiner = line.match(/^\*\*En une phrase\.?\*\*\s*(.+)$/i);
    if (oneLiner) {
      fiches.push(makeFiche(app, 'definition', `${appName}, en une phrase`,
        { term: appName, definition: oneLiner[1].trim() }));
      continue;
    }

    // En-tête de section (**...:**)
    const header = line.match(/^\*\*(.+?):?\*\*:?\s*$/);
    if (header) {
      if (mode === 'context') flushCtx();
      const h = header[1].toLowerCase();
      if (h.includes('question'))                              mode = 'faq';
      else if (h.includes('comment') || h.includes('ce que'))  mode = 'howto';
      else if (h.includes('contexte'))                          mode = 'context';
      else                                                      mode = 'other';
      continue;
    }

    // Sous-section ### (mode contexte)
    if (mode === 'context' && line.startsWith('###')) {
      flushCtx();
      ctxTitle = line.replace(/^#+\s*/, '').trim();
      continue;
    }

    // FAQ : « - **Question ?** Réponse »
    if (mode === 'faq') {
      const qa = line.match(/^[-*]\s*\*\*(.+?)\*\*\s*(.*)$/);
      if (qa && qa[2].trim().length > 3) {
        fiches.push(makeFiche(app, 'qa', clip(qa[1].trim(), 200),
          { question: qa[1].trim(), answer: qa[2].trim() }));
        continue;
      }
    }

    // How-to : « - Label: texte » → fact
    if (mode === 'howto') {
      const b = line.match(/^[-*]\s+(.*)$/);
      if (b) {
        const seg = b[1];
        const m = seg.match(/^([^:]{2,40}):\s*(.+)$/);
        const label = m ? m[1].trim() : seg.slice(0, 40).trim();
        const stmt  = m ? seg : seg;
        if (stmt.length > 20) {
          fiches.push(makeFiche(app, 'fact', `${appName} · ${label}`, { statement: stmt.trim() }));
        }
        continue;
      }
    }

    // Contexte : on accumule prose + puces sous la sous-section courante
    if (mode === 'context') {
      ctxBuf.push(line.replace(/^[-*]\s+/, ''));
      continue;
    }
  }
  if (mode === 'context') flushCtx();
  return { app, fiches };
}

// ── Fiches globales « Keystone OS » (KEYSTONE_OS_CONTEXT.md) ─────
// Périmètre : tout AVANT « ## Le catalogue d'applications » (le catalogue
// par-app est déjà couvert par apps/*.md). Une fiche par titre ##/### de
// prose ; les sections bruit (changelog, support) sont écartées. Le
// grounding du Gest tronque chaque fiche à ~240 car. au retrieval →
// beaucoup de PETITES fiches valent mieux qu'une grosse.
function parseGlobalContext(md) {
  const app = { slug: 'keystone-os', name: 'Keystone OS' };
  const fiches = [];
  const SKIP = /nouveaut|besoin d'aide|l'aide de chaque outil/i;
  const cut = md.search(/^## Le catalogue d'applications/m);
  const scope = cut > 0 ? md.slice(0, cut) : md;

  let title = null, buf = [], skipping = false;
  const flush = () => {
    const text = buf.join(' ').replace(/\s+/g, ' ').trim();
    if (title && !skipping && text.length > 40) {
      fiches.push(makeFiche(app, 'fact', `Keystone OS — ${title}`, { statement: text }));
    }
    buf = [];
  };
  for (const raw of scope.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^(#{2,4})\s+(.+)$/);
    if (h) {
      flush();
      if (h[1].length === 4) { continue; }        // #### = sous-découpage (mois du changelog) : reste dans le skip courant
      title = h[2].replace(/[_*]/g, '').trim();
      skipping = SKIP.test(title);
      continue;
    }
    if (!line || line === '---' || line.startsWith('>') || line.startsWith('# ')) continue;
    buf.push(line.replace(/^[-*]\s+/, '').replace(/[_*]/g, ''));
  }
  flush();

  // Fiche de tête, la plus importante : ce que Keystone EST — et n'est PAS.
  // Cohérente avec _KEYSTONE_FACTS (app/kora-actions.js), la source de vérité
  // de la description officielle ; c'est la négation qui tue l'invention.
  fiches.unshift(makeFiche(app, 'definition', 'Keystone OS, en une phrase', {
    term: 'Keystone OS',
    definition: "Keystone (Keystone OS) est un espace de travail modulaire édité par Protein Studio : " +
      "il réunit des outils métier dans une seule application web installable (PWA), l'utilisateur active " +
      "uniquement ce dont il a besoin via le K-Store, l'IA est incluse dans l'abonnement (compteur mensuel, " +
      "pas de jetons), conçu local d'abord et souverain (données métier dans le navigateur, RGPD). " +
      "IMPORTANT : Keystone n'est PAS un logiciel d'immobilier ni d'un métier unique — c'est un OS " +
      "d'outils métier, généraliste et modulaire.",
  }));
  return fiches;
}

// ── Exécution ────────────────────────────────────────────────────
const files = readdirSync(APPS_DIR).filter(f => f.endsWith('.md')).sort();
let all = [];
const perApp = [];
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  const { app, fiches } = parseApp(slug, readFileSync(join(APPS_DIR, f), 'utf8'));
  perApp.push({ app: app.name, slug, n: fiches.length, types: fiches.reduce((a, x) => (a[x.type] = (a[x.type] || 0) + 1, a), {}) });
  all = all.concat(fiches);
}

// Génère le SQL (wrangler --file enveloppe déjà l'exécution de façon atomique :
// D1 rejette un BEGIN/COMMIT explicite, et restaure l'état initial si échec).
const stmts = [];
for (const u of all) {
  stmts.push(
    `INSERT INTO kortex_units (id, tenant_id, agent_id, vault_id, type, title, body, body_text, status, source_kind, source_ref, lang) ` +
    `VALUES (${sqlStr(u.id)}, ${sqlStr(TENANT)}, ${sqlStr(AGENT_ID)}, ${sqlStr(VAULT_ID)}, ${sqlStr(u.type)}, ${sqlStr(u.title)}, ${sqlStr(u.body)}, ${sqlStr(u.body_text)}, 'validated', 'import', ${sqlStr(u.source_ref)}, 'fr');`
  );
  /* FTS v2 (migration 2026-07-16, smart-agent.js:296) : l'ancienne
     kortex_units_fts (unit_id, title, body_text) a été migrée puis
     SUPPRIMÉE — le retrieval réel interroge kortex_units_fts_v2, cloisonnée
     tenant_id/vault_id (UNINDEXED). Sans ce miroir, la fiche existe dans
     kortex_units mais est INVISIBLE du FTS (silencieux : aucune erreur, le
     hit ne remonte jamais). */
  stmts.push(
    `INSERT INTO kortex_units_fts_v2 (unit_id, tenant_id, vault_id, title, body_text) ` +
    `VALUES (${sqlStr(u.id)}, ${sqlStr(TENANT)}, ${sqlStr(VAULT_ID)}, ${sqlStr(u.title)}, ${sqlStr(u.body_text)});`
  );
}
writeFileSync(OUT_SQL, stmts.join('\n') + '\n', 'utf8');

// ── SQL séparé : fiches globales (idempotent — DELETE d'abord) ───
const globals = parseGlobalContext(readFileSync(CTX_FILE, 'utf8'));
const gStmts = [
  `DELETE FROM kortex_units_fts_v2 WHERE unit_id IN (SELECT id FROM kortex_units WHERE tenant_id = ${sqlStr(TENANT)} AND agent_id = ${sqlStr(AGENT_ID)} AND source_ref = 'apps:keystone-os');`,
  `DELETE FROM kortex_units WHERE tenant_id = ${sqlStr(TENANT)} AND agent_id = ${sqlStr(AGENT_ID)} AND source_ref = 'apps:keystone-os';`,
];
for (const u of globals) {
  gStmts.push(
    `INSERT INTO kortex_units (id, tenant_id, agent_id, vault_id, type, title, body, body_text, status, source_kind, source_ref, lang) ` +
    `VALUES (${sqlStr(u.id)}, ${sqlStr(TENANT)}, ${sqlStr(AGENT_ID)}, ${sqlStr(VAULT_ID)}, ${sqlStr(u.type)}, ${sqlStr(u.title)}, ${sqlStr(u.body)}, ${sqlStr(u.body_text)}, 'validated', 'import', ${sqlStr(u.source_ref)}, 'fr');`
  );
  gStmts.push(
    `INSERT INTO kortex_units_fts_v2 (unit_id, tenant_id, vault_id, title, body_text) ` +
    `VALUES (${sqlStr(u.id)}, ${sqlStr(TENANT)}, ${sqlStr(VAULT_ID)}, ${sqlStr(u.title)}, ${sqlStr(u.body_text)});`
  );
}
writeFileSync(OUT_SQL_GLOBAL, gStmts.join('\n') + '\n', 'utf8');

// Rapport
console.log('── Fiches par app ──');
for (const p of perApp) console.log(`  ${p.app.padEnd(20)} ${String(p.n).padStart(3)}  ${JSON.stringify(p.types)}`);
console.log(`\nTOTAL : ${all.length} fiches → ${OUT_SQL}`);
console.log(`GLOBALES « Keystone OS » : ${globals.length} fiches → ${OUT_SQL_GLOBAL} (idempotent, à exécuter seul)`);
console.log('── Titres globaux ──');
for (const u of globals) console.log(`  [${u.type}] ${u.title}`);
console.log('\n── Échantillon (5 premières) ──');
for (const u of all.slice(0, 5)) console.log(`  [${u.type}] ${u.title}\n     ${u.body_text.replace(/\n/g, ' / ').slice(0, 140)}`);
