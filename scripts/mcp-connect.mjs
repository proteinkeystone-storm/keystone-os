#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Brancher Claude Code au serveur MCP, en une commande
   ───────────────────────────────────────────────────────────────
   Sans navigateur, sans presse-papiers : connexion par code e-mail
   (le même flux que l'app), puis enregistrement du connecteur dans
   Claude Code. Le jeton n'est JAMAIS affiché.

   Lancement :  node scripts/mcp-connect.mjs
   Options :    --email vous@exemple.fr   (sinon demandé)
                --from-clipboard          jeton déjà copié depuis l'app
                                          (console : copy(localStorage.getItem('ks_jwt')))
                                          → OBLIGATOIRE pour le compte ADMIN : ses
                                          données vivent sous le tenant « default »,
                                          qu'un jeton de licence MAX ne voit pas.
                --name keystone           (nom du connecteur, défaut keystone)
                --api  https://…          (défaut : Worker de prod)
   Retirer :    claude mcp remove keystone
   ═══════════════════════════════════════════════════════════════ */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv } from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

/* `claude` n'est pas toujours dans le PATH du terminal (installé dans ~/.local/bin) :
   on le cherche là où Claude Code s'installe, avant d'abandonner. */
const CLAUDE = (() => {
  const inPath = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (inPath.status === 0) return 'claude';
  for (const p of [`${homedir()}/.local/bin/claude`, '/usr/local/bin/claude', '/opt/homebrew/bin/claude']) if (existsSync(p)) return p;
  return null;
})();

const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const API  = arg('--api', 'https://keystone-os-api.keystone-os.workers.dev');
const NAME = arg('--name', 'keystone');
const rl = createInterface({ input: stdin, output: stdout });
const say = (s) => console.log(s);
const die = (s) => { console.error('\n✗ ' + s); process.exit(1); };

async function post(path, body) {
  let res, data = {};
  try {
    res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) { die(`Impossible de joindre ${API} (${e.message}). Réseau ? Adresse ?`); }
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

say('\nKeystone OS → Claude Code · connexion du serveur MCP');
say('─'.repeat(56));

/* 0 · Claude Code présent ? */
if (!CLAUDE) die('Claude Code est introuvable (ni dans le PATH, ni dans ~/.local/bin). Installe-le ou ajoute-le au PATH.');
const v = spawnSync(CLAUDE, ['--version'], { encoding: 'utf8' });
if (v.status !== 0) die('`claude --version` échoue : ' + (v.stderr || '').trim());
say(`✓ Claude Code ${v.stdout.trim()}`);

/* 1 · jeton déjà en main (presse-papiers) ? */
let jwt = null;
if (argv.includes('--from-clipboard')) {
  const pb = spawnSync('pbpaste', [], { encoding: 'utf8' });
  const t = (pb.stdout || '').trim();
  if (t.split('.').length !== 3) die('Le presse-papiers ne contient pas un jeton (3 segments séparés par des points). Dans l’app : copy(localStorage.getItem(\'ks_jwt\'))');
  const p = r2plan(t, true);
  if (!p || !p.exp) die('Jeton illisible.');
  if (p.exp * 1000 < Date.now()) die('Ce jeton est expiré : reconnecte-toi dans l’app puis recopie-le.');
  jwt = t;
  say(`✓ Jeton lu depuis le presse-papiers (plan ${p.plan || '?'}${p.isAdmin ? ', admin' : ''}), expire le ${new Date(p.exp * 1000).toLocaleString('fr-FR')}.`);
  rl.close();
} else {
/* 1 · e-mail */
const email = (arg('--email') || await rl.question('E-mail de ton compte Keystone : ')).trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die('E-mail invalide.');

/* 2 · demande du code */
const r1 = await post('/api/auth/request-magic-link', { email });
if (r1.status !== 200) die(`Demande de code refusée (${r1.status}) : ${r1.data.error || 'sans détail'}`);
say(`✓ Code demandé. Regarde ta boîte ${email} (et les indésirables).`);
say('  Si rien n’arrive : cet e-mail n’est rattaché à aucune licence — c’est celui avec lequel tu te connectes à l’app.');

/* 3 · échange du code */
for (let essai = 1; essai <= 3 && !jwt; essai++) {
  const code = (await rl.question('Code reçu par e-mail : ')).replace(/\s+/g, '');
  if (!code) continue;
  const r2 = await post('/api/auth/consume-otp', { email, code });
  if (r2.status === 200 && r2.data.jwt) { jwt = r2.data.jwt; break; }
  say(`  ✗ ${r2.data.error || 'Code refusé'} (${r2.status})`);
  if (r2.status === 423) die('Trop de tentatives : relance le script pour un nouveau code.');
}
rl.close();
if (!jwt) die('Pas de jeton obtenu.');
say(`✓ Jeton obtenu (plan ${r2plan(jwt)}), valable 7 jours — jamais affiché.`);
}

/* 4 · enregistrement dans Claude Code (remplace un éventuel ancien) */
spawnSync(CLAUDE, ['mcp', 'remove', '--scope', 'user', NAME], { encoding: 'utf8' });
const add = spawnSync(CLAUDE, ['mcp', 'add', '--scope', 'user', '--transport', 'http', NAME, `${API}/mcp`, '--header', `Authorization: Bearer ${jwt}`], { encoding: 'utf8' });
if (add.status !== 0) die(`claude mcp add a échoué :\n${(add.stderr || add.stdout || '').trim()}`);
say(`✓ Connecteur « ${NAME} » enregistré dans Claude Code.`);

/* 5 · preuve : le serveur répond avec ce jeton */
const ping = await fetch(`${API}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }).then(r => r.json()).catch(e => ({ error: e.message }));
const n = ping && ping.result && Array.isArray(ping.result.tools) ? ping.result.tools.length : 0;
if (!n) die(`Le serveur MCP ne répond pas avec ce jeton : ${JSON.stringify(ping).slice(0, 200)}`);
say(`✓ Le serveur MCP expose ${n} outils pour ce compte.`);
say('\nC’est branché. Ouvre une session `claude` et demande par exemple : « où en sont mes scans cette semaine ? »');
say('Quand le jeton expire : relance simplement ce script.\n');

function r2plan(t, full = false) { try { const p = JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); return full ? p : (p.plan || '?'); } catch (_) { return full ? null : '?'; } }
