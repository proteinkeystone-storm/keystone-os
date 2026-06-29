/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — SCEAU · Page de lecture publique (Pad O-SEC-001 · S2)

   GET /s/:id            page HTML autoportée (servie par le Worker, MÊME
                         origine que /s/:id/{meta,eval,blob} → zéro CORS).
   GET /s-assets/voprf-<ver>.js   bundle voprf-ts auto-hébergé (SRI), immutable.

   Le déchiffrement se fait DANS la page (E2E) : la passphrase est aveuglée
   avant tout envoi, la clé AES dérivée côté client, le serveur reste aveugle.

   Durcissement : CSP stricte (default 'none', nonce sur inline), bundle crypto
   épinglé en Subresource Integrity, no-store, no-referrer. Limite STRUCTURELLE
   du E2E web (le serveur sert le code) affichée honnêtement dans la page.
   ═══════════════════════════════════════════════════════════════ */

import { VOPRF_BUNDLE_B64, VOPRF_BUNDLE_SRI, VOPRF_BUNDLE_VERSION } from './_sceau-voprf.js';

const _bundleBytes = (() => {
  const bin = atob(VOPRF_BUNDLE_B64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
})();

// GET /s-assets/voprf-<ver>.js — bundle crypto auto-hébergé.
export function handleSceauAsset(path) {
  if (path === `/s-assets/voprf-${VOPRF_BUNDLE_VERSION}.js`) {
    return new Response(_bundleBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',          // requis pour le SRI (crossorigin)
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  return new Response('Not Found', { status: 404 });
}

function _esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// GET /s/:id — page de réclamation d'un secret direct.
export function handleSceauPage(request, env, shortId) {
  return _serve(`/s/${_esc(shortId)}`);
}
// GET /s/t/:tid — page de réclamation via un jeton réutilisable (pointeur stable).
export function handleSceauTokenPage(request, env, tid) {
  return _serve(`/s/t/${_esc(tid)}`);
}

function _serve(base) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const bundleHref = `/s-assets/voprf-${VOPRF_BUNDLE_VERSION}.js`;

  const csp = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  const html = _page(base, nonce, bundleHref, VOPRF_BUNDLE_SRI);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  });
}

