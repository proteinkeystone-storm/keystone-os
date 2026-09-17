/* ═══════════════════════════════════════════════════════════════
   Banc — LA RÈGLE : rien ne disparaît tout seul (17/09/2026)
   ───────────────────────────────────────────────────────────────
   Règle posée par Stéphane, mot pour mot : « rien ne doit disparaître ».
   Elle est facile à casser sans le vouloir — il suffit qu'un sprint
   rebranche un DELETE daté dans le cron quotidien. Ce banc est là pour
   qu'un tel retour en arrière fasse ROUGE.

   Pour chaque purge du cron, il vérifie DEUX choses :
     1. avec l'environnement de prod (aucun drapeau), la fonction ne
        supprime RIEN — pas une ligne ;
     2. armée explicitement (« on »), elle supprime — la mécanique est
        intacte, seule sa détente a changé de position.

   Couvert : scans de QR (SDQR_SCAN_PURGE), événements de la landing
   (KS_LANDING_PURGE), journal d'audit (KS_AUDIT_PURGE), conversations
   publiques du Conseiller (KS_SA_PUBLIC_PURGE).

   Volontairement HORS périmètre, et pourquoi (cf. BRIEF_SDQR_HISTORIQUE_SCANS §7) :
     · liens magiques consommés, journal des demandes d'auth, jetons OAuth,
       confirmations MCP : leur expiration EST la sécurité ;
     · Sceau : le secret à lecture unique s'autodétruit, c'est le produit ;
     · réponses Key Form : la durée est choisie par le propriétaire du
       formulaire ET annoncée à la personne qui répond — une promesse ;
     · reflets MCP, cache d'interstitiel, files de travaux : des copies,
       reconstruites toutes seules.
   Lancement : node scripts/test-aucune-purge.mjs
   ═══════════════════════════════════════════════════════════════ */
import { DatabaseSync } from 'node:sqlite';
import { handleScheduledPurge } from '../workers/src/routes/qr.js';
import { pruneTrackEvents } from '../workers/src/routes/track.js';
import { purgeAuditLogs } from '../workers/src/lib/audit.js';
import { handleSmartAgentLifecycle } from '../workers/src/routes/smart-agent.js';

