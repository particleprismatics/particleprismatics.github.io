/* ============================================================================
   Particle Prismatics — particle intro engine
   Reusable, container-scoped WebGL particle animation.
   Particles scatter → coalesce into the PARTICLE / PRISMATICS logotype
   (PARTICLE white, PRISMATICS ROYGBIV) → crossfade the spectrum to silver
   while the real logo (prism graphic + tagline) fades in.

   initParticleIntro(opts) → { play, showLogo, setParam, destroy, state }
   opts:
     mount       : HTMLElement (required) — sized, position:relative container
     logoSrc     : string  — logo image URL
     controls    : bool    — build the parameter panel (studio mode)
     autoplay    : bool    — play once on load (default true)
     loop        : bool    — restart after finishing
     mouseRepel  : bool    — interactive repulsion while formed
     replayOnView: bool     — replay when the mount re-enters the viewport
     params      : object  — overrides for the tunable parameters
   ============================================================================ */
function initParticleIntro(opts) {
  const mount = opts.mount;
  const LOGO_SRC = opts.logoSrc || 'assets/logo.png';

  // ── measured logo geometry (normalized to the logo image 1001×763) ──
  const IMG = { w: 1001, h: 763 };
  const TEXT_X0 = 0.226, TEXT_X1 = 0.761;
  const BANDS = {
    particle:  { x0: TEXT_X0, x1: TEXT_X1, y0: 0.634, y1: 0.730, kind: 'white'    },
    prismatic: { x0: TEXT_X0, x1: TEXT_X1, y0: 0.754, y1: 0.830, kind: 'spectrum' },
  };
  const WORDS = {
    particle: { text: 'PARTICLE',   weight: 800, spacing: 0.005 },
    prismatic:{ text: 'PRISMATICS', weight: 500, spacing: 0.045 },
  };
  const FONT_FAMILY = 'Montserrat, "Arial Black", Arial, sans-serif';
  const FIT = 0.9;
  const SILVER = [0.84, 0.85, 0.90];

  const P = Object.assign({
    holdStart: 0, formDur: 2200, stagger: 1100, ease: 'easeInOut', dir: 'lr',
    holdFormed: 0, xfade: 2200,
    pointSize: 35, sampling: 2, sat: 1.0, whiteMix: 0.0,
    mouseRepel: opts.mouseRepel !== false, loop: !!opts.loop,
  }, opts.params || {});

  const EASE = {
    linear:      t => t,
    easeOut:     t => 1 - Math.pow(1 - t, 3),
    easeInOut:   t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2,
    easeOutBack: t => { const c1=1.70158, c3=c1+1; return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2); },
  };
  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const q = l < 0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
    const f = t => { t=(t+1)%1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p; };
    return [f(h+1/3), f(h), f(h-1/3)];
  }
  const smoothstep = (a,b,x)=>{ x=Math.max(0,Math.min(1,(x-a)/(b-a))); return x*x*(3-2*x); };

  // ── canvases ──
  const logoCanvas = document.createElement('canvas');
  const glCanvas   = document.createElement('canvas');
  for (const cv of [logoCanvas, glCanvas]) {
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    mount.appendChild(cv);
  }
  glCanvas.style.zIndex = '2';
  logoCanvas.style.zIndex = '1';
  const lctx = logoCanvas.getContext('2d');
  const gl = glCanvas.getContext('webgl', { antialias:true, alpha:true, premultipliedAlpha:false });
  if (!gl) { mount.innerHTML = '<div style="color:#888;padding:2rem;font:14px sans-serif">WebGL not supported</div>'; return null; }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const VS = `
    attribute vec2 a_pos; attribute vec4 a_col; attribute float a_sz;
    uniform vec2 u_res; uniform float u_ps;
    varying vec4 v_col;
    void main(){
      vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      gl_PointSize = u_ps * a_sz;
      v_col = a_col;
    }`;
  const FS = `
    precision mediump float; varying vec4 v_col;
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      float d = dot(c,c);
      if (d > 0.25) discard;
      float a = 1.0 - smoothstep(0.06, 0.25, d);
      gl_FragColor = vec4(v_col.rgb, v_col.a * a);
    }`;
  function sh(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(s); return s; }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog); gl.useProgram(prog);
  const loc = {
    pos: gl.getAttribLocation(prog,'a_pos'),
    col: gl.getAttribLocation(prog,'a_col'),
    sz:  gl.getAttribLocation(prog,'a_sz'),
    res: gl.getUniformLocation(prog,'u_res'),
    ps:  gl.getUniformLocation(prog,'u_ps'),
  };
  const posBuf = gl.createBuffer(), colBuf = gl.createBuffer(), szBuf = gl.createBuffer();

  // ── logo image ──
  const logoImg = new Image();
  let logoReady = false;
  logoImg.onload = () => { logoReady = true; };
  logoImg.src = LOGO_SRC;

  // ── particle state ──
  let N = 0;
  let homeX, homeY, scatX, scatY, curX, curY, velX, velY, delay;
  let baseCol, spectral, sizeJit, posArr, colArr, szArr;
  let logoRect = { x:0, y:0, w:0, h:0 };

  function rasterWord(word, targetHpx) {
    const fontPx = Math.max(24, Math.round(targetHpx * 1.42));
    const off = document.createElement('canvas');
    const c = off.getContext('2d');
    const spacePx = fontPx * word.spacing;
    c.font = `${word.weight} ${fontPx}px ${FONT_FAMILY}`;
    let total = 0;
    for (const ch of word.text) total += c.measureText(ch).width + spacePx;
    total -= spacePx;
    off.width  = Math.ceil(total) + fontPx;
    off.height = Math.ceil(fontPx * 1.6);
    const c2 = off.getContext('2d');
    c2.font = `${word.weight} ${fontPx}px ${FONT_FAMILY}`;
    c2.fillStyle = '#fff';
    c2.textBaseline = 'middle';
    let x = fontPx * 0.5;
    const y = off.height / 2;
    for (const ch of word.text) { c2.fillText(ch, x, y); x += c2.measureText(ch).width + spacePx; }
    const { data } = c2.getImageData(0, 0, off.width, off.height);
    const step = P.sampling;
    const pts = [];
    let bx0=1e9, by0=1e9, bx1=-1e9, by1=-1e9;
    for (let py=0; py<off.height; py+=step)
      for (let px=0; px<off.width; px+=step)
        if (data[(py*off.width+px)*4+3] > 90) {
          pts.push(px, py);
          if(px<bx0)bx0=px; if(px>bx1)bx1=px; if(py<by0)by0=py; if(py>by1)by1=py;
        }
    return { pts, bx0, by0, bw:(bx1-bx0)||1, bh:(by1-by0)||1 };
  }

  function computeLogoRect() {
    const VW = mount.clientWidth, VH = mount.clientHeight;
    const scale = Math.min(VW/IMG.w, VH/IMG.h) * FIT;
    const w = IMG.w*scale, h = IMG.h*scale;
    logoRect = { x:(VW-w)/2, y:(VH-h)/2, w, h };
  }

  function buildParticles() {
    computeLogoRect();
    const R = logoRect;
    const groups = [];
    for (const key of ['particle','prismatic']) {
      const band = BANDS[key], word = WORDS[key];
      const sx0 = R.x + band.x0*R.w, sx1 = R.x + band.x1*R.w;
      const sy0 = R.y + band.y0*R.h, sy1 = R.y + band.y1*R.h;
      const ras = rasterWord(word, sy1 - sy0);
      groups.push({ band, ras, sx0, sx1, sy0, sy1 });
    }
    N = groups.reduce((a,g)=>a + (g.ras.pts.length>>1), 0);

    homeX=new Float32Array(N); homeY=new Float32Array(N);
    scatX=new Float32Array(N); scatY=new Float32Array(N);
    curX =new Float32Array(N); curY =new Float32Array(N);
    velX =new Float32Array(N); velY =new Float32Array(N);
    delay=new Float32Array(N);
    baseCol=new Float32Array(N*3); spectral=new Uint8Array(N);
    sizeJit=new Float32Array(N);
    posArr=new Float32Array(N*2); colArr=new Float32Array(N*4); szArr=new Float32Array(N);

    let i = 0;
    for (const g of groups) {
      const { band, ras, sx0, sx1, sy0, sy1 } = g;
      const pts = ras.pts;
      for (let k=0; k<pts.length; k+=2) {
        const px = pts[k], py = pts[k+1];
        const u = (px - ras.bx0) / ras.bw;
        const v = (py - ras.by0) / ras.bh;
        homeX[i] = sx0 + u*(sx1-sx0);
        homeY[i] = sy0 + v*(sy1-sy0);
        sizeJit[i] = 0.72 + Math.random()*0.55;
        let r,gg,b;
        if (band.kind === 'spectrum') {
          if (Math.random() < P.whiteMix) {
            const s = 0.86 + Math.random()*0.14; r=gg=b=s; spectral[i]=0;
          } else {
            const hue = 8 + u*286;
            [r,gg,b] = hsl(hue, P.sat, 0.56); spectral[i]=1;
          }
        } else {
          const s = 0.90 + Math.random()*0.10; r=gg=b=s; spectral[i]=0;
        }
        baseCol[i*3]=r; baseCol[i*3+1]=gg; baseCol[i*3+2]=b;
        i++;
      }
    }

    // scatter — a fairly tight box hugging the logo+text content
    const bx0 = R.x + R.w*0.16, bx1 = R.x + R.w*0.84;
    const by0 = R.y + R.h*0.08, by1 = R.y + R.h*0.90;
    for(let j=0;j<N;j++){ scatX[j]=bx0+Math.random()*(bx1-bx0); scatY[j]=by0+Math.random()*(by1-by0); }
    computeDelays();
    for(let j=0;j<N;j++){ curX[j]=scatX[j]; curY[j]=scatY[j]; velX[j]=velY[j]=0; }

    gl.bindBuffer(gl.ARRAY_BUFFER, szBuf); gl.bufferData(gl.ARRAY_BUFFER, sizeJit, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf); gl.bufferData(gl.ARRAY_BUFFER, colArr, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, posArr, gl.DYNAMIC_DRAW);
  }

  function computeDelays() {
    let minX=1e9,maxX=-1e9;
    for(let j=0;j<N;j++){ if(homeX[j]<minX)minX=homeX[j]; if(homeX[j]>maxX)maxX=homeX[j]; }
    const cx=(minX+maxX)/2, range=(maxX-minX)||1;
    for(let j=0;j<N;j++){
      let t;
      if(P.dir==='lr')          t=(homeX[j]-minX)/range;
      else if(P.dir==='center') t=Math.abs(homeX[j]-cx)/(range/2);
      else                      t=Math.random();
      delay[j] = t*P.stagger + Math.random()*60;
    }
  }

  // ── timeline ──
  const PHASE = { HOLD:0, FORM:1, FORMED:2, XFADE:3, DONE:4 };
  let phase = PHASE.HOLD, t0 = 0, xfadeT = 0, started = false;

  function play() {
    computeDelays();
    for(let j=0;j<N;j++){ curX[j]=scatX[j]; curY[j]=scatY[j]; velX[j]=velY[j]=0; }
    phase = PHASE.HOLD; xfadeT = 0; started = true; t0 = performance.now();
  }
  function showLogo() { started = true; t0 = performance.now() - 1e7; }

  // ── mouse ──
  let mx=-1e5, my=-1e5, mouseIn=false;
  glCanvas.addEventListener('mousemove', e=>{ const r=glCanvas.getBoundingClientRect(); mx=e.clientX-r.left; my=e.clientY-r.top; mouseIn=true; });
  glCanvas.addEventListener('mouseleave', ()=>{ mouseIn=false; mx=my=-1e5; });

  // ── resize ──
  function resize(){
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    for (const cv of [logoCanvas, glCanvas]) {
      cv.width  = Math.max(1, Math.round(mount.clientWidth * dpr));
      cv.height = Math.max(1, Math.round(mount.clientHeight * dpr));
    }
    gl.viewport(0,0,glCanvas.width,glCanvas.height);
    gl.uniform2f(loc.res, mount.clientWidth, mount.clientHeight);
    buildParticles();
    if (opts.autoplay === false && !started) { showLogo(); } else { play(); }
  }
  let rt;
  const ro = new ResizeObserver(()=>{ clearTimeout(rt); rt=setTimeout(resize, 150); });
  ro.observe(mount);

  // ── logo layer ──
  function drawLogo(alpha){
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    lctx.setTransform(dpr,0,0,dpr,0,0);
    const VW=mount.clientWidth, VH=mount.clientHeight;
    lctx.clearRect(0,0,VW,VH);
    const g = lctx.createRadialGradient(VW/2,VH*0.46,VH*0.1, VW/2,VH*0.5,Math.max(VW,VH)*0.75);
    g.addColorStop(0,'#141419'); g.addColorStop(1,'#08080b');
    lctx.fillStyle=g; lctx.fillRect(0,0,VW,VH);
    if (alpha>0 && logoReady){
      lctx.globalAlpha = alpha;
      lctx.drawImage(logoImg, logoRect.x, logoRect.y, logoRect.w, logoRect.h);
      lctx.globalAlpha = 1;
    }
  }

  // ── main loop ──
  let raf, restartTimer=null;
  function frame(){
    raf = requestAnimationFrame(frame);
    if (!N) return;
    const now = performance.now();
    const t = now - t0;
    const easeFn = EASE[P.ease] || EASE.easeInOut;

    const formEnd = P.holdStart + P.stagger + P.formDur;
    const holdEnd = formEnd + P.holdFormed;
    const xfEnd   = holdEnd + P.xfade;
    if      (t < P.holdStart) phase = PHASE.HOLD;
    else if (t < formEnd)     phase = PHASE.FORM;
    else if (t < holdEnd)     phase = PHASE.FORMED;
    else if (t < xfEnd)       phase = PHASE.XFADE;
    else                      phase = PHASE.DONE;
    xfadeT = (phase===PHASE.XFADE) ? (t-holdEnd)/Math.max(1,P.xfade) : (phase===PHASE.DONE ? 1 : 0);

    if (phase===PHASE.HOLD){
      for(let j=0;j<N;j++){ curX[j]=scatX[j]+Math.sin(now*0.0006+j)*2.0; curY[j]=scatY[j]+Math.cos(now*0.0005+j*1.3)*2.0; }
    } else if (phase===PHASE.FORM){
      const ft = t - P.holdStart;
      for(let j=0;j<N;j++){
        const local = (ft - delay[j]) / P.formDur;
        const e = local<=0 ? 0 : local>=1 ? 1 : easeFn(local);
        curX[j]=scatX[j]+(homeX[j]-scatX[j])*e;
        curY[j]=scatY[j]+(homeY[j]-scatY[j])*e;
      }
    } else if (phase===PHASE.FORMED && P.mouseRepel && mouseIn){
      const k=0.10, damp=0.86, R=150, R2=R*R, force=13;
      for(let j=0;j<N;j++){
        let vx=velX[j], vy=velY[j], x=curX[j], y=curY[j];
        vx+=(homeX[j]-x)*k; vy+=(homeY[j]-y)*k;
        const dx=x-mx, dy=y-my, d2=dx*dx+dy*dy;
        if(d2<R2 && d2>0.01){ const d=Math.sqrt(d2), f=(1-d/R)*force; vx+=dx/d*f; vy+=dy/d*f; }
        vx*=damp; vy*=damp; x+=vx; y+=vy;
        velX[j]=vx; velY[j]=vy; curX[j]=x; curY[j]=y;
      }
    } else {
      for(let j=0;j<N;j++){ curX[j]+=(homeX[j]-curX[j])*0.25; curY[j]+=(homeY[j]-curY[j])*0.25; velX[j]=velY[j]=0; }
    }

    const colorLerp    = smoothstep(0.0, 0.62, xfadeT);
    const particleFade = 1 - smoothstep(0.5, 1.0, xfadeT);
    for(let j=0;j<N;j++){
      let r=baseCol[j*3], g=baseCol[j*3+1], b=baseCol[j*3+2];
      if(spectral[j] && colorLerp>0){ r+=(SILVER[0]-r)*colorLerp; g+=(SILVER[1]-g)*colorLerp; b+=(SILVER[2]-b)*colorLerp; }
      colArr[j*4]=r; colArr[j*4+1]=g; colArr[j*4+2]=b; colArr[j*4+3]=particleFade;
      posArr[j*2]=curX[j]; posArr[j*2+1]=curY[j];
    }

    drawLogo(smoothstep(0.12, 1.0, xfadeT));

    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    gl.uniform1f(loc.ps, P.pointSize*0.1*dpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferSubData(gl.ARRAY_BUFFER,0,posArr);
    gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos,2,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf); gl.bufferSubData(gl.ARRAY_BUFFER,0,colArr);
    gl.enableVertexAttribArray(loc.col); gl.vertexAttribPointer(loc.col,4,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, szBuf);
    gl.enableVertexAttribArray(loc.sz); gl.vertexAttribPointer(loc.sz,1,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.POINTS, 0, N);

    // dispatch a 'done' event once, for overlays to react to
    if (phase===PHASE.DONE && !frame._done){ frame._done=true; mount.dispatchEvent(new CustomEvent('intro:done')); }
    if (phase!==PHASE.DONE) frame._done=false;
    if (phase===PHASE.DONE && P.loop && !restartTimer){
      restartTimer = setTimeout(()=>{ restartTimer=null; play(); }, 1400);
    }
  }

  // ── optional: replay when scrolled back into view ──
  if (opts.replayOnView) {
    const io = new IntersectionObserver((es)=>{ if(es[0].isIntersecting && started) play(); }, { threshold: 0.5 });
    io.observe(mount);
  }

  // ── boot (waits for Montserrat so letterforms match the logo) ──
  (async function boot(){
    try {
      await Promise.all([ document.fonts.load('800 100px Montserrat'), document.fonts.load('500 100px Montserrat') ]);
      await document.fonts.ready;
    } catch(e){}
    resize();
    frame();
  })();

  return {
    play, showLogo,
    setParam(k,v){ P[k]=v; if(k==='sampling'||k==='sat'||k==='whiteMix'){ buildParticles(); play(); } },
    getParams(){ return P; },
    destroy(){ cancelAnimationFrame(raf); ro.disconnect(); logoCanvas.remove(); glCanvas.remove(); },
  };
}

if (typeof window !== 'undefined') window.initParticleIntro = initParticleIntro;
