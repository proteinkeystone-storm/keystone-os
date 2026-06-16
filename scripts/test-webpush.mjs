// Vérifie le chiffrement Web Push (webpush.js) contre le vecteur de test
// officiel RFC 8291 §5 : entrées fixes → corps chiffré attendu, au bit près.
//   node scripts/test-webpush.mjs
import { encryptPayload } from '../workers/src/lib/webpush.js';

const enc = new TextEncoder();
function b64url(u) { let b = ''; for (const x of u) b += String.fromCharCode(x); return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

const sub = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth:   'BTBZMqHH6r4Tts7J_aSIgg',
};
const opts = {
  asPrivateD:  'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublicB64: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  saltB64:     'DGv6ra1nlYgDCS1FRnbzlw',
};
const want = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';

const body = await encryptPayload(enc.encode('When I grow up, I want to be a watermelon'), sub, opts);
const got = b64url(body);
const ok = got === want;
console.log(ok ? '✓ RFC 8291 §5 — chiffrement CONFORME' : '✗ MISMATCH');
if (!ok) { console.log('got :', got); console.log('want:', want); process.exit(1); }
