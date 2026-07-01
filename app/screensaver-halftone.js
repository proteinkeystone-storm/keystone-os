// ═══════════════════════════════════════════════════════════════
// KEYSTONE — Écran de veille « Trame ondoyante » (halftone flow)
//   Trame de croix PLEIN ÉCRAN (grille régulière couvrant tout le
//   viewport), animée par une houle de bruit de Perlin (déplacement
//   réel de la grille) + morph point→croix + vague de lumière qui se
//   balade. Rendu canvas. Overlay heure/date/logo géré par
//   lockscreen.js (inchangé). Isolé, sans dépendance.
// ═══════════════════════════════════════════════════════════════

/* ── Bruit de valeur 3D (organique) ────────────────────────────── */
function makeNoise(seed){
  var pm=[]; for(var i=0;i<256;i++)pm[i]=i;
  var s=seed||1; function rr(){s=(s*1664525+1013904223)>>>0;return s/4294967296;}
  for(var i=255;i>0;i--){var j=(rr()*(i+1))|0,t=pm[i];pm[i]=pm[j];pm[j]=t;}
  var p=new Uint8Array(512); for(var i=0;i<512;i++)p[i]=pm[i&255];
  function fd(t){return t*t*t*(t*(t*6-15)+10);}
  function lp(a,b,t){return a+t*(b-a);}
  function gr(h,x,y,z){h&=15;var u=h<8?x:y,v=h<4?y:(h===12||h===14?x:z);return((h&1)?-u:u)+((h&2)?-v:v);}
  return function(x,y,z){var X=Math.floor(x)&255,Y=Math.floor(y)&255,Z=Math.floor(z)&255;x-=Math.floor(x);y-=Math.floor(y);z-=Math.floor(z);var u=fd(x),v=fd(y),w=fd(z);var A=p[X]+Y,AA=p[A]+Z,AB=p[A+1]+Z,B=p[X+1]+Y,BA=p[B]+Z,BB=p[B+1]+Z;return lp(lp(lp(gr(p[AA],x,y,z),gr(p[BA],x-1,y,z),u),lp(gr(p[AB],x,y-1,z),gr(p[BB],x-1,y-1,z),u),v),lp(lp(gr(p[AA+1],x,y,z-1),gr(p[BA+1],x-1,y,z-1),u),lp(gr(p[AB+1],x,y-1,z-1),gr(p[BB+1],x-1,y-1,z-1),u),v),w);};
}
function _sm(a,b,x){x=(x-a)/(b-a);if(x<0)x=0;if(x>1)x=1;return x*x*(3-2*x);}

const nWarp=makeNoise(21), nWave=makeNoise(99);

const CFG={
  spacing:24,        // pas de la grille (px CSS) — maille FINE = + de croix (pas de zoom)
  warpAmp:15, warpScale:0.0018, warpSpeed:0.14, warpEvolve:0.07,  // houle (déplacement réel)
  waveScale:0.0022, waveSpeed:0.05, waveDrift:0.45,               // vague de lumière (se balade)
  crossStart:0.52,   // seuil point→croix (contraste net)
  dotMin:1.0, dotAdd:1.3, armMax:6.2, armW:1.7,                   // éléments fins
  aFloor:0.24, aRange:0.76,   // plancher relevé → trame visible PARTOUT (fini le bas noir)
  colA:[80,140,215], colB:[150,60,250]  // point cyan → croix violette (charte)
};

let _raf=null, _onResize=null;

export function startHalftone(canvas, opts){
  stopHalftone();
  opts = opts || {};
  const reduce = !!opts.reduceMotion;
  const ctx=canvas.getContext('2d'), DPR=Math.min(window.devicePixelRatio||1,2);
  function resize(){
    const w=canvas.clientWidth||window.innerWidth, h=canvas.clientHeight||window.innerHeight;
    canvas.width=w*DPR; canvas.height=h*DPR;
  }
  _onResize=resize; window.addEventListener('resize', resize); resize();

  function render(t){
    const W=canvas.width, H=canvas.height;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='#05040a'; ctx.fillRect(0,0,W,H);
    ctx.globalCompositeOperation='lighter';
    ctx.lineCap='round';

    const sp=CFG.spacing*DPR;
    const cols=Math.ceil(W/sp)+2, rows=Math.ceil(H/sp)+2;
    const ws=CFG.warpScale, wsp=CFG.warpSpeed, we=CFG.warpEvolve, wa=CFG.warpAmp*DPR;
    const cA=CFG.colA, cB=CFG.colB;

    for(let gy=-1; gy<rows; gy++){
      for(let gx=-1; gx<cols; gx++){
        const bx=gx*sp, by=gy*sp;          // position écran (px)
        const wx=bx/DPR, wy=by/DPR;         // coords "monde" (px CSS) pour le bruit
        // houle : déplacement réel de la maille
        const f1=nWarp(wx*ws - t*wsp, wy*ws, t*we);
        const f2=nWarp(wx*ws+100, wy*ws - t*wsp, t*we);
        const dx=f1*wa, dy=f2*wa;
        // vague de lumière (indépendante) : intensité 0..1
        const raw=(nWave(wx*CFG.waveScale - t*CFG.waveDrift, wy*CFG.waveScale, t*CFG.waveSpeed)+1)*0.5;
        const b=_sm(0.2,0.9,raw);
        const alpha=CFG.aFloor+CFG.aRange*b, mix=b*b;
        const r=(cA[0]+(cB[0]-cA[0])*mix)|0, g=(cA[1]+(cB[1]-cA[1])*mix)|0, bl=(cA[2]+(cB[2]-cA[2])*mix)|0;
        const col='rgba('+r+','+g+','+bl+',';
        const px=bx+dx, py=by+dy;
        // point central (toujours) → jamais de trou noir
        const dr=(CFG.dotMin+CFG.dotAdd*b)*DPR;
        ctx.fillStyle=col+alpha.toFixed(3)+')';
        ctx.fillRect(px-dr/2, py-dr/2, dr, dr);
        // bras de croix au-dessus du seuil → morph net
        const at=_sm(CFG.crossStart,1,b);
        if(at>0.02){
          const arm=at*CFG.armMax*DPR;
          ctx.strokeStyle=col+(alpha*at).toFixed(3)+')';
          ctx.lineWidth=Math.max(1, CFG.armW*at*DPR);
          ctx.beginPath();
          ctx.moveTo(px-arm,py); ctx.lineTo(px+arm,py);
          ctx.moveTo(px,py-arm); ctx.lineTo(px,py+arm);
          ctx.stroke();
        }
      }
    }
  }

  if(reduce){ render(12.5); return; }   // image fixe si "réduire les animations"
  function loop(ms){ render(ms*0.001); _raf=requestAnimationFrame(loop); }
  _raf=requestAnimationFrame(loop);
}

export function stopHalftone(){
  if(_raf){ cancelAnimationFrame(_raf); _raf=null; }
  if(_onResize){ window.removeEventListener('resize', _onResize); _onResize=null; }
}
