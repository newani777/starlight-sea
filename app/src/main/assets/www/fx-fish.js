// 은빛 물고기 떼(11-05 광호님): 흰빛 물고기 떼가 곡이 가장 다채롭게 전개되는 구간에 한 곡 1~2번 나온다.
// 음악은 「나오는 때」에만 쓴다. 움직임은 음악과 상관없이 진짜 물고기 떼처럼: 물고기마다 이웃과 부딪치지 않게 떨어지고(분리),
// 이웃과 방향을 맞추고(정렬), 무리 가운데로 모이며(응집), 앞장선 길을 따라간다(무리 짓기 규칙).
// 길: 카메라 뒤 한쪽 옆에서 추월하듯 나와 → 앞에서 잠시 차와 같은 방향으로 헤엄치다 → 반대쪽 옆으로 비껴 사라진다. 모두 수면 아래.
// 그리는 법 두 가지: 점(사운드 웨이브처럼 미세한 빛 점으로 몸을 그림, 기본) / 면(?fishdots=0).
(function () {
  const F = window.vecFx; if (!F) return;
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const rng = seed => { let s = (seed % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const wrapD = a => ((a % 1000) + 1500) % 1000 - 500;
  const N_MAX = 600, DBG = location.search.includes('debug');
  const DOT_MODE = new URLSearchParams(location.search).get('fishdots') !== '0';

  // 몸: 위·뒤에서 보아도 물고기로 읽히는 납작하고 넓은 몸 + 가로 꼬리·가슴지느러미(머리 +z, 길이 약 0.83)
  function loft({ H, W, seg = 11, rad = 7, z0 = 0.5, z1 = -0.33, fin }) {
    const v = [], push = (p, n, f) => v.push(p[0], p[1], p[2], n[0], n[1], n[2], f);
    const ring = i => { const u = i / seg, z = z0 + (z1 - z0) * u, h = H(u), w = W(u), r = []; for (let j = 0; j < rad; j++) { const a = j / rad * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); const l = Math.hypot(c / Math.max(w, 0.01), s / Math.max(h, 0.01)); r.push([[c * w, s * h, z], [c / Math.max(w, 0.01) / l, s / Math.max(h, 0.01) / l, 0.08]]); } return r; };
    for (let i = 0; i < seg; i++) { const a = ring(i), b = ring(i + 1); for (let j = 0; j < rad; j++) { const k = (j + 1) % rad; for (const q of [a[j], b[j], b[k], a[j], b[k], a[k]]) push(q[0], q[1], 0); } }
    for (const t of fin || []) { const [a, b, c] = t, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n) || 1; for (const q of t) push(q, [n[0] / l, n[1] / l, n[2] / l], 1); }
    return new Float32Array(v);
  }
  const bH = (d, p) => u => d * Math.pow(Math.sin(Math.PI * Math.pow(u, p)), 0.8) + 0.012, bW = d => u => d * Math.sin(Math.PI * Math.pow(u, 0.62)) + 0.006;
  const hTail = (z, l, w, fork) => [[[0, 0, z], [w, 0.012, z - l], [w * 0.08, 0, z - l * (1 - fork)]], [[0, 0, z], [-w * 0.08, 0, z - l * (1 - fork)], [-w, 0.012, z - l]]];
  const pecs = [[[0.05, -0.01, 0.16], [0.17, -0.03, 0.02], [0.05, -0.01, 0.04]], [[-0.05, -0.01, 0.16], [-0.05, -0.01, 0.04], [-0.17, -0.03, 0.02]]];
  const GEO = loft({ H: bH(0.068, 0.68), W: bW(0.088), seg: 10, rad: 8, fin: [...hTail(-0.3, 0.22, 0.15, 0.55), ...pecs, [[0, 0.06, 0.1], [0, 0.11, -0.03], [0, 0.05, -0.1]]] });
  // 점 물고기: 몸·지느러미 겉면에 넓이에 맞춰 점을 고르게 흩뿌린다(한 마리 약 150점). aF = 지느러미 ×2 + 점마다 다른 밝기(0~1)
  const DOTS = (() => {
    const tri = [], n = GEO.length / 7;
    for (let i = 0; i < n; i += 3) { const P3 = [0, 1, 2].map(k => [GEO[(i + k) * 7], GEO[(i + k) * 7 + 1], GEO[(i + k) * 7 + 2]]);
      const u = P3[1].map((x, j) => x - P3[0][j]), w = P3[2].map((x, j) => x - P3[0][j]), cx = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      tri.push({ P3, N: [GEO[i * 7 + 3], GEO[i * 7 + 4], GEO[i * 7 + 5]], fin: GEO[i * 7 + 6], a: Math.hypot(...cx) / 2 }); }
    const tot = tri.reduce((s, t) => s + t.a, 0), R = rng(5), out = [];
    for (const t of tri) { const k = t.a / tot * 150; let m = Math.floor(k) + (R() < k - Math.floor(k) ? 1 : 0);
      while (m-- > 0) { let a = R(), b = R(); if (a + b > 1) { a = 1 - a; b = 1 - b; } const p = t.P3[0].map((x, j) => x + (t.P3[1][j] - x) * a + (t.P3[2][j] - x) * b); out.push(p[0], p[1], p[2], t.N[0], t.N[1], t.N[2], t.fin * 2 + 0.999 * R()); } }
    return new Float32Array(out);
  })();

  const CLIP = `uniform vec4 uProj;uniform vec2 uRS,uNF;
  vec4 clipOf(vec3 l){float n=uNF.x,f=uNF.y;
    return vec4(uProj.x*l.z+uProj.z*(uRS.x*l.x+uRS.y*l.y),uProj.y*l.z+uProj.w*(-uRS.y*l.x+uRS.x*l.y),(f+n)/(f-n)*l.z-2.*f*n/(f-n),l.z);}`;
  // 몸을 휘게 해 놓는 공통 부분: 꼬리 쪽으로 갈수록 크게 휘는 헤엄(박자는 iD.w)
  const BEND = `vec3 q=aP;float tail=clamp(.5-q.z,0.,1.);
    q.x+=(.026+tail*tail*.18)*sin(iD.w+q.z*3.6);   // 11-05 「헤엄 조금만 더 빠르게」(참고 영상 6:20): 박자 약 1.5배, 폭은 조금 줄여 떨려 보이지 않게
    vec3 fw=normalize(iD.xyz),wu=vec3(sin(iM.z),cos(iM.z),0.);
    vec3 sd=normalize(cross(fw,wu)),up=cross(sd,fw);
    vec3 l=iP.xyz+(sd*q.x+up*q.y+fw*q.z)*iP.w;
    vec3 nn=sd*aN.x+up*aN.y+fw*aN.z;`;
  const VS = `#version 300 es
  precision highp float;
  in vec3 aP,aN;in float aF;in vec4 iP,iD,iM;
  ${CLIP}
  out vec3 vN,vL,vV;out float vF,vA,vId,vW;
  void main(){
    ${BEND}
    vN=nn;vL=aP;vV=l;vF=aF;vA=iM.x;vId=iM.y;vW=iM.w;
    gl_Position=iM.x<.003||l.z<.03?vec4(2.,2.,2.,1.):clipOf(l);
  }`;
  const FS = `#version 300 es
  precision highp float;
  in vec3 vN,vL,vV;in float vF,vA,vId,vW;
  uniform vec3 uSun,uTop,uBel,uFin,uFogC,uRim;uniform float uGlow,uFar,uAmb;
  out vec4 o;
  void main(){
    vec3 n=normalize(vN);if(!gl_FrontFacing)n=-n;
    vec3 vd=normalize(-vV);
    float lit=dot(n,uSun)*.5+.5,y=vL.y;
    vec3 base=mix(uBel,uTop,smoothstep(-.06,.03,y));
    if(vF>.5)base=uFin;
    vec3 c=base*uAmb*(.45+.55*lit);
    float sh=pow(max(dot(n,normalize(uSun+vd)),0.),28.);
    c+=mix(uRim,base,.5)*sh*.55*(.6+.4*sin(vL.z*60.+vId));
    float rim=pow(1.-max(dot(n,vd),0.),3.),back=pow(max(dot(-vd,uSun),0.),2.);
    c+=uRim*rim*(.12+.7*back);
    c+=uTop*uGlow*.22;
    float fog=smoothstep(uFar*.3,uFar,length(vV));
    c=mix(c,uFogC,fog*.8);
    c=mix(c,uFogC,vW);
    float a=vA*(1.-fog*.7);
    o=vec4(c*a,a);
  }`;
  // 점: 사운드 웨이브 입자처럼 1~2픽셀 빛 점, 스스로 빛나 더해진다. 등(위)·옆으로 빛을 받는 쪽 점이 조금 더 밝다
  const VSD = `#version 300 es
  precision highp float;
  in vec3 aP,aN;in float aF;in vec4 iP,iD,iM;
  ${CLIP}
  uniform vec3 uSun;uniform float uPx;
  out float vA,vW;
  void main(){
    ${BEND}
    float lum=fract(aF),fin=floor(aF*.5),lit=dot(normalize(nn),uSun)*.5+.5;
    vA=iM.x*(.45+.55*lum)*(.55+.45*lit)*(fin>.5?.7:1.);vW=iM.w;
    gl_PointSize=clamp(uPx/max(l.z,.05)*(.75+.5*lum),1.,2.6);
    gl_Position=iM.x<.003||l.z<.03?vec4(2.,2.,2.,1.):clipOf(l);
  }`;
  const FSD = `#version 300 es
  precision highp float;
  in float vA,vW;uniform vec3 uCol,uFogC;out vec4 o;
  void main(){vec3 c=mix(uCol,uFogC,vW*.8);o=vec4(c*vA,vA);}`;   // 스크린 합성: 밑 색 + 점 색 × (1 − 밑 색) × 세기 → 밝은 무드 위에서는 덜 하얘지고 무드 색에 물든다

  let gl, P, PD, vao, dvao, ibuf, idata, nGeo, nDot;
  let school = null, fish = [];

  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const cr = (a, b, c2, d, t) => [0, 1, 2].map(j => 0.5 * (2 * b[j] + (-a[j] + c2[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c2[j] - d[j]) * t * t + (-a[j] + 3 * b[j] - 3 * c2[j] + d[j]) * t * t * t));

  F.define({
    name: 'shoal', label: '은빛 물고기 떼', color: '#dfe6ee',
    // 11-05 광호님 「물고기 도트의 합성 속성을 포토샵의 스크린 레이어처럼, 주변 컬러의 영향을 확실히 받게」: 점 물고기 층은 화면(screen) 합성
    layer: { slot: 'near', ctx: 'webgl2', scale: 1, maxDpr: 1.5, blend: DOT_MODE ? 'screen' : 'normal', depth: true, aa: true },
    tune: {
      count:  [140, 40, 600, 10, '마리 수'],
      size:   [0.143, 0.03, 0.3, 0.005, '몸길이(단위)'],
      depth:  [0.3, 0.08, 1.5, 0.02, '수심'],
      pass:   [9, 5, 16, 0.5, '머무는 시간(초)'],
      murk:   [1.4, 0.2, 4, 0.1, '물속 흐림'],
      dotLum: [0.8, 0.3, 3, 0.05, '점 밝기'],   // 11-05 「밝기도 약간만 낮춰」 0.9 → 0.8
      tone:   [0.225, 0.05, 1, 0.005, '전체 톤'],   // 11-05 광호님 「50% 톤 다운」 → 「50% 더 톤다운」 → 「10% 더 톤다운」
      keep:   [135, 40, 220, 5, '따라오는 최고 시속'],
    },
    // 곡이 가장 다채롭게 전개되는 구간(songsync 의 rich)에 한 곡 1번, 최대 2번
    // 11-05 광호님 「42dot_vec 곡 기준으로 45초 부분에 물고기 등장」: 곡별로 정한 시각(fixed, 그 시각에 보이기 시작)이 먼저, 남은 한 번은 가장 다채로운 구간
    // 11-05 「42dot VEC 45초 부분의 곡 느낌을 파악하고 다른 곡도 유사한 상황에」: 그 자리는 큰 터짐 뒤 숨 고르는 골짜기(songsync breath, 45초와 닮을수록 점수↑).
    //   물고기는 「숨 고르기」에 보이기 시작하게 2.7초 먼저 띄운다. 숨 고르기가 모자란 곡만 가장 다채로운 구간(rich)으로 채운다
    sync: { fixed: { 'vec.mp3': [44] }, fixedLead: 2.7, moments: ['breath'], momentLead: [2.7, 2.7], minConf: 0.5, edge: [20, 12], rich: true, richConf: 0.4, richKeep: 0.85, lead: [0.3, 0.8], hold: [7, 9], tail: 2.5, minGap: 40, maxPerSong: 2, alone: false },
    init(L) {
      gl = L.gl;
      P = F.program(gl, VS, FS); PD = F.program(gl, VSD, FSD);
      nGeo = GEO.length / 7; nDot = DOTS.length / 7;
      idata = new Float32Array(N_MAX * 12);
      ibuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ibuf); gl.bufferData(gl.ARRAY_BUFFER, idata.byteLength, gl.DYNAMIC_DRAW);
      const mkVao = (prog, data) => {
        const va = gl.createVertexArray(); gl.bindVertexArray(va);
        const gb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gb); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        for (const [n, sz, o] of [['aP', 3, 0], ['aN', 3, 12], ['aF', 1, 24]]) { const l = gl.getAttribLocation(prog.p, n); if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, sz, gl.FLOAT, false, 28, o); } }
        gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
        ['iP', 'iD', 'iM'].forEach((n, k) => { const l = gl.getAttribLocation(prog.p, n); if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 48, k * 16); gl.vertexAttribDivisor(l, 1); } });
        gl.bindVertexArray(null); return va;
      };
      vao = mkVao(P, GEO); dvao = mkVao(PD, DOTS);
    },
    draw(v, L, cues) {
      const T = this.T, cm = F.cam(v);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      let c = null;
      for (const q of cues) if (!c || q.start > c.start) c = q;
      if (!c) { school = null; return; }
      const carV = v.kmh / 3.6 * v.MV, fwd = [-Math.sin(v.travel), Math.cos(v.travel)], n = Math.min(N_MAX, T.count | 0), dp = T.depth;
      if (!school || school.key !== c.key) {
        const R = rng((c.seed || 7) + 11), sd = R() < 0.5 ? -1 : 1;
        school = { key: c.key, x: v.posX, z: v.posZ, vx: fwd[0] * carV, vz: fwd[1] * carV, h: v.travel, side: sd, dur: T.pass, bend: 0.6 + 0.8 * R() };
        // 길의 키 자리(차 기준: 오른쪽 x, 높이 y, 앞 z). 뒤 한쪽 옆 → 앞질러 나와 → 앞에서 차와 나란히 → 반대쪽 옆 앞으로 비껴 깊이
        school.KP = [[sd * 1.3, -dp * 1.3, -3.5], [sd * 1.0, -dp * 0.95, 0.8], [sd * 0.5, -dp * 0.7, 2.7], [-sd * 0.1 * school.bend, -dp * 0.62, 3.6], [-sd * 0.8, -dp * 0.75, 4.3], [-sd * 2.3, -dp * 1.1, 5.4], [-sd * 4.8, -dp * 1.7, 6.8]];
        fish = [];
        for (let i = 0; i < n; i++) {                               // 처음엔 카메라 뒤 한쪽에 느슨하게 모여 있다
          const p = [school.KP[0][0] + (R() - 0.5) * 1.1, Math.min(-0.06, school.KP[0][1] + (R() - 0.5) * 0.3), school.KP[0][2] - R() * 2.6];
          fish.push({ p, v: [0, 0, 1.6 + 0.6 * R()], lag: Math.pow(R(), 1.3) * 1.4, sz: 0.8 + 0.4 * R(), ph: R() * 6.2832, beat: 10 + 3.5 * R(), w1: R() * 6.28, w2: R() * 6.28, off: [(R() - 0.5) * 1.1, (R() - 0.5) * 0.18, (R() - 0.5) * 1.6], hd: null });
        }
      }
      // 무리 기준점: 차와 함께 간다(너무 빠르면 뒤처진다)
      const cap = T.keep / 3.6 * v.MV, want = Math.min(carV, cap), k = tau => 1 - Math.exp(-v.dt / tau);
      school.vx += (fwd[0] * want - school.vx) * k(1.2); school.vz += (fwd[1] * want - school.vz) * k(1.2);
      school.x += school.vx * v.dt; school.z += school.vz * v.dt;
      if (carV <= cap) { school.x += wrapD(v.posX - school.x) * k(6); school.z += wrapD(v.posZ - school.z) * k(6); }
      school.h += wrap(v.travel - school.h) * k(2.5);
      const hc = Math.cos(school.h), hs = Math.sin(school.h), D = school.dur, KP = school.KP, M = KP.length - 1;
      const path = u => {                                          // 앞장선 길: 키 자리를 지나는 매끈한 곡선(캣멀롬)
        if (u >= 1) return add(KP[M], [KP[M][0] - KP[M - 1][0], KP[M][1] - KP[M - 1][1], KP[M][2] - KP[M - 1][2]], (u - 1) * M);
        if (u <= 0) return add(KP[0], [0, 0, 1], u * M * 3);
        const x = u * M, i = Math.floor(x), t = x - i;
        return cr(KP[Math.max(0, i - 1)], KP[i], KP[i + 1], KP[Math.min(M, i + 2)], t);
      };
      const tau = c.st().age;
      // 무리 짓기: 화면 빠르기와 상관없이 1/30초 이하로 잘게 나눠 계산
      const steps = Math.min(4, Math.ceil(v.dt * 30)), h = v.dt / steps, RS = 0.3, RA = 0.75, VMAX = 3.4, AMAX = 5;
      for (let st = 0; st < steps; st++) {
        const tt = tau - v.dt + h * (st + 1);
        for (let i = 0; i < n; i++) {
          const f = fish[i], u = (tt - f.lag) / D, tg = path(u), tg2 = path(u + 0.01), dl = [tg2[0] - tg[0], tg2[2] - tg[2]], dn = Math.hypot(...dl) || 1;
          // 목표 자리 = 길 위 + 물고기마다 조금 다른 자리(길 방향 기준). 떼의 모양이 길을 따라 길쭉하게 흐른다
          const sx = dl[1] / dn, sz = -dl[0] / dn, gx = tg[0] + sx * f.off[0] + dl[0] / dn * f.off[2], gy = tg[1] + f.off[1], gz = tg[2] + sz * f.off[0] + dl[1] / dn * f.off[2];
          let ax = ((gx - f.p[0]) * 1.5 - f.v[0]) * 1.8, ay = ((gy - f.p[1]) * 1.5 - f.v[1]) * 1.8, az = ((gz - f.p[2]) * 1.5 - f.v[2]) * 1.8;   // 길 따라가기
          let sxn = 0, syn = 0, szn = 0, avx = 0, avy = 0, avz = 0, cx = 0, cy = 0, cz = 0, na = 0;
          for (let j = 0; j < n; j++) { if (j === i) continue; const g = fish[j], dx = f.p[0] - g.p[0], dy = f.p[1] - g.p[1], dz = f.p[2] - g.p[2], d2 = dx * dx + dy * dy * 4 + dz * dz;
            if (d2 > RA * RA) continue;
            if (d2 < RS * RS) { const w = 1 / Math.max(d2, 1e-3); sxn += dx * w; syn += dy * w; szn += dz * w; }   // 분리: 너무 가까우면 밀어낸다
            avx += g.v[0]; avy += g.v[1]; avz += g.v[2]; cx += g.p[0]; cy += g.p[1]; cz += g.p[2]; na++; }
          if (na) { ax += (avx / na - f.v[0]) * 1.4 + (cx / na - f.p[0]) * 0.5; ay += (avy / na - f.v[1]) * 1.4 + (cy / na - f.p[1]) * 0.5; az += (avz / na - f.v[2]) * 1.4 + (cz / na - f.p[2]) * 0.5; }   // 정렬 + 응집
          ax += sxn * 0.07; ay += syn * 0.07; az += szn * 0.07;
          if (f.p[1] > -0.06) ay -= (f.p[1] + 0.06) * 30;              // 수면 위로는 나오지 않는다
          const al = Math.hypot(ax, ay, az); if (al > AMAX) { ax *= AMAX / al; ay *= AMAX / al; az *= AMAX / al; }
          f.v[0] += ax * h; f.v[1] += ay * h * 0.6; f.v[2] += az * h;    // 위아래로는 덜 움직인다(납작한 떼)
          const vl = Math.hypot(...f.v); if (vl > VMAX) f.v = f.v.map(x => x * VMAX / vl);
        }
        for (const f of fish.slice(0, n)) { f.p[0] += f.v[0] * h; f.p[1] += f.v[1] * h; f.p[2] += f.v[2] * h; }
      }
      const toWorld = p => [school.x + p[0] * hc - p[2] * hs, p[1], school.z + p[0] * hs + p[2] * hc];
      const ra = school.h - v.head, rc2 = Math.cos(ra), rs2 = Math.sin(ra);
      for (let i = 0; i < n; i++) {
        const f = fish[i], wp = toWorld(f.p), l = cm.local(wp[0], wp[1], wp[2]), dep = -wp[1], u = (tau - f.lag) / D;
        l[0] += 0.02 * dep * Math.sin(tau * 2.1 + wp[2] * 1.7 + f.w1); l[1] += 0.01 * dep * Math.sin(tau * 1.6 + wp[0] * 2.3 + f.w2);   // 물속 일렁임(굴절)
        // 몸 방향: 차 기준으로 실제 움직이는 쪽 + 약한 앞 헤엄, 0.3초에 걸쳐 부드럽게 돈다
        const sp = Math.hypot(...f.v), rel = [f.v[0], f.v[1] * 0.7, f.v[2] + 0.7], rl = Math.hypot(...rel) || 1, tg = rel.map(x => x / rl), kd = f.hd ? 1 - Math.exp(-v.dt / 0.3) : 1;
        f.hd = f.hd ? f.hd.map((x, j) => x + (tg[j] - x) * kd) : tg; { const hl = Math.hypot(...f.hd) || 1; f.hd = f.hd.map(x => x / hl); }
        const dc = [f.hd[0] * rc2 - f.hd[2] * rs2, f.hd[1], f.hd[0] * rs2 + f.hd[2] * rc2];
        f.pa = (f.pa || f.ph) + v.dt * f.beat * (0.75 + 0.4 * Math.min(1, sp / 2.5));   // 꼬리 박자: 끊김 없이, 빠를수록 조금 빨리(음악과 무관)
        const dist = Math.hypot(l[0], l[1], l[2]), steep = -l[1] / Math.max(dist, 1e-3);
        const see = sstep(0.02, 0.16, steep) * Math.exp(-dep * T.murk * 0.6) * (1 - sstep(0.86, 1.02, u)) * sstep(0.15, 0.5, l[2]) * sstep(0, 0.6, tau);
        if (DBG && i < 6) { const g = window.__shoalLog || (window.__shoalLog = []); if (g.length < 4000) g.push([performance.now() | 0, i, +l[0].toFixed(3), +l[1].toFixed(3), +l[2].toFixed(3), +dc[0].toFixed(3), +dc[1].toFixed(3), +dc[2].toFixed(3), +see.toFixed(2)]); }
        const o = i * 12;
        idata[o] = l[0]; idata[o + 1] = l[1]; idata[o + 2] = l[2]; idata[o + 3] = T.size * f.sz;
        idata[o + 4] = dc[0]; idata[o + 5] = dc[1]; idata[o + 6] = dc[2]; idata[o + 7] = f.pa % 6283.19;
        idata[o + 8] = Math.min(1, see * 1.15) * T.tone; idata[o + 9] = i; idata[o + 10] = 0.06 * Math.sin(tau * 0.9 + f.w1);
        idata[o + 11] = Math.min(0.6, 1 - Math.exp(-dep * T.murk * 0.7));                    // 물빛이 섞이는 정도
      }
      const proj = [2 * v.cx / v.W - 1, 1 - 2 * v.cy / v.H, 2 * v.H / v.W, 2];
      const p = v.pal, mixc = (a, b, t) => a.map((x, j) => (x + (b[j] - x) * t) / 255);
      const sb = v.sunBearing, sl = cm.dir(-Math.sin(sb), 0.12, Math.cos(sb)), sn = Math.hypot(...sl);
      const fogC = mixc(p.sea, p.hor, 0.3);
      gl.bindBuffer(gl.ARRAY_BUFFER, ibuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, idata, 0, n * 12);
      if (DOT_MODE) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST); gl.depthMask(false);   // 층 안에서는 겹쳐 쌓고, 화면과는 스크린으로
        gl.useProgram(PD.p);
        gl.uniform4f(PD.U.uProj, proj[0], proj[1], proj[2], proj[3]); gl.uniform2f(PD.U.uRS, Math.cos(v.roll), Math.sin(v.roll)); gl.uniform2f(PD.U.uNF, 0.02, 600);
        gl.uniform3f(PD.U.uSun, sl[0] / sn, sl[1] / sn, sl[2] / sn); gl.uniform1f(PD.U.uPx, 0.005 * v.H * L.s);
        { const wc = F.waveCol(v, 0.93 * T.dotLum); gl.uniform3fv(PD.U.uCol, wc.near); gl.uniform3fv(PD.U.uFogC, wc.far); }   // 11-05 광호님 「물고기 컬러도 사운드 웨이브와 동일하게」
        gl.bindVertexArray(dvao); gl.drawArraysInstanced(gl.POINTS, 0, nDot, n);
      } else {
        const top = mixc([230, 230, 230], p.hi, 0.28), bel = mixc([246, 246, 246], p.hi, 0.16), fin = mixc([236, 236, 236], p.hi, 0.3);
        const lum = q => (q[0] * 0.3 + q[1] * 0.55 + q[2] * 0.15) / 255, amb = Math.min(1, 0.72 + 1.6 * lum(p.hor.map((x, j) => (x + p.top[j]) / 2)));
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.CULL_FACE);
        gl.useProgram(P.p);
        gl.uniform4f(P.U.uProj, proj[0], proj[1], proj[2], proj[3]); gl.uniform2f(P.U.uRS, Math.cos(v.roll), Math.sin(v.roll)); gl.uniform2f(P.U.uNF, 0.02, 600);
        gl.uniform3f(P.U.uSun, sl[0] / sn, sl[1] / sn, sl[2] / sn);
        gl.uniform3fv(P.U.uTop, top); gl.uniform3fv(P.U.uBel, bel); gl.uniform3fv(P.U.uFin, fin);
        gl.uniform3fv(P.U.uFogC, fogC); gl.uniform3fv(P.U.uRim, mixc([250, 250, 250], p.hi, 0.3));
        gl.uniform1f(P.U.uAmb, amb); gl.uniform1f(P.U.uGlow, 0.1); gl.uniform1f(P.U.uFar, 40);
        gl.bindVertexArray(vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, nGeo, n);
      }
      gl.bindVertexArray(null);
    },
  });
})();
