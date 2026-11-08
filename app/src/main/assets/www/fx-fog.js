// 해무: 조용한 구간에 수평선 쪽에서 낮은 안개가 밀려와 바다를 덮고, 곡이 다시 일어서기 전에 걷힌다.
// 안개는 세계에 놓인 덩어리라 차가 달리면 그 사이를 지나간다. 광원 쪽은 빛을 머금어 밝다.
(function () {
  const F = window.vecFx; if (!F) return;
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const FS = `#version 300 es
  precision highp float;
  ${F.GLSL_CAM}
  uniform float uSeaAdd,uAdd,uT,uI,uFront,uTop,uMax,uGlow,uDens,uScale,uPatch;
  uniform vec2 uWind;uniform vec3 uSunD,uBase,uHi,uWarm;
  out vec4 o;
  float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<3;i++){v+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=.5;}return v/.875;}
  void main(){
    vec3 d=fxRay(gl_FragCoord.xy);
    float tMax=2600.;
    if(d.y>.0005)tMax=min(tMax,(uTop-.3)/d.y);                      // 안개층 위로 빠져나가는 곳
    if(d.y<-.0001)tMax=min(tMax,.3/-d.y);                           // 수면에 닿는 곳
    float j=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
    float g=dot(d,uSunD),ph=.35+1.4*pow(max(g,0.),6.)+.4*pow(max(g,0.),40.);   // 광원 쪽으로 빛이 번진다
    vec3 lit=mix(uBase,uWarm,clamp(ph*uGlow*.5,0.,1.))+uHi*.06;
    float hd=length(d.xz),tr=1.;vec3 acc=vec3(0.);
    const int N=16;float tp=1.;
    for(int i=1;i<=N;i++){
      float t=pow(tMax,(float(i)-.5+j*.9)/float(N));
      float dt=t-tp;tp=t;
      vec2 w=uPos+d.xz*t;float y=.3+d.y*t,r=t*hd;
      float cov=smoothstep(uFront*.8,uFront*1.25+3.,r);               // 밀려오는 앞머리
      float hp=exp(-max(y,0.)/(uTop*.32))*(1.-smoothstep(uTop*.55,uTop,y));
      float n=fbm(w*uScale+uWind*uT+vec2(y*.05));
      float sh=mix(1.,smoothstep(.32,.78,n),uPatch);                  // 덩어리진 정도
      float den=uDens*cov*hp*sh;
      float a=1.-exp(-den*dt);
      acc+=tr*a*lit*(.9+.25*n);tr*=1.-a;
      if(tr<.02)break;
    }
    float A=(1.-tr)*uI,k=A>uMax?uMax/A:1.;
    vec3 col=acc*uI*k*uAdd;col=col/(1.+col*1.6);
    if(d.y<0.){float lm=dot(col,vec3(.2126,.7152,.0722));if(lm>uSeaAdd)col*=uSeaAdd/lm;}   // 수면 위에서는 광원보다 밝아지지 않게 정해진 몫까지만 더한다
    o=vec4(col,A*k*uAdd);   // 빛은 가산혼합(11-03 광호님): 안개가 머금은 빛만 더해진다. 겹쳐도 하얗게 넘치지 않고 제 색을 지키게 부드럽게 누른다
  }`;
  let P, vao;
  F.define({
    name: 'fog', label: '해무', color: '#c8d4e6',
    layer: { slot: 'sea', ctx: 'webgl2', scale: 0.3, maxDpr: 1, blend: 'plus-lighter' },
    tune: {
      dens:   [0.16, 0.01, 0.6, 0.005, '짙기'],
      top:    [6, 2, 30, 0.5, '높이(단위)'],
      near:   [1, 0, 200, 0.5, '가장 가까이'],
      dnear:  [28, 0, 200, 0.5, '여명 때 가장 가까이'],
      light:  [1.35, 0.6, 2.5, 0.05, '안개 밝기'],
      max:    [0.82, 0.2, 1, 0.01, '최대 가림'],
      patch:  [0.7, 0, 1, 0.01, '덩어리'],
      scale:  [0.012, 0.002, 0.05, 0.001, '덩어리 크기'],
      drift:  [0.9, 0, 4, 0.05, '흐르는 속도'],
      glow:   [1, 0, 2.5, 0.05, '광원 번짐'],
      add:    [0.6, 0, 1.5, 0.01, '더하는 빛 세기'],
    },
    // 11-03 광호님: 해무는 웅장함을 묘사하는 소재. 웅장함 구간에 화악 깔리고(1.5~3초) 끝나면 샤악 걷힌다(3초)
    sync: { moments: ['grand'], lead: [1.5, 3], momentLead: [1.5, 3], hold: [10, 10], tail: 3, minGap: 8, maxPerSong: 4, minConf: 0.3 },   // hold 는 「지금」 시험의 머무름
    init(L) {
      const gl = L.gl;
      P = F.program(gl, F.VS_FULL, FS);
      vao = gl.createVertexArray();
    },
    draw(v, L, cues) {
      const gl = L.gl, T = this.T, tail = this.sync.tail || 8;
      // 큐마다 앞머리 거리와 세기를 구해 가장 짙은 것을 쓴다
      let I = 0, front = 2400;
      // 11-03 광호님: 해무는 「여명」의 한 부분. 곡 안의 세기(v.dawn)를 그대로 따르고, 곡 큐는 쓰지 않는다(「지금」 시험만 남김)
      const D = v.dawn || 0;
      if (D > 0.003) { I = D; front = 1800 + (T.dnear - 1800) * (1 - Math.pow(1 - D, 2.2)); }   // 짙어질수록 가까이 오되, 가까운 물방울 앞까지는 덮지 않는다
      for (const c of cues) {
        if (c.clock !== 'wall') continue;
        const s = c.st();
        let i = sstep(0, 0.3, s.a), f = 1800 + (T.near - 1800) * (1 - Math.pow(1 - s.a, 2.2));
        if (s.a >= 1) f = T.near * (1 + 0.15 * Math.sin(s.age * 0.13));
        if (s.left < tail) { const k = Math.max(0, s.left / tail); i *= sstep(0, 1, k); f = f + (320 - f) * (1 - k * k); }   // 샤악: 가까운 데부터 걷히며 멀어진다
        if (i > I) { I = i; front = f; }
      }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (I < 0.003) return;
      gl.useProgram(P.p); gl.bindVertexArray(vao);
      F.glCam(gl, P.U, L, v);
      const p = v.pal, c3 = (u, a, k = 1) => gl.uniform3f(u, a[0] / 255 * k, a[1] / 255 * k, a[2] / 255 * k);
      const base = p.sea.map((x, i) => x * 0.45 + p.hor[i] * 0.55);
      c3(P.U.uBase, base.map((x, i) => x * 0.8 + p.hi[i] * 0.2), T.light); c3(P.U.uHi, p.hi); c3(P.U.uWarm, (v.sunGlow || p.glow).map((x, i) => x * 0.7 + p.hor[i] * 0.3), T.light);   // 광원 쪽 빛은 화면에 보이는 광원 색 그대로   // 달빛을 머금은 안개는 하늘보다 조금 밝다
      const sb = v.sunBearing, sd = [-Math.sin(sb), 0.06, Math.cos(sb)], sl = Math.hypot(...sd);
      gl.uniform3f(P.U.uSunD, sd[0] / sl, sd[1] / sl, sd[2] / sl);
      const wa = v.windAng || 0;
      gl.uniform2f(P.U.uWind, Math.cos(wa) * T.drift * T.scale, Math.sin(wa) * T.drift * T.scale);
      gl.uniform1f(P.U.uT, v.waterT % 3000);
      const lum = (p.hor[0] * 0.3 + p.hor[1] * 0.55 + p.hor[2] * 0.15) / 255;   // 밝은 하늘에 빛을 더하면 하얗게 탄다: 배경이 밝을수록 덜 더한다
      gl.uniform1f(P.U.uSeaAdd, (v.sunL || 1) * (0.12 + 0.3 * (v.dawn || 0))); gl.uniform1f(P.U.uAdd, T.add * Math.max(0.12, Math.min(1, 1.3 - 1.6 * lum))); gl.uniform1f(P.U.uI, I); gl.uniform1f(P.U.uFront, front); gl.uniform1f(P.U.uTop, T.top); gl.uniform1f(P.U.uMax, T.max);
      gl.uniform1f(P.U.uGlow, T.glow); gl.uniform1f(P.U.uDens, T.dens); gl.uniform1f(P.U.uScale, T.scale); gl.uniform1f(P.U.uPatch, T.patch);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  });
})();
