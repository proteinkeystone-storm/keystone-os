/* Teste la VRAIE action qr.prepare_url (pas une copie de sa logique). */
globalThis.localStorage={getItem:k=>k==='ks_jwt'?'j':null,setItem(){},removeItem(){}};
globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
globalThis.window={};
const { KORA_ACTIONS } = await import('../app/kora-actions.js');
const run = KORA_ACTIONS.find(a=>a.id==='qr.prepare_url').run;
const URLERR = /adresse web valide/;
let ok=0, ko=0;
const t=(n,c)=>{ c?(ok++,console.log('  \x1b[32m✓\x1b[0m '+n)):(ko++,console.error('  \x1b[31m✗\x1b[0m '+n)); };

/* ACCEPTÉES : ne doivent PAS échouer sur la validation d'URL.
   (elles échouent plus loin, sur le DOM absent — message différent) */
for (const good of ['protein-keystone.com','https://protein-keystone.com',
                    'http://exemple.fr/a','  protein-keystone.com  ','www.site.fr/x?a=1']) {
  let msg=''; try { await run({url:good}); } catch(e){ msg=String(e?.message||e); }
  t(`accepte ${JSON.stringify(good)}`, !URLERR.test(msg));
}
/* REJETÉES : doivent échouer sur la validation d'URL */
for (const bad of ['','   ','pas une url','ftp://x.com','localhost','javascript:alert(1)']) {
  let msg=''; try { await run({url:bad}); } catch(e){ msg=String(e?.message||e); }
  t(`rejette ${JSON.stringify(bad)}`, URLERR.test(msg));
}
console.log(`\n${ok+ko} cas — \x1b[32m${ok} ok\x1b[0m, ${ko} ko`);
process.exit(ko?1:0);
