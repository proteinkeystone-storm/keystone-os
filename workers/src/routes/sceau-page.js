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
    "img-src 'self' data: blob:",
    "media-src blob:",
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
<title>Missive</title>
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
    width:100%; max-width:460px; position:relative; background:
      radial-gradient(120% 90% at 50% 0%, rgba(108,108,245,.10) 0%, transparent 55%), var(--panel);
    border:1px solid var(--line); border-radius:24px; padding:42px 34px 34px;
    box-shadow:0 40px 100px rgba(0,0,0,.55); text-align:center;
  }
  .seal{
    width:92px; height:92px; margin:0 auto 24px; border-radius:50%;
    background:linear-gradient(140deg,#8a8aff,#4f46e5); display:flex; align-items:center; justify-content:center;
    box-shadow:0 12px 36px rgba(108,108,245,.5), inset 0 2px 10px rgba(255,255,255,.3);
    position:relative; transition:transform .5s ease;
  }
  .seal::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:1px solid rgba(108,108,245,.25)}
  .seal svg{width:48px;height:48px;fill:#fff;stroke:none}
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
  .secret-wrap{position:relative;text-align:left}
  .secret{
    text-align:left; white-space:pre-wrap; word-break:break-word; background:#0d1320; border:1px solid var(--line);
    border-radius:14px; padding:18px 52px 18px 18px; font:500 15px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--ink);
    max-height:50vh; overflow:auto;
  }
  .copy-icon{position:absolute;top:10px;right:10px;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;
    background:#1b2335;color:var(--muted);border:1px solid var(--line);border-radius:10px;cursor:pointer;transition:color .15s,border-color .15s,background .15s;padding:0}
  .copy-icon:hover{color:var(--ink);border-color:var(--accent)}
  .copy-icon.ok{color:var(--ok);border-color:var(--ok)}
  .secret-audio{width:100%;margin-top:4px}
  .secret-img{max-width:100%;max-height:42vh;border-radius:14px;border:1px solid var(--line);margin-bottom:12px;display:block}
  .dl-btn{display:block;width:100%;margin-top:16px;padding:14px 16px;border-radius:14px;text-decoration:none;text-align:center;
    background:var(--accent);color:#fff;font:700 16px -apple-system,sans-serif;letter-spacing:-0.01em;transition:filter .15s}
  .dl-btn:hover{filter:brightness(1.08)}
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
      <svg viewBox="0 0 800 800"><g transform="translate(-120.0,-121.8) scale(1.3)"><path d="M344.9,229.5c-21.7,7-43.3,14.6-64.6,22.8c-4,1.5-6.9,5.5-7.5,10.4c-12.6,110.6,16.5,191.2,51.3,244.4 c14.7,22.7,32.3,42.7,52.1,59.4c7.9,6.5,14.9,11.2,20.3,14.2c2.7,1.5,5,2.5,6.7,3.1c0.7,0.3,1.5,0.5,2.3,0.7 c0.8-0.1,1.5-0.4,2.3-0.7c1.7-0.6,4-1.6,6.7-3.1c5.5-3,12.5-7.7,20.3-14.2c19.8-16.6,37.4-36.7,52.1-59.4 c34.8-53.1,64-133.8,51.3-244.4c-0.6-4.8-3.5-8.9-7.5-10.4c-14.8-5.7-39.9-14.9-64.6-22.7c-25.3-8-48.6-13.9-60.7-13.9 C393.5,215.6,370.2,221.5,344.9,229.5L344.9,229.5z M338.8,202.1c24.7-7.8,51-14.9,66.7-14.9s42,7,66.7,14.9 c25.3,8,50.8,17.4,65.8,23.1c12.8,4.9,22,18,23.8,33.6c13.6,119.1-17.9,207.3-56.2,265.7c-16.2,25-35.5,47-57.4,65.2 c-7.5,6.3-15.5,11.9-23.9,16.6c-6.4,3.5-13.2,6.4-18.9,6.4s-12.5-2.9-18.9-6.4c-8.4-4.7-16.3-10.3-23.9-16.6 c-21.8-18.3-41.1-40.3-57.4-65.2c-38.2-58.4-69.8-146.6-56.2-265.7c1.8-15.6,11-28.6,23.8-33.6 C294.8,216.9,316.7,209.2,338.8,202.1z"/><path d="M493.8,315.6c5.7,5.7,5.7,14.9,0,20.6c0,0,0,0,0,0l-87.5,87.5c-5.7,5.7-14.9,5.7-20.6,0c0,0,0,0,0,0L341.9,380 c-5.7-5.7-5.7-14.9,0-20.6s14.9-5.7,20.6,0l33.4,33.4l77.2-77.2C478.8,309.9,488,309.9,493.8,315.6 C493.8,315.6,493.8,315.6,493.8,315.6z"/><path d="M328,533.5c-22.8-11.6-36.7-32.4-38.7-51.9C278.4,377.5,104,370.3,11.7,269.3l0,0C21.1,401.9,166.9,396,255.1,459.4 c-56.4-22-147.3-13.4-214.8-53.8c34.4,98.8,142.9,61.9,224.4,86.1c-48.1-2.9-110.4,26.5-171,7.2c55.8,81.3,122.3,23.2,188.7,21.3 c-33.2,9.7-66.4,48.3-112.7,46.5c58.3,52.1,85.9-1.5,125.5-23.2c-3.9,5-6.2,11.3-6.3,18.1c-0.1,16.5,13.1,29.9,29.6,30 c16.5,0.1,29.9-13.1,30-29.6C348.7,548.7,340,537.4,328,533.5L328,533.5z"/><path d="M472,533.5c-12,3.9-20.7,15.3-20.6,28.6c0.1,16.5,13.6,29.7,30,29.6c16.5-0.1,29.7-13.6,29.6-30 c-0.1-6.8-2.4-13.1-6.3-18.1c39.6,21.6,67.2,75.3,125.5,23.2c-46.3,1.8-79.6-36.8-112.7-46.5c66.4,1.9,132.9,60,188.7-21.3 c-60.6,19.2-122.9-10.1-171-7.2c81.5-24.2,190,12.7,224.4-86.1c-67.5,40.4-158.3,31.7-214.8,53.8c88.3-63.4,234-57.5,243.4-190.1 l0,0c-92.3,101-266.7,108.2-277.5,212.3C508.7,501.1,494.9,521.9,472,533.5L472,533.5z"/></g></svg>
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
    // Normalisation de la réponse (mode question/réponse) — DOIT être IDENTIQUE
    // côté création (app/sceau.js _normAnswer), sinon l'OPRF diverge.
    const normAnswer = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    async function aesKey(output){
      const ikm = await crypto.subtle.importKey('raw', output, 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name:'HKDF', hash:'SHA-256', salt:HKDF_SALT, info:HKDF_INFO },
        ikm, { name:'AES-GCM', length:256 }, false, ['decrypt']);
    }

    function dead(msg){
      seal.classList.add('cracked');
      $('<h1>Missive introuvable</h1><p>'+msg+'</p>');
    }
    function notFound(){ $('<h1>Missive introuvable</h1><p>Ce lien ne correspond à aucune missive.</p>'); }
    function tokenEmpty(){ $('<h1>Aucun message</h1><p>Cette missive n’a pas de message actif pour le moment.</p>'); }

    function renderForm(attemptsLeft, oprfPub, question){
      const qa = !!question;
      $(
        '<h1>Missive scellée</h1>'+
        (qa
          ? '<p>Un message vous attend. Répondez à la question pour l’ouvrir.</p>'+
            '<div class="field"><label for="pw">'+esc(question)+'</label>'+
            '<input id="pw" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" placeholder="Votre réponse"></div>'
          : '<p>Un message vous attend. Entrez le code reçu pour l’ouvrir.</p>'+
            '<div class="field"><label for="pw">Code de déverrouillage</label>'+
            '<input id="pw" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" placeholder="••••••••"></div>')+
        '<button id="go">Ouvrir le sceau</button>'+
        '<div class="attempts" id="att">'+attemptsLeft+' essai'+(attemptsLeft>1?'s':'')+' restant'+(attemptsLeft>1?'s':'')+'</div>'+
        '<div class="foot">Chiffré de bout en bout : votre code n’est jamais transmis, et même nous ne pouvons pas lire ce message. '+
        'Au-delà des essais autorisés, la missive s’autodétruit définitivement.<br>'+
        'Limite honnête : cette page est servie par notre serveur — la sécurité maximale suppose de nous faire confiance pour le code de cette page.</div>'
      );
      const pw = document.getElementById('pw'), go = document.getElementById('go'), att = document.getElementById('att');
      pw.focus();
      const attempt = async () => {
        const code = pw.value;
        if(!code){ pw.focus(); return; }
        // En mode question/réponse, l'entrée OPRF est la réponse NORMALISÉE
        // (casse/accents/espaces ignorés) — identique à la création.
        const oprfInput = qa ? normAnswer(code) : code;
        if(qa && !oprfInput){ pw.focus(); return; }
        go.disabled = true; go.textContent = 'Ouverture…';
        try{
          const client = new SceauVOPRF.VOPRFClient(SceauVOPRF.Oprf.Suite.P256_SHA256, b64d(oprfPub));
          const [fin, ereq] = await client.blind([enc.encode(oprfInput)]);
          // 1) blob (opaque, inoffensif) AVANT l'eval (cas one-shot).
          const blobRes = await fetch(BASE+'/blob', { cache:'no-store' });
          if(blobRes.status===410){ return dead('Cette missive s’est déjà autodétruite.'); }
          if(!blobRes.ok){ return dead('Cette missive n’est plus disponible.'); }
          const blob = await blobRes.json();
          // 2) eval OPRF (COMPTÉE côté serveur).
          const evRes = await fetch(BASE+'/eval', {
            method:'POST', cache:'no-store', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ blinded: btoa(String.fromCharCode(...ereq.serialize())) })
          });
          if(evRes.status===410){ return dead('Cette missive s’est autodétruite (essais épuisés).'); }
          const ev = await evRes.json();
          if(!evRes.ok || !ev.evaluation){ throw new Error('eval'); }
          const [output] = await client.finalize(fin, SceauVOPRF.Evaluation.deserialize(SceauVOPRF.Oprf.Suite.P256_SHA256, b64d(ev.evaluation)));
          const key = await aesKey(output);
          let buf;
          try{
            buf = await crypto.subtle.decrypt({ name:'AES-GCM', iv:b64d(blob.iv) }, key, b64d(blob.ciphertext));
          }catch{
            // Mauvais code : le tag AES-GCM rejette. L'essai a été compté.
            const left = (ev.attempts_left ?? 0);
            const wrong = qa ? 'Réponse incorrecte' : 'Code incorrect';
            if(left<=0){ return dead(wrong+'. La missive s’est autodétruite.'); }
            att.className = 'attempts warn';
            att.textContent = wrong+' — '+left+' essai'+(left>1?'s':'')+' restant'+(left>1?'s':'');
            pw.value=''; pw.focus(); go.disabled=false; go.textContent='Ouvrir le sceau';
            return;
          }
          // Accusé de lecture (S5) — best-effort, esprit Snap : informe le créateur
          // que le sceau a été ouvert, et consomme le secret (lu une fois).
          fetch(BASE+'/opened', { method:'POST', cache:'no-store' }).catch(()=>{});
          if(blob.kind==='audio'){ revealAudio(URL.createObjectURL(new Blob([buf], { type: blob.mime || 'audio/webm' }))); }
          else if(blob.kind==='file'){ revealFile(unpackFile(buf), blob.mime); }
          else { reveal(dec.decode(buf)); }
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
      const copySvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      const checkSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(()=>{
        $(
          '<h1>Missive ouverte</h1>'+
          '<p>Lisez maintenant — ce message ne se rouvrira pas.</p>'+
          '<div class="secret-wrap"><div class="secret" id="sec"></div>'+
          '<button class="copy-icon" id="cp" title="Copier" aria-label="Copier">'+copySvg+'</button></div>'+
          '<div class="foot">Une fois cette page fermée, le message n’est plus accessible par ce lien.</div>'
        );
        document.getElementById('sec').textContent = plain; // textContent : zéro injection
        const cp = document.getElementById('cp');
        cp.addEventListener('click', async ()=>{ try{ await navigator.clipboard.writeText(plain); cp.innerHTML=checkSvg; cp.classList.add('ok'); setTimeout(()=>{cp.innerHTML=copySvg;cp.classList.remove('ok');},1500); }catch{ cp.title='Copie indisponible'; } });
      }, 650);
    }

    function revealAudio(url){
      seal.classList.add('cracked');
      setTimeout(()=>{
        $(
          '<h1>Missive ouverte</h1>'+
          '<p>Écoutez maintenant — ce message ne se rejouera pas après fermeture.</p>'+
          '<audio class="secret-audio" controls autoplay src="'+url+'"></audio>'+
          '<div class="foot">Une fois cette page fermée, le message n’est plus accessible par ce lien.</div>'
        );
      }, 650);
    }

    // Dépaquetage symétrique de _packFile (app/sceau.js) :
    // [4 octets longueur LE][JSON {name,type}][octets fichier]. Le nom vit DANS le chiffré.
    function unpackFile(buf){
      const u8 = new Uint8Array(buf);
      const n = new DataView(u8.buffer, u8.byteOffset, 4).getUint32(0, true);
      let meta = {}; try{ meta = JSON.parse(dec.decode(u8.subarray(4, 4+n))); }catch{}
      return { name: meta.name || 'fichier', type: meta.type || '', bytes: u8.subarray(4+n) };
    }

    function revealFile(f, mime){
      seal.classList.add('cracked');
      const type = mime || f.type || 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([f.bytes], { type }));
      // On tente l'aperçu pour TOUTE image. Certains formats (HEIC/HEIF des
      // iPhone) ne sont pas décodables par le navigateur → onerror masque
      // l'aperçu et laisse le téléchargement comme repli propre.
      const isImg = /^image\//.test(type);
      setTimeout(()=>{
        $(
          '<h1>Missive ouverte</h1>'+
          '<p>Téléchargez maintenant — ce fichier ne se rouvrira pas après fermeture.</p>'+
          (isImg ? '<img class="secret-img" id="img" alt="">' : '')+
          '<div class="secret" id="fname"></div>'+
          '<div class="foot hidden" id="noprev">Aperçu indisponible pour ce format — utilisez Télécharger.</div>'+
          '<a class="dl-btn" id="dl" download>Télécharger le fichier</a>'+
          '<div class="foot">Une fois cette page fermée, le fichier n’est plus accessible par ce lien.</div>'
        );
        document.getElementById('fname').textContent = f.name; // textContent : zéro injection
        const dl = document.getElementById('dl');
        dl.href = url; dl.setAttribute('download', f.name);
        if(isImg){
          const img = document.getElementById('img');
          img.addEventListener('error', ()=>{ img.classList.add('hidden'); document.getElementById('noprev').classList.remove('hidden'); });
          img.src = url;
        }
      }, 650);
    }

    (async function init(){
      try{
        const r = await fetch(BASE+'/meta', { cache:'no-store' });
        if(r.status===404){ const j=await r.json().catch(()=>({})); return j.status==='vide'?tokenEmpty():notFound(); }
        if(r.status===410){ return dead('Cette missive s’est autodétruite ou a expiré.'); }
        if(!r.ok){ return dead('Cette missive n’est pas disponible.'); }
        const m = await r.json();
        renderForm(m.attempts_left, m.oprf_pub, m.question);
      }catch{ dead('Connexion impossible.'); }
    })();
  </script>
</body>
</html>`;
}