function _page(base, nonce, bundleHref, sri) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Sceau</title>
<style nonce="${nonce}">
  :root{
    --bg:#0b0e14; --panel:#121826; --ink:#eef2f8; --muted:#8a94a6;
    --line:#222b3d; --accent:#6c6cf5; --ok:#34d399; --warn:#f59e0b; --dead:#ef4444;
    --radius:20px;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{
    background:radial-gradient(1200px 600px at 50% -10%, #161d2e 0%, var(--bg) 60%);
    color:var(--ink); font:400 16px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;
    letter-spacing:-0.01em; display:flex; align-items:center; justify-content:center; padding:24px;
  }
  .card{
    width:100%; max-width:440px; background:var(--panel); border:1px solid var(--line);
    border-radius:var(--radius); padding:32px 28px; box-shadow:0 30px 80px rgba(0,0,0,.5);
    text-align:center;
  }
  .seal{
    width:84px; height:84px; margin:0 auto 22px; border-radius:50%;
    background:linear-gradient(135deg,#7b7bff,#4f46e5); display:flex; align-items:center; justify-content:center;
    box-shadow:0 8px 30px rgba(108,108,245,.45), inset 0 2px 8px rgba(255,255,255,.25);
    position:relative; transition:transform .5s ease;
  }
  .seal svg{width:40px;height:40px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .seal.cracked{animation:crack .7s ease forwards}
  @keyframes crack{40%{transform:scale(1.08) rotate(-3deg)}100%{transform:scale(.2) rotate(12deg);opacity:0}}
  h1{font:900 24px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif; letter-spacing:-0.03em; margin:0 0 8px}
  p{color:var(--muted); margin:0 0 22px; font-size:14.5px}
  .field{display:flex;flex-direction:column;gap:10px;text-align:left}
  label{font-size:13px;color:var(--muted)}
  input{
    width:100%; padding:14px 16px; border-radius:14px; border:1px solid var(--line);
    background:#0d1320; color:var(--ink); font-size:16px; outline:none; transition:border-color .15s;
  }
  input:focus{border-color:var(--accent)}
  button{
    width:100%; margin-top:16px; padding:14px 16px; border:0; border-radius:14px; cursor:pointer;
    background:var(--accent); color:#fff; font:700 16px -apple-system,sans-serif; letter-spacing:-0.01em;
    transition:filter .15s, opacity .15s;
  }
  button:hover{filter:brightness(1.08)} button:disabled{opacity:.5;cursor:default}
  .hint{margin-top:14px;font-size:12.5px;color:var(--muted)}
  .attempts{font-size:13px;margin-top:12px}
  .attempts.warn{color:var(--warn)} .err{color:var(--dead)}
  .secret{
    text-align:left; white-space:pre-wrap; word-break:break-word; background:#0d1320; border:1px solid var(--line);
    border-radius:14px; padding:16px; font:500 15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--ink);
    max-height:50vh; overflow:auto;
  }
  .copy{margin-top:12px;background:#1b2335;color:var(--ink);border:1px solid var(--line)}
  .foot{margin-top:22px;font-size:11.5px;color:#5a6478;line-height:1.5}
  .foot a{color:#7e88a0}
  .hidden{display:none}
  .spin{width:26px;height:26px;border:3px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:sp .8s linear infinite;margin:8px auto}
  @keyframes sp{to{transform:rotate(360deg)}}
</style>
</head>
<body>
  <main class="card" id="card" aria-live="polite">
    <div class="seal" id="seal" aria-hidden="true">
      <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
    </div>
    <div id="view"><div class="spin"></div><p>Ouverture…</p></div>
  </main>

  <script src="${bundleHref}" integrity="${sri}" crossorigin="anonymous" nonce="${nonce}"></script>
  <script type="module" nonce="${nonce}">
    const BASE = "${base}";  // "/s/<id>" (secret direct) ou "/s/t/<tid>" (jeton réutilisable)
    const enc = new TextEncoder(), dec = new TextDecoder();
    const $ = (h) => { document.getElementById('view').innerHTML = h; };
    const seal = document.getElementById('seal');
    const b64d = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

    // Paramètres E2E CANONIQUES — DOIVENT être identiques côté création (S3).
    const HKDF_SALT = enc.encode('sceau/v1');
    const HKDF_INFO = enc.encode('aes-gcm-256');

    async function aesKey(output){
      const ikm = await crypto.subtle.importKey('raw', output, 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name:'HKDF', hash:'SHA-256', salt:HKDF_SALT, info:HKDF_INFO },
        ikm, { name:'AES-GCM', length:256 }, false, ['decrypt']);
    }

    function dead(msg){
      seal.classList.add('cracked');
      $('<h1>Sceau introuvable</h1><p>'+msg+'</p>');
    }
    function notFound(){ $('<h1>Sceau introuvable</h1><p>Ce lien ne correspond à aucun sceau.</p>'); }
    function tokenEmpty(){ $('<h1>Aucun message</h1><p>Ce sceau n’a pas de message actif pour le moment.</p>'); }

    function renderForm(attemptsLeft, oprfPub){
      $(
        '<h1>Sceau scellé</h1>'+
        '<p>Un message vous attend. Entrez le code reçu pour l’ouvrir.</p>'+
        '<div class="field"><label for="pw">Code de déverrouillage</label>'+
        '<input id="pw" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" placeholder="••••••••"></div>'+
        '<button id="go">Ouvrir le sceau</button>'+
        '<div class="attempts" id="att">'+attemptsLeft+' essai'+(attemptsLeft>1?'s':'')+' restant'+(attemptsLeft>1?'s':'')+'</div>'+
        '<div class="foot">Chiffré de bout en bout : votre code n’est jamais transmis, et même nous ne pouvons pas lire ce message. '+
        'Au-delà des essais autorisés, le sceau s’autodétruit définitivement.<br>'+
        'Limite honnête : cette page est servie par notre serveur — la sécurité maximale suppose de nous faire confiance pour le code de cette page.</div>'
      );
      const pw = document.getElementById('pw'), go = document.getElementById('go'), att = document.getElementById('att');
      pw.focus();
      const attempt = async () => {
        const code = pw.value;
        if(!code){ pw.focus(); return; }
        go.disabled = true; go.textContent = 'Ouverture…';
        try{
          const client = new SceauVOPRF.VOPRFClient(SceauVOPRF.Oprf.Suite.P256_SHA256, b64d(oprfPub));
          const [fin, ereq] = await client.blind([enc.encode(code)]);
          // 1) blob (opaque, inoffensif) AVANT l'eval (cas one-shot).
          const blobRes = await fetch(BASE+'/blob', { cache:'no-store' });
          if(blobRes.status===410){ return dead('Ce sceau s’est déjà autodétruit.'); }
          if(!blobRes.ok){ return dead('Ce sceau n’est plus disponible.'); }
          const blob = await blobRes.json();
          // 2) eval OPRF (COMPTÉE côté serveur).
          const evRes = await fetch(BASE+'/eval', {
            method:'POST', cache:'no-store', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ blinded: btoa(String.fromCharCode(...ereq.serialize())) })
          });
          if(evRes.status===410){ return dead('Ce sceau s’est autodétruit (essais épuisés).'); }
          const ev = await evRes.json();
          if(!evRes.ok || !ev.evaluation){ throw new Error('eval'); }
          const [output] = await client.finalize(fin, SceauVOPRF.Evaluation.deserialize(SceauVOPRF.Oprf.Suite.P256_SHA256, b64d(ev.evaluation)));
          const key = await aesKey(output);
          let plain;
          try{
            const buf = await crypto.subtle.decrypt({ name:'AES-GCM', iv:b64d(blob.iv) }, key, b64d(blob.ciphertext));
            plain = dec.decode(buf);
          }catch{
            // Mauvais code : le tag AES-GCM rejette. L'essai a été compté.
            const left = (ev.attempts_left ?? 0);
            if(left<=0){ return dead('Code incorrect. Le sceau s’est autodétruit.'); }
            att.className = 'attempts warn';
            att.textContent = 'Code incorrect — '+left+' essai'+(left>1?'s':'')+' restant'+(left>1?'s':'');
            pw.value=''; pw.focus(); go.disabled=false; go.textContent='Ouvrir le sceau';
            return;
          }
          // Accusé de lecture (S5) — best-effort, esprit Snap : informe le créateur
          // que le sceau a été ouvert, et consomme le secret (lu une fois).
          fetch(BASE+'/opened', { method:'POST', cache:'no-store' }).catch(()=>{});
          reveal(plain);
        }catch(e){
          go.disabled=false; go.textContent='Ouvrir le sceau';
          att.className='attempts err'; att.textContent='Une erreur est survenue. Réessayez.';
        }
      };
      go.addEventListener('click', attempt);
      pw.addEventListener('keydown', (e)=>{ if(e.key==='Enter') attempt(); });
    }

    function reveal(plain){
      seal.classList.add('cracked');
      setTimeout(()=>{
        $(
          '<h1>Sceau ouvert</h1>'+
          '<p>Lisez maintenant — ce message ne se rouvrira pas.</p>'+
          '<div class="secret" id="sec"></div>'+
          '<button class="copy" id="cp">Copier</button>'+
          '<div class="foot">Une fois cette page fermée, le message n’est plus accessible par ce lien.</div>'
        );
        document.getElementById('sec').textContent = plain; // textContent : zéro injection
        const cp = document.getElementById('cp');
        cp.addEventListener('click', async ()=>{ try{ await navigator.clipboard.writeText(plain); cp.textContent='Copié'; }catch{ cp.textContent='Copie indisponible'; } });
      }, 650);
    }

    (async function init(){
      try{
        const r = await fetch(BASE+'/meta', { cache:'no-store' });
        if(r.status===404){ const j=await r.json().catch(()=>({})); return j.status==='vide'?tokenEmpty():notFound(); }
        if(r.status===410){ return dead('Ce sceau s’est autodétruit ou a expiré.'); }
        if(!r.ok){ return dead('Ce sceau n’est pas disponible.'); }
        const m = await r.json();
        renderForm(m.attempts_left, m.oprf_pub);
      }catch{ dead('Connexion impossible.'); }
    })();
  </script>
</body>
</html>`;
}