let pass = 0, fail = 0;
const ok  = (l) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ko  = (l, d) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${l}\n      ${d}`); };
const yes = (v, l, d = '') => (v ? ok(l) : ko(l, d || 'attendu vrai'));
const eq  = (a, e, l) => (a === e ? ok(l) : ko(l, `attendu ${e}, reçu ${a}`));

function makeD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql) => {
    let args = [];
    const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
    const api = {
      bind(...b) { args = b.map(norm); return api; },
      async first(col) { const r = db.prepare(sql).get(...args) ?? null; return col && r ? r[col] : r; },
      async all()      { return { results: db.prepare(sql).all(...args), success: true, meta: {} }; },
      async run()      { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    };
    return api;
  };
  return { prepare: stmt, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; }, _db: db };
}

const DB = makeD1();
const vieux = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace('T', ' ');
DB._db.exec(`
CREATE TABLE qr_scans (id INTEGER PRIMARY KEY AUTOINCREMENT, short_id TEXT NOT NULL, ts TEXT, country TEXT, device_kind TEXT, os_kind TEXT, ua_hash TEXT);
CREATE TABLE qr_redirects (short_id TEXT PRIMARY KEY, qr_id TEXT, tenant_id TEXT, target_url TEXT, status TEXT, qr_type TEXT);
CREATE TABLE qr_scan_daily (short_id TEXT NOT NULL, day TEXT NOT NULL, scans INTEGER DEFAULT 0, uniques INTEGER DEFAULT 0, updated_at TEXT, PRIMARY KEY (short_id, day));
CREATE TABLE system_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE landing_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, session_id TEXT, step TEXT);
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, action TEXT, actor TEXT, target TEXT, tenant_id TEXT, details TEXT, ip TEXT);
CREATE TABLE sa_public_usage (day TEXT, agent_id TEXT, n INTEGER);
CREATE TABLE sa_sessions (id TEXT PRIMARY KEY, channel TEXT, created_at TEXT);
CREATE TABLE sa_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT);
CREATE TABLE kortex_units (id TEXT PRIMARY KEY, tenant_id TEXT, type TEXT, title TEXT, body TEXT, status TEXT, review_at TEXT, agent_id TEXT, vault_id TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE kortex_units_fts_v2 (unit_id TEXT);
INSERT INTO qr_scans (short_id, ts, ua_hash) VALUES ('BEL','${vieux(400)}','u1'), ('BEL','${vieux(300)}','u2'), ('BEL','${vieux(5)}','u3');
INSERT INTO landing_events (ts, session_id, step) VALUES ('${vieux(400)}','s1','view'), ('${vieux(200)}','s2','view'), ('${vieux(2)}','s3','view');
INSERT INTO audit_logs (ts, action, actor) VALUES ('${vieux(1200)}','qr_create','moi'), ('${vieux(900)}','qr_delete','moi'), ('${vieux(3)}','qr_scans_erase','moi');
INSERT INTO sa_public_usage (day, agent_id, n) VALUES ('${vieux(400).slice(0,10)}','a1',3), ('${vieux(2).slice(0,10)}','a1',1);
INSERT INTO sa_sessions (id, channel, created_at) VALUES ('s-vieille','public','${vieux(400)}'), ('s-neuve','public','${vieux(1)}');
INSERT INTO sa_messages (session_id, role, content) VALUES ('s-vieille','user','bonjour de 2025'), ('s-neuve','user','bonjour d’hier');
`);
const n = (t) => DB._db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

console.log('\n▶ 1 · Environnement de PROD : le cron ne supprime rien');
{
  const avant = { scans: n('qr_scans'), landing: n('landing_events'), audit: n('audit_logs'),
                  usage: n('sa_public_usage'), sessions: n('sa_sessions'), messages: n('sa_messages') };

  await handleScheduledPurge({ DB, SDQR_SCAN_RETENTION_DAYS: '90' });
  eq(n('qr_scans'), avant.scans, 'scans de QR : aucune ligne supprimée');
  const meta = JSON.parse(DB._db.prepare(`SELECT value FROM system_meta WHERE key='last_purge_at'`).get().value);
  eq(meta.purge, 'off', '… et le journal du cron le dit (« purge: off »)');

  const t = await pruneTrackEvents({ DB });
  eq(n('landing_events'), avant.landing, 'événements de la landing : rien supprimé');
  eq(t.purge, 'off', '… drapeau annoncé « off »');

  const a = await purgeAuditLogs({ DB });
  eq(n('audit_logs'), avant.audit, 'journal d’audit : rien supprimé');
  eq(a.purge, 'off', '… drapeau annoncé « off »');

  await handleSmartAgentLifecycle({ DB });
  eq(n('sa_public_usage'), avant.usage, 'compteurs d’usage du Conseiller : rien supprimé');
  eq(n('sa_sessions'), avant.sessions, 'conversations publiques : rien supprimé');
  eq(n('sa_messages'), avant.messages, '… et leurs messages non plus');
}

console.log('\n▶ 2 · Armée explicitement : la mécanique fonctionne toujours');
{
  await handleScheduledPurge({ DB, SDQR_SCAN_RETENTION_DAYS: '90', SDQR_SCAN_PURGE: 'on' });
  eq(n('qr_scans'), 1, 'scans : les deux vieux partent, le récent reste');
  yes(DB._db.prepare("SELECT COUNT(*) AS n FROM qr_scan_daily WHERE short_id='BEL'").get().n >= 2, '… et le compteur journalier les avait consolidés avant');

  await pruneTrackEvents({ DB, KS_LANDING_PURGE: 'on' });
  eq(n('landing_events'), 1, 'landing : seuls les événements de plus de 90 jours partent');

  const ap = await purgeAuditLogs({ DB, KS_AUDIT_PURGE: 'on', KS_AUDIT_RETENTION_DAYS: '730' });
  eq(ap.purged, 2, 'audit : les deux lignes de plus de 730 jours partent');
  eq(n('audit_logs'), 1, '… la récente reste');

  await handleSmartAgentLifecycle({ DB, KS_SA_PUBLIC_PURGE: 'on' });
  eq(n('sa_sessions'), 1, 'Conseiller : la vieille conversation publique part');
  eq(n('sa_messages'), 1, '… avec ses messages');
  eq(n('sa_public_usage'), 1, '… et les vieux compteurs d’usage');
}

console.log(`\n${pass + fail} vérifications — ${pass} \x1b[32mok\x1b[0m, ${fail} ${fail ? '\x1b[31mko\x1b[0m' : 'ko'}\n`);
process.exit(fail ? 1 : 0);
