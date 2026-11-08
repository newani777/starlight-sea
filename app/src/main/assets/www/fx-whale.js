// 혹등고래(11-05 광호님): 「고래 모델링을 물고기처럼 도트 이미지로 만들어서, 참고 영상(압주 9:08~9:50)의 고래 움직임을 표현」.
// 몸 = 광호님 블렌더 파일(Day7_Texture_Paint_Whale2.blend, Whale.001)의 겉면에서 넓이에 맞춰 뽑은 점 6000개(whale-pts.js).
//   파일 속 헤엄 뼈대는 다른 뼈대를 따라 붙게(COPY_ROTATION) 묶여 있어 밖에서 열면 몸이 움직이지 않는다 → 모양만 쓰고 헤엄은 여기서 만든다.
// 참고 영상의 움직임: 아주 큰 몸이 카메라 바로 곁을 느리게 미끄러져 지나가고, 꼬리지느러미는 위아래로 천천히 크게,
//   긴 가슴지느러미는 날개처럼 느리게, 몸은 살짝 기울며 지나간 뒤 깊은 쪽으로 내려가 물빛에 묻힌다.
// 길: 카메라 뒤 아래에서 천천히 앞질러 나와 → 차 밑을 지나 앞으로 → 반대쪽으로 조금 비껴 깊이 내려간다. 늘 수면 아래.
// 나오는 때: 곡에서 가장 웅장한 구간(songsync grand) 한 번. 오로라와 같은 구간이어도 된다(하늘과 물속).
(function () {
  const F = window.vecFx, W = window.WHALE_PTS; if (!F || !W) return;
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const rng = seed => { let s = (seed % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const wrapD = a => ((a % 1000) + 1500) % 1000 - 500;
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const cr = (a, b, c2, d, t) => [0, 1, 2].map(j => 0.5 * (2 * b[j] + (-a[j] + c2[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c2[j] - d[j]) * t * t + (-a[j] + 3 * b[j] - 3 * c2[j] + d[j]) * t * t * t));

  // 점: 블렌더 (x, y, z) → 여기 (옆 x, 위 y, 머리 쪽 +z) = (x, z, −y). 점마다 다른 밝기 하나
  const DOTS = (() => {
    const b = atob(W.b64), u8 = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
    const q = new Int16Array(u8.buffer), R = rng(3), out = new Float32Array(W.n * 7), k = 1 / 32000;
    for (let i = 0; i < W.n; i++) { const s = i * 6, o = i * 7;
      out[o] = q[s] * k; out[o + 1] = q[s + 2] * k; out[o + 2] = -q[s + 1] * k;
      out[o + 3] = q[s + 3] * k * 2; out[o + 4] = q[s + 5] * k * 2; out[o + 5] = -q[s + 4] * k * 2; out[o + 6] = R(); }
    return out;
  })();
  W.dots = DOTS;                                                   // 점프하는 고래(fx-breach.js)도 같은 몸을 쓴다

  const CLIP = `uniform vec4 uProj;uniform vec2 uRS,uNF;
  vec4 clipOf(vec3 l){float n=uNF.x,f=uNF.y;
    return vec4(uProj.x*l.z+uProj.z*(uRS.x*l.x+uRS.y*l.y),uProj.y*l.z+uProj.w*(-uRS.y*l.x+uRS.x*l.y),(f+n)/(f-n)*l.z-2.*f*n/(f-n),l.z);}`;
  const VS = `#version 300 es
  precision highp float;
  in vec3 aP,aN;in float aL;
  ${CLIP}
  uniform vec3 uPos,uFw;uniform float uSize,uPh,uRoll,uA,uPx,uMurk,uT,uSpread,uForm;uniform vec3 uSun;
  out float vA,vW;
  void main(){
    vec3 q=aP,nq=aN;
    // 꼬리 쪽으로 갈수록 크게, 위아래로 천천히(고래는 꼬리를 위아래로 친다). 물결이 머리→꼬리로 흘러간다
    float tl=clamp((.12-q.z)/.62,0.,1.);
    q.y+=(.004+tl*tl*.085)*sin(uPh-(.5-q.z)*2.4)-.006*sin(uPh+.9)*step(.2,q.z);
    // 긴 가슴지느러미: 날개처럼 느리게 오르내린다(몸에서 멀수록 크게)
    float fx=max(abs(q.x)-.075,0.);
    q.y+=fx*((.55-.4*uSpread)*sin(uPh*.5+.6)+.22*uSpread)*smoothstep(-.15,.05,q.z);   // 턴할 때는 날개처럼 옆으로 펼친 채 느리게(11-05 광호님 「정측면으로 날개를 펼치고 느긋이 턴」)
    vec3 fw=normalize(uFw),s0=normalize(cross(fw,vec3(0.,1.,0.))),u0=cross(s0,fw);   // 몸을 기울이는 축 = 몸의 앞뒤 축(옆으로 가로지를 때도 기울기가 살아 있게)
    vec3 sd=s0*cos(uRoll)+u0*sin(uRoll),up=cross(sd,fw);
    vec3 l=uPos+(sd*q.x+up*q.y+fw*q.z)*uSize;
    vec3 nn=normalize(sd*nq.x+up*nq.y+fw*nq.z);
    // 신기루(11-05 광호님 「사람이 예상하지 못하게 신기루를 보는 느낌」): 나타날 때·사라질 때 점이 겉면 바깥으로 흩어져 아른거리다 몸으로 모인다
    float h1=fract(aL*91.7),gone=1.-uForm;
    l+=nn*gone*(.25+.75*h1)*.32*uSize+vec3(sin(uT*2.3+aL*40.),sin(uT*1.7+aL*57.)*.5,cos(uT*2.1+aL*33.))*gone*.06*uSize;
    float dep=max(0.,-(l.y+.3));                                 // 수면에서 잰 깊이(카메라는 수면 위 .3)
    l.x+=.025*dep*sin(uT*1.3+l.z*1.1);l.y+=.012*dep*sin(uT*1.1+l.x*1.7);   // 물속 일렁임(굴절)
    float lit=dot(nn,uSun)*.5+.5,back=step(0.,nn.y);
    vA=uA*(.4+.6*aL)*(.45+.55*lit)*(.75+.25*back)*exp(-dep*uMurk)*mix(.35+.65*step(.5,fract(uT*3.+aL*17.)),1.,uForm)*(1.-gone*.5);
    vW=smoothstep(6.,70.,length(l));
    gl_PointSize=clamp(uPx/max(l.z,.05)*(.8+.5*aL),1.3,3.4);
    gl_Position=l.z<.05?vec4(2.,2.,2.,1.):clipOf(l);
  }`;
  const FS = `#version 300 es
  precision highp float;
  in float vA,vW;uniform vec3 uCol,uFogC;out vec4 o;
  void main(){vec3 c=mix(uCol,uFogC,vW*.6);o=vec4(c*vA,vA);}`;   // 사운드 웨이브처럼 가까이는 하이라이트·수평선 색, 멀리는 광원 빛깔

  let gl, P, vao, pod = null;
  // 길(차 기준: 오른쪽 x, 수면 높이 y, 앞 z). 뒤에서 옆으로 앞질러 / 깊은 아래에서 떠올라 / 멀리 옆에서 나타나 가로질러 / 비스듬히 다가와 앞으로
  const ROUTES = [
    [[6, -5, -14], [5, -3, -2], [4, -2.4, 10], [2.5, -2.2, 24], [0.5, -2.2, 37], [-3, -2.4, 46], [-8.5, -2.8, 51], [-14, -3.8, 53]],
    [[1.5, -11, 2], [1.2, -6, 10], [0.6, -3.2, 20], [-0.5, -2.4, 32], [-2, -2.3, 43], [-6, -2.6, 50], [-11, -3.3, 53], [-16, -4.5, 54]],
    [[26, -3.5, 56], [18, -2.6, 51], [10, -2.2, 48], [3, -2.1, 47], [-4, -2.3, 49], [-9, -2.7, 52], [-13, -3.4, 56], [-16, -4.4, 61]],
    [[16, -4.5, 8], [12, -3, 16], [7, -2.3, 26], [3, -2.1, 37], [-1, -2.2, 46], [-5.5, -2.6, 51], [-10.5, -3.2, 54], [-15, -4.4, 56]],
  ];
  // 서곡 전용 길(11-07 광호님 「완전한 상태로 카메라를 추월하듯 등장, 앞으로 나아가면 화면 왼쪽으로 비행기처럼 턴하며 사라지게」):
  //   카메라 뒤 오른쪽 아래에서 곁을 스치며 앞질러 → 정면 앞으로 → 왼쪽으로 크게 둥글게 돌며 멀어진다
  const PRELUDE = [[4, -4.2, -18], [3, -3, -5], [2, -2.4, 8], [1, -2.2, 20], [0, -2.2, 30], [-6, -2.4, 37], [-18, -2.7, 41], [-40, -3.2, 42]];
  // 11-07 광호님 「사라질 때 가까운 쪽 화면 끝으로 턴하며 프레임아웃 될 쯤 사라지게」: 앞 30m 쯤에서 그 순간 고래가 더 가까운 화면 끝 쪽을 고르고,
  //   그쪽으로 크게 돌아 화면 밖으로 빠진다(끝 점은 옆으로 40m, 정면 42m → 화면 가장자리 밖). 흐려지는 때는 화면을 벗어날 즈음
  const preTail = side => [[side * 6, -2.4, 37], [side * 18, -2.7, 41], [side * 40, -3.2, 42]];

  F.define({
    name: 'whale', label: '혹등고래', color: '#cfd8e6',
    layer: { slot: 'near', ctx: 'webgl2', scale: 1, maxDpr: 1.5, blend: 'screen', depth: false, aa: true },
    tune: {
      size:   [10, 1, 16, 0.1, '몸길이(단위)'],   // 11-05 광호님 「조금 더 키워 줘, 진짜 거대한 무언가가 밑으로 크게 움직이는 느낌」 7 → 10
      depth:  [1.0, 0.4, 3, 0.05, '수심'],
      pass:   [36, 10, 52, 0.5, '지나가는 시간(초)'],
      beat:   [4.33, 2, 10, 0.01, '꼬리 한 번(초)'],   // 11-05 광호님 「몸의 움직임 20%만 빠르게」 5.2 → 4.33
      murk:   [0.3, 0.1, 2, 0.05, '물속 흐림'],
      dotLum: [1.0, 0.3, 3, 0.05, '점 밝기'],
      tone:   [0.95, 0.05, 1, 0.005, '전체 톤'],   // 11-05 광호님 「지금보다 약간만 밝기를 낮춰 줘」 1.0 → 0.95(몸이 커져 점이 성겨진 만큼도 어두워진다)
      keep:   [120, 40, 220, 5, '따라오는 최고 시속'],
    },
    // 한 번 주행에 최대 두 번, 시작 5분(보야주 4분 30초) 안에는 안 나오고 두 번째는 9분 넘게 떨어져서(서곡은 곡 하나라 2:03 한 번)
    budget: { voyage: { first: 270, gap: 540, max: 2 }, nocturne: { first: 270, gap: 540, max: 2 }, atelier: { first: 300, gap: 540, max: 2 } },   // 11-07 광호님 「4분 30초로 당겨」: 보야주는 둘째 곡 웅장한 구간(약 4:54)에 첫 고래
    // 가장 웅장한 구간(grand) 하나. 그 구간이 시작되면 뒤에서 나오기 시작한다. 곡 도입·끝은 뺀다
    sync: { moments: ['grand'], momentLead: [5, 7], minConf: 0.6, edge: [30, 20], lead: [5, 7], hold: [18, 20], tail: 18, minGap: 60, maxPerSong: 1, alone: false, mix: ['aurora'] },
    init(L) {
      gl = L.gl;
      P = F.program(gl, VS, FS);
      vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const gb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gb); gl.bufferData(gl.ARRAY_BUFFER, DOTS, gl.STATIC_DRAW);
      for (const [n, sz, o] of [['aP', 3, 0], ['aN', 3, 12], ['aL', 1, 24]]) { const l = gl.getAttribLocation(P.p, n); if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, sz, gl.FLOAT, false, 28, o); } }
      gl.bindVertexArray(null);
    },
    draw(v, L, cues) {
      const T = this.T, cm = F.cam(v);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      let c = null;
      for (const q of cues) if (!c || q.start > c.start) c = q;
      if (!c) { pod = null; return; }
      const carV = v.kmh / 3.6 * v.MV, fwd = [-Math.sin(v.travel), Math.cos(v.travel)], dp = T.depth, k = tau => 1 - Math.exp(-v.dt / tau);
      const pre = window.vecDrive?.mode === 'prelude';
      if (!pod || pod.key !== c.key) {
        const R = rng((c.seed || 5) + 29), sd = pre ? 1 : R() < 0.5 ? -1 : 1, ri = Math.floor(R() * ROUTES.length);
        // 11-05 광호님 「등장은 여러 동선으로 랜덤하게, 예상하지 못하게」·「정면 50m 정도 앞으로 나갔을 때 정측면으로 날개를 펼치고 느긋이 턴하며 사라지는」:
        //   네 가지 길 가운데 하나(좌우도 무작위). 어느 길이든 끝은 정면 45~55m 에서 옆으로 몸을 돌려 지느러미를 펼친 채 천천히 가로지르며 흩어져 사라진다
        pod = { key: c.key, x: v.posX, z: v.posZ, vx: fwd[0] * carV, vz: fwd[1] * carV, h: v.travel, ph: R() * 6.28, rl: R() * 6.28, ri,
          KP: (pre ? PRELUDE : ROUTES[ri]).map(([x, y, z]) => [sd * x * (pre ? 1 : 0.9 + 0.2 * R()), y * dp, z * (pre ? 1 : 0.92 + 0.16 * R())]), pre };
      }
      // 고래의 기준점은 차와 함께 간다(너무 빠르면 뒤처진다)
      const cap = T.keep / 3.6 * v.MV, want = Math.min(carV, cap);
      pod.vx += (fwd[0] * want - pod.vx) * k(1.5); pod.vz += (fwd[1] * want - pod.vz) * k(1.5);
      pod.x += pod.vx * v.dt; pod.z += pod.vz * v.dt;
      if (carV <= cap) { pod.x += wrapD(v.posX - pod.x) * k(6); pod.z += wrapD(v.posZ - pod.z) * k(6); }
      if (!pod.pre) pod.h += wrap(v.travel - pod.h) * k(3);   // 서곡: 나타난 방향을 지킨다(차가 돌아도 같이 돌며 따라오지 않게)
      const KP = pod.KP, M = KP.length - 1, D = T.pass;
      const pathP = u => { const x = Math.min(M - 1e-6, Math.max(0, u * M)), i = Math.floor(x), t = x - i; return cr(KP[Math.max(0, i - 1)], KP[i], KP[i + 1], KP[Math.min(M, i + 2)], t); };
      const toWorldP = p => { const hc = Math.cos(pod.h), hs = Math.sin(pod.h); return [pod.x + p[0] * hc - p[2] * hs, p[1], pod.z + p[0] * hs + p[2] * hc]; };
      const path = u => {
        if (u >= 1) return add(KP[M], [KP[M][0] - KP[M - 1][0], KP[M][1] - KP[M - 1][1], KP[M][2] - KP[M - 1][2]], (u - 1) * M);
        if (u <= 0) return add(KP[0], [0, 0, 1], u * M * 6);
        const x = u * M, i = Math.floor(x), t = x - i;
        return cr(KP[Math.max(0, i - 1)], KP[i], KP[i + 1], KP[Math.min(M, i + 2)], t);
      };
      const st = c.st(), tau = st.age, u = tau / D;
      if (pod.pre && pod.side == null && u >= 0.45) {               // 돌 쪽은 그 순간 화면에서 더 가까운 끝
        const cur = toWorldP(pathP(u)), lc = cm.local(cur[0], cur[1], cur[2]); pod.side = lc[0] / Math.max(1, lc[2]) < 0 ? -1 : 1;
        pod.KP.splice(5, 3, ...preTail(pod.side).map(([x, y, z]) => [x, y * dp, z]));
      }
      const ue = u;
      const p0 = path(ue), p1 = path(ue + 0.004), dl = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], dn = Math.hypot(...dl) || 1, vel = dn / (0.004 * D);
      // 바라보는 쪽 = 물에 대해 실제로 나아가는 쪽(길 방향 + 차와 함께 가는 몫). 0.8초에 걸쳐 부드럽게
      const fb = 0.15 + 0.75 * (1 - sstep(0.42, 0.68, u)), rel = [dl[0] / dn * vel, dl[1] / dn * vel * 0.8, dl[2] / dn * vel + fb],   // 끝에서는 앞으로 가는 몫을 줄여 정측면이 보인다
      rl = Math.hypot(...rel) || 1, tg = rel.map(x => x / rl);
      pod.hd = pod.hd ? pod.hd.map((x, j) => x + (tg[j] - x) * k(1.6)) : tg; { const hl = Math.hypot(...pod.hd) || 1; pod.hd = pod.hd.map(x => x / hl); }
      const toWorld = p => { const hc = Math.cos(pod.h), hs = Math.sin(pod.h); return [pod.x + p[0] * hc - p[2] * hs, p[1], pod.z + p[0] * hs + p[2] * hc]; };
      const wp = toWorld(p0), l = cm.local(wp[0], wp[1], wp[2]);
      const ra = pod.h - v.head, rc = Math.cos(ra), rs = Math.sin(ra), d = pod.hd, dc = [d[0] * rc - d[2] * rs, d[1], d[0] * rs + d[2] * rc];
      pod.ph += v.dt * Math.PI * 2 / T.beat;                         // 꼬리 박자(음악과 무관, 느리고 크게)
      const turn = dl[0] / dn, roll = 0.1 * Math.sin(tau * 0.17 + pod.rl) - turn * (pod.pre ? 1.1 : 0.4);   // 서곡: 비행기처럼 도는 쪽으로 크게 기운다   // 살짝 기울며, 턴할 때는 그쪽으로 느긋이 눕는다
      // 11-07 광호님 「너무 오래 선명하게 머문다, 앞으로 가고 나서는 서서히 사라지게」: 차를 앞질러 앞으로 나간 뒤(길의 45% 지점)부터 물빛에 서서히 묻히고, 점도 함께 흩어진다
      const see = (pod.pre ? sstep(0, 1.2, tau) * (1 - sstep(0.62, 0.74, u)) : sstep(0, 2.5, tau) * (1 - sstep(0.45, 0.82, u))) * Math.max(0, Math.min(1, st.left / 2.5));
      const form = pod.pre ? 1 - sstep(0.66, 0.78, u) : sstep(0.3, 5, tau) * (1 - sstep(0.5, 0.86, u)), spread = sstep(0.5, 0.72, u);   // 서곡: 처음부터 완전한 몸으로, 돌며 멀어질 때만 흩어진다   // 신기루처럼 모였다 흩어진다 · 턴하며 지느러미를 펼친다
      if (location.search.includes('debug')) { const g = window.__whaleLog || (window.__whaleLog = []); if (g.length < 3000) g.push([performance.now() | 0, +l[0].toFixed(2), +l[1].toFixed(2), +l[2].toFixed(2), +see.toFixed(2)]); }
      if (see < 0.003) return;
      const proj = [2 * v.cx / v.W - 1, 1 - 2 * v.cy / v.H, 2 * v.H / v.W, 2];
      const p = v.pal, mixc = (a, b, t) => a.map((x, j) => (x + (b[j] - x) * t) / 255);
      const sb = v.sunBearing, sl = cm.dir(-Math.sin(sb), 0.12, Math.cos(sb)), sn = Math.hypot(...sl);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      gl.useProgram(P.p);
      gl.uniform4f(P.U.uProj, proj[0], proj[1], proj[2], proj[3]); gl.uniform2f(P.U.uRS, Math.cos(v.roll), Math.sin(v.roll)); gl.uniform2f(P.U.uNF, 0.02, 600);
      gl.uniform3f(P.U.uPos, l[0], l[1], l[2]); gl.uniform3f(P.U.uFw, dc[0], dc[1], dc[2]);
      gl.uniform1f(P.U.uSize, T.size); gl.uniform1f(P.U.uPh, pod.ph % 6283.19); gl.uniform1f(P.U.uRoll, roll);
      gl.uniform1f(P.U.uA, Math.min(1, see) * T.tone); gl.uniform1f(P.U.uPx, 0.005 * v.H * L.s); gl.uniform1f(P.U.uMurk, T.murk); gl.uniform1f(P.U.uT, tau); gl.uniform1f(P.U.uSpread, spread); gl.uniform1f(P.U.uForm, form);
      gl.uniform3f(P.U.uSun, sl[0] / sn, sl[1] / sn, sl[2] / sn);
      const wc = F.waveCol(v, 0.92 * T.dotLum); gl.uniform3fv(P.U.uCol, wc.near); gl.uniform3fv(P.U.uFogC, wc.far);   // 사운드 웨이브와 같은 빛깔
      gl.bindVertexArray(vao); gl.drawArrays(gl.POINTS, 0, W.n);
      gl.bindVertexArray(null);
    },
  });
})();
