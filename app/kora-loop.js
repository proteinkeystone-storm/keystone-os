/* ═══════════════════════════════════════════════════════════════
   KORA — la boucle conversationnelle (V1 : écrit, LECTURE seule)
   ─────────────────────────────────────────────────────────────
   Orchestration côté client (les actions du catalogue lisent le
   localStorage de CE navigateur) :
     toi → phase 'decide' (worker) → soit réponse directe,
     soit action de lecture → runKoraAction (kora-actions.js) avec
     ANNEAU sur la cible → phase 'answer' (worker, streaming SSE).
   Le galet raconte l'état : réflexion pendant la décision, travail
   pendant lecture + réponse, repos à la fin.
   Historique de SESSION uniquement, plafonné (décision §14).
   Isolation kora_ ; chargé par kora.js, jamais ailleurs.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

import { KORA_ACTIONS, koraAction, runKoraAction } from './kora-actions.js';
import { koraSay, koraState, koraRing, koraClearRings } from './kora.js';
import { icon } from './lib/ui-icons.js';

const KORA_API = (typeof window !== 'undefined' && window.__KS_API_BASE__) ||
  'https://keystone-os-api.keystone-os.workers.dev';

const MAX_HISTORY = 16;
let _history = [];          // session seulement — rien de persistant
let _busy = false;
let _input = null, _sendBtn = null;

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function _jwt() { try { return localStorage.getItem('ks_jwt') || ''; } catch (e) { return ''; } }
function _push(role, content) {
  _history.push({ role, content });
  if (_history.length > MAX_HISTORY) _history = _history.slice(-MAX_HISTORY);
}
/* défs compactes du catalogue scopé — V1 : tout le catalogue lecture */
function _actionDefs() {
  return KORA_ACTIONS.map(a => ({
    id: a.id, label: a.label, desc: a.desc,
    params: (a.params || []).map(p => ({ name: p.name, type: p.type, required: !!p.required })),
  }));
}
function _setBusy(b) {
  _busy = b;
  if (_input)  _input.disabled = b;
  if (_sendBtn) _sendBtn.disabled = b;
  if (!b && _input) _input.focus();
}

async function _send(text) {
  if (_busy) return;
  const token = _jwt();
  if (!token) {
    koraSay('Je ne te reconnais pas — connecte-toi à Keystone puis reviens me voir.');
    return;
  }
  _setBusy(true);
  const userLine = koraSay(_esc(text));
  if (userLine) userLine.classList.add('kora-user');
  _push('user', text);
  koraState('reflexion');

  try {
    /* ── phase 1 : décision ── */
    const res = await fetch(`${KORA_API}/api/kora/chat`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body   : JSON.stringify({ phase: 'decide', pad: 'dashboard',
                                messages: _history, actions: _actionDefs() }),
    });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      koraSay(_esc(j.error || 'Tes crédits IA du mois sont épuisés.'));
      return;
    }
    if (!res.ok) throw new Error(`décision ${res.status}`);
    const d = await res.json();

    if (d.type === 'reponse') {
      koraSay(_esc(d.text).replace(/\n/g, '<br>'));
      _push('assistant', d.text);
      return;
    }
    if (d.type !== 'action') throw new Error('réponse inattendue');

    /* ── phase 2 : lecture (anneau sur la cible) puis réponse streamée ── */
    const act = koraAction(d.id);
    if (!act) {
      koraSay('Je me suis emmêlée dans mes lectures — reformule, je réessaie.');
      _push('assistant', `(action inconnue demandée : ${d.id})`);
      return;
    }
    if (d.annonce) { koraSay(_esc(d.annonce)); _push('assistant', d.annonce); }
    koraState('travail');
    const ringed = act.target ? koraRing(act.target) : null;
    const result = await runKoraAction(d.id, d.args || {});
    if (ringed) koraClearRings();

    if (!result.ok) {
      koraSay('Je n’ai pas réussi cette lecture : ' + _esc(result.error));
      _push('assistant', `(lecture ${d.id} en échec : ${result.error})`);
      return;
    }

    const ans = await fetch(`${KORA_API}/api/kora/chat`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body   : JSON.stringify({ phase: 'answer', pad: 'dashboard', messages: _history,
                                action_id: d.id, action_result: result.data }),
    });
    if (!ans.ok || !ans.body) throw new Error(`réponse ${ans.status}`);

    /* streaming SSE → la ligne se remplit au fil de l'eau */
    const line = koraSay('');
    const reader = ans.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', fullText = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const l of lines) {
        if (!l.startsWith('data:')) continue;
        const payload = l.slice(5).trim();
        if (!payload) continue;
        try {
          const j = JSON.parse(payload);
          if (j.type === 'chunk' && j.text) {
            fullText += j.text;
            if (line) line.textContent = fullText;
          }
        } catch (e) { /* fragment incomplet */ }
      }
    }
    if (!fullText && line) line.textContent = 'Lecture faite — mais je n’ai rien su en dire. Réessaie ?';
    _push('assistant', fullText || '(réponse vide)');
  } catch (e) {
    koraSay('Petit souci de mon côté (' + _esc(e?.message || 'réseau') + '). Réessaie dans un instant.');
  } finally {
    koraClearRings();
    koraState('repos');
    _setBusy(false);
  }
}

/* ═══ Init — appelé par kora.js après création de la fenêtre ═══ */
export function initKoraLoop(panel) {
  if (!panel || panel.querySelector('.kora-inputbar')) return;
  const bar = document.createElement('div');
  bar.className = 'kora-inputbar';
  bar.innerHTML = `
    <input class="kora-input" type="text" maxlength="1000"
           placeholder="Demande-moi une lecture — « où en sont mes posts ? »" aria-label="Parler à Kora">
    <button class="kora-send" title="Envoyer" aria-label="Envoyer">${icon('send', 16)}</button>`;
  panel.appendChild(bar);
  _input = bar.querySelector('.kora-input');
  _sendBtn = bar.querySelector('.kora-send');

  const go = () => {
    const t = (_input.value || '').trim();
    if (!t) return;
    _input.value = '';
    _send(t);
  };
  _sendBtn.addEventListener('click', go);
  _input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}
