// 고래 점프(11-05 광호님): 「음악의 가장 고조와 클라이맥스 순간에 50~100m 떨어진 곳에서 점프와 함께 아름답게 물을 튀기고 사라지면.
//   물은 사운드 웨이브 앨리먼트를 튕겨서 표현」. 참고: 혹등고래 브리칭 쇼츠(gBq03imK90E).
// 몸 = 같은 혹등고래 점 6000개(whale-pts.js, fx-whale.js 가 풀어 둔 W.dots). 멀리(55~75m) 옆에서 거의 곧게 솟구쳐
//   몸의 3분의 2쯤 물 밖으로 나오고, 공중에서 몸을 비틀며 옆으로 쓰러져 물을 때린다.
// 물 = 사운드 웨이브와 같은 1~2픽셀 빛 점. 튀는 순간의 소리 일곱 대역(저음 → 고음)을 그대로 높이로 쓴다:
//   물보라 가운데는 저음, 바깥은 고음이고, 그 대역이 크게 울릴수록 높이 튄다. 그래서 곡마다·순간마다 물보라 모양이 다르다.
// 나오는 때: 곡의 클라이맥스 한 점(songsync climax: 웅장한 구간 안 1단 타격, 곡 뒤쪽일수록). 정점 = 머리가 물을 뚫는 순간.
(function () {
  const F = window.vecFx, W = window.WHALE_PTS; if (!F || !W || !W.dots) return;
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const rng = seed => { let s = (seed % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const G = 6.2;                                                   // 느린 화면(실제 9.8 의 약 0.6): 공중에 머무는 시간이 길어 아름답다

  const CLIP = `uniform vec4 uProj;uniform vec2 uRS,uNF;
  vec4 clipOf(vec3 l){float n=uNF.x,f=uNF.y;
    return vec4(uProj.x*l.z+uProj.z*(uRS.x*l.x+uRS.y*l.y),uProj.y*l.z+uProj.w*(-uRS.y*l.x+uRS.x*l.y),(f+n)/(f-n)*l.z-2.*f*n/(f-n),l.z);}`;
  // 차 기준 좌표(오른쪽 x, 수면 위 y, 앞 z) → 카메라 기준: uO + uAx·x + uAy·y + uAz·z
  const XF = `uniform vec3 uO,uAx,uAy,uAz;vec3 toL(vec3 c){return uO+uAx*c.x+uAy*c.y+uAz*c.z;}`;
  const BODY_VS = `#version 300 es
  precision highp float;
  in vec3 aP,aN;in float aL;
  ${CLIP}${XF}
  uniform vec3 uC,uF,uU,uSun;uniform float uSize,uPh,uBeat,uFin,uArch,uA,uPx,uShade,uDip,uTail,uSub;
  out float vA,vW;
  void main(){
    vec3 q=aP;
    float tl=clamp((.12-q.z)/.62,0.,1.);
    q.y+=uBeat*(.004+tl*tl*.085)*sin(uPh-(.5-q.z)*2.4);           // 솟구칠 때는 꼬리를 세게 친다
    float fx=max(abs(q.x)-.075,0.);
    float fm=smoothstep(-.15,.05,q.z);
    q.y+=fx*(.2*uFin+.3*(1.-uFin)*sin(uPh*.5+.6))*fm;               // 긴 가슴지느러미: 물속에서는 저어 오르고, 공중에서는 날개처럼 펼친 채 멈춘다
    q.x+=sign(q.x)*fx*uFin*.5*fm;
    q.y+=uArch*.05*(1.-4.*q.z*q.z);                                 // 공중에서 등이 살짝 휜다(머리·꼬리가 처지는 활 모양)
    vec3 sd=normalize(cross(uF,uU));
    vec3 c=uC+(sd*q.x+uU*q.y+uF*q.z)*uSize;
    // 11-05 광호님 「수면에 다시 떨어질 때 뻣뻣하다, 크지 않아도 섬세하게」: 물에 닿은 뒤 머리 쪽이 먼저 가라앉고(uDip),
    //   꼬리는 물 위로 한 번 들렸다가(uTail) 천천히 미끄러져 들어간다. 몸 전체가 한 판처럼 같이 잠기지 않는다
    float tw=smoothstep(-.05,-.5,q.z),hw=smoothstep(.05,.5,q.z);
    c.y+=uTail*pow(tw,1.6)*uSize*.3-uDip*hw*uSize*.11;
    vec3 nn=normalize(sd*aN.x+uU*aN.y+uF*aN.z);
    float lit=dot(nn,uSun)*.5+.5;
    float wet=.04+.96*exp(1.5*min(c.y+.06,0.));                    // 물 아래는 깊이만큼 서서히 흐려진다(가라앉는 몸이 한 번에 끊기지 않게)
    vec3 l=toL(c);
    vA=uShade>.5?uA*.3*wet:uA*(.4+.6*aL)*(.4+.6*lit)*wet;
    vA*=1.-uSub*tw*smoothstep(-.03,.18,c.y);                      // 11-07 광호님 「다시 들어갈 때 꼬리가 물 밖으로 나오지 않게」: 물에 닿은 뒤로는 꼬리 쪽이 수면 위에 보이지 않는다          // 그림자 덩어리: 뒤의 밝은 웨이브·하늘에서 몸을 떼어 낸다
    vW=smoothstep(70.,240.,length(l));
    gl_PointSize=uShade>.5?clamp(uPx/max(l.z,.05)*3.2,3.,6.):clamp(uPx/max(l.z,.05)*(.8+.5*aL),1.,2.4);
    gl_Position=l.z<.05?vec4(2.,2.,2.,1.):clipOf(l);
  }`;
  // 물 알갱이: 태어난 자리 p0·처음 속도 v·태어난 시각 b·수명 lf·종류 k(0 물보라, 1 안개, 2 물결 고리)·대역 bd(0 저음 ~ 1 고음)·밝기 lm
  const DROP_VS = `#version 300 es
  precision highp float;
  in vec3 aP0,aV;in vec4 aI;in float aLm;
  ${CLIP}${XF}
  uniform float uS,uA,uPx;
  out float vA,vW,vB;
  void main(){
    float age=uS-aI.x,lf=aI.y,k=aI.z;vB=aI.w;
    if(age<0.||age>lf){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;vA=0.;return;}
    vec3 c;float br=1.;
    if(k<.5){                                                      // 물보라: 공기에 조금 늦춰지며 포물선
      float d=(1.-exp(-.32*age))/.32;
      c=aP0+aV*d;c.y-=.5*${G.toFixed(2)}*age*age;
      br=.55+.45*clamp(c.y/5.,0.,1.);                              // 높이 튄 알갱이일수록 또렷하다
      if(c.y<-.05){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;vA=0.;return;}
    }else if(k<1.5){                                               // 안개: 천천히 퍼지며 오래 머문다
      float d=(1.-exp(-1.6*age))/1.6;
      c=aP0+aV*d;c.y-=.12*age*age;c.y=max(c.y,.02);br=.5;
    }else{                                                         // 물결 고리: 수면에 퍼지며 소리 높이만큼 출렁인다
      float r=age*(1.-.18*age/lf);
      c=aP0+vec3(aV.x,0.,aV.z)*r;c.y=aV.y*exp(-.7*age)*(.6+.4*sin(age*5.+aLm*9.));br=.75;
    }
    float fade=smoothstep(0.,.06,age)*(1.-smoothstep(lf*.5,lf,age));
    vec3 l=toL(c);
    vA=uA*fade*br*(.45+.55*aLm)*(k>1.5?.16*step(.55,aLm):k>.5?.28:1.);   // 고리는 옆에서 보면 한 줄로 겹쳐 밝아지므로 듬성듬성·아주 옅게
    vW=smoothstep(70.,240.,length(l));
    gl_PointSize=clamp(uPx/max(l.z,.05)*(k>.5&&k<1.5?2.2:1.),1.,k>.5&&k<1.5?3.:2.2);
    gl_Position=l.z<.05?vec4(2.,2.,2.,1.):clipOf(l);
  }`;
  const FS = `#version 300 es
  precision highp float;
  in float vA,vW;uniform vec3 uCol,uFogC;out vec4 o;
  void main(){vec3 c=mix(uCol,uFogC,vW*.8);o=vec4(c*vA,vA);}`;
  const FS_DROP = `#version 300 es
  precision highp float;
  in float vA,vW,vB;uniform vec3 uCol,uLo,uHi,uFogC;out vec4 o;
  void main(){vec3 c=mix(uCol,mix(uLo,uHi,vB),.35);c=mix(c,uFogC,vW*.8);o=vec4(c*vA,vA);}`;   // 저음 알갱이는 따뜻하게, 고음은 차갑게(사운드 웨이브와 같은 결)

  const STRIDE = 11;                                               // p0(3) v(3) b lf k bd(4) lm(1)
  let gl, PB, PD, vaoB, vaoD, dbuf, pod = null;

  F.define({
    name: 'breach', label: '고래 점프', color: '#e4ecf6',
    layer: { slot: 'near', ctx: 'webgl2', scale: 1, maxDpr: 1.5, blend: 'screen', depth: false, aa: true },   // 11-05 광호님 「고래 어둡게 처리하지 마, 어두운 부분 빼고 스크린 레이어 합성」
    tune: {
      dist:  [56, 40, 110, 1, '거리(m)'],
      size:  [15, 6, 22, 0.5, '몸길이(m)'],
      leap:  [7.6, 4, 11, 0.1, '솟구치는 힘'],
      spray: [1.0, 0.3, 2, 0.05, '물보라 높이'],
      tone:  [0.9, 0.05, 1, 0.005, '전체 톤'],
    },
    // 11-05 광호님 「점프는 너무 자주 나오면 안 돼, 30분 주행이면 두 번 정도」: 시작 7분 뒤부터, 앞 점프와 13분 넘게 떨어져서(서곡은 곡 하나라 3:02 한 번)
    budget: { voyage: { first: 420, gap: 780, max: 3 }, nocturne: { first: 420, gap: 780, max: 3 }, atelier: { first: 420, gap: 780, max: 3 } },
    // 곡의 클라이맥스 한 점. 정점 3초 전부터 물속에서 다가온다(보이지 않는다). 물속 고래와 겹치면 다음 후보로
    sync: { climax: true, lead: [3, 3], hold: [7, 7], tail: 3, minGap: 60, maxPerSong: 1, edge: [30, 10], alone: true, mix: ['aurora', 'meteor', 'fog'] },
    init(L) {
      gl = L.gl;
      PB = F.program(gl, BODY_VS, FS); PD = F.program(gl, DROP_VS, FS_DROP);
      vaoB = gl.createVertexArray(); gl.bindVertexArray(vaoB);
      const gb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gb); gl.bufferData(gl.ARRAY_BUFFER, W.dots, gl.STATIC_DRAW);
      for (const [n, sz, o] of [['aP', 3, 0], ['aN', 3, 12], ['aL', 1, 24]]) { const l = gl.getAttribLocation(PB.p, n); if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, sz, gl.FLOAT, false, 28, o); } }
      vaoD = gl.createVertexArray(); gl.bindVertexArray(vaoD);
      dbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.bufferData(gl.ARRAY_BUFFER, 4, gl.DYNAMIC_DRAW);
      for (const [n, sz, o] of [['aP0', 3, 0], ['aV', 3, 12], ['aI', 4, 24], ['aLm', 1, 40]]) { const l = gl.getAttribLocation(PD.p, n); if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, sz, gl.FLOAT, false, STRIDE * 4, o); } }
      gl.bindVertexArray(null);
    },
    draw(v, L, cues) {
      const T = this.T, cm = F.cam(v);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      let c = null;
      for (const q of cues) if (!c || q.start > c.start) c = q;
      if (!c) { pod = null; return; }
      const st = c.st(), S = -st.toPeak;                             // 정점(머리가 물을 뚫는 순간)에서 잰 시각
      if (!pod || pod.key !== c.key || S < pod.lastS - 1) {
        const R = rng((c.seed || 7) + 113), sx = v.sunX || 0, sd = Math.abs(sx) > 0.04 ? (sx > 0 ? -1 : 1) : (R() < 0.5 ? -1 : 1);   // 광원 반대쪽에서 뛴다(서곡 끝 해돋이 빛 옆이면 흰 점이 빛에 묻혔다, 11-05)
        const z0 = T.dist * (0.9 + R() * 0.2);
        pod = { key: c.key, R, h: v.travel, sd, x0: sd * (0.24 + R() * 0.07) * z0, z0, dz: (R() - 0.5) * 0.5,
          tw: (R() < 0.5 ? -1 : 1) * (1.4 + R() * 0.6), ph: R() * 6.28, n: 0, data: new Float32Array(10000 * STRIDE), em: {} };
      }
      pod.lastS = S;
      pod.h += wrap(v.travel - pod.h) * (1 - Math.exp(-v.dt / 10));   // 먼 바다는 길이 꺾이는 만큼 천천히 따라온다

      // 몸의 움직임(차 기준). 11-05 광호님 「점프 움직임을 조금 더 부드럽게, 완성도 있게」:
      //   물속에서는 얕은 각도(32°)로 다가오다 점점 세워 거의 곧게(80°) 뚫고 나오고 → 공중에서는 포물선, 등이 살짝 휘고 지느러미를 날개처럼 펼친 채
      //   천천히 몸을 비틀며 옆으로 쓰러지고 → 물에 들어가서는 속도가 부드럽게 줄며 가라앉는다. 속도를 미리 적분해 두어 어느 순간에도 끊기지 않는다
      //   화면 바깥쪽(광원에서 멀어지는 쪽)으로 비스듬히 솟는다. 중심이 수면을 지나는 때 s0 = 정점 + 0.85초(머리가 먼저 뚫는다)
      const vy0 = T.leap, s0 = 0.85, tAir = 2 * vy0 / G, TH = 80 * Math.PI / 180, sp = vy0 / Math.sin(TH), vx = pod.sd * sp * Math.cos(TH);
      const dirH = norm([pod.sd, 0, pod.dz]), ease = t => t * t * t * (t * (6 * t - 15) + 10), es = (a, b, x) => ease(Math.max(0, Math.min(1, (x - a) / (b - a))));
      if (!pod.tab || pod.tabV !== vy0) {
        const A0 = -4.5, A1 = tAir + 3.5, dA = 0.01, n = Math.ceil((A1 - A0) / dA) + 1, tab = new Float32Array(n * 3);
        let p = [0, 0, 0], vE = null, at0 = 0;
        for (let i = 0; i < n; i++) {
          const a = A0 + i * dA; let vv;
          if (a < 0) { const th = (32 + 48 * es(-3.6, -0.15, a)) * Math.PI / 180, k = sp * (0.72 + 0.28 * es(-3.6, 0, a)); vv = [dirH[0] * Math.cos(th) * k, Math.sin(th) * k, dirH[2] * Math.cos(th) * k]; }
          else if (a < tAir) { const h = sp * Math.cos(TH); vv = [dirH[0] * h, vy0 - G * a, dirH[2] * h]; }
          else { if (!vE) { const h = sp * Math.cos(TH); vE = [dirH[0] * h, -vy0, dirH[2] * h]; } const t = a - tAir, e = Math.exp(-2.3 * t), g = Math.exp(-0.55 * t); vv = [vE[0] * (0.7 * e + 0.3 * g), vE[1] * e - 0.55 * (1 - e) * g, vE[2] * (0.7 * e + 0.3 * g)]; }
          tab[i * 3] = p[0]; tab[i * 3 + 1] = p[1]; tab[i * 3 + 2] = p[2];
          if (Math.abs(a) < dA / 2) at0 = i;
          p = [p[0] + vv[0] * dA, p[1] + vv[1] * dA, p[2] + vv[2] * dA];
        }
        const o = [tab[at0 * 3], tab[at0 * 3 + 1], tab[at0 * 3 + 2]];
        for (let i = 0; i < n; i++) { tab[i * 3] += pod.x0 - o[0]; tab[i * 3 + 1] -= o[1]; tab[i * 3 + 2] += pod.z0 - o[2]; }
        pod.tab = tab; pod.tabV = vy0; pod.A0 = A0; pod.dA = dA; pod.tn = n;
      }
      const posAt = a => { const f = Math.max(0, Math.min(pod.tn - 1.001, (a - pod.A0) / pod.dA)), i = Math.floor(f), t = f - i, q = pod.tab;
        return [0, 1, 2].map(j => q[i * 3 + j] * (1 - t) + q[i * 3 + 3 + j] * t); };
      const body = s => {
        const a = s - s0;
        const th = (a < 0 ? 32 + 48 * es(-3.6, -0.15, a) : 80 - 58 * es(tAir * 0.28, tAir + 0.15, a) - 34 * es(tAir, tAir + 1.6, a)) * Math.PI / 180;   // 물속: 점점 세우고 · 공중: 꼭대기 지나 천천히 눕고 · 물속: 고개를 숙이며 내려간다
        const r = pod.tw * (es(0.1, tAir + 0.7, a) + 0.3 * es(tAir, tAir + 2.6, a));   // 몸 비틀기는 처음부터 끝까지 한 번에, 물속에서도 천천히 조금 더 돈다
        const e = a - tAir;
        const Fw = norm([dirH[0] * Math.cos(th), Math.sin(th), dirH[2] * Math.cos(th)]), U0 = norm([-dirH[0] * Math.sin(th), Math.cos(th), -dirH[2] * Math.sin(th)]);
        const X = cross(Fw, U0), U = [0, 1, 2].map(j => U0[j] * Math.cos(r) + X[j] * Math.sin(r));
        const c = posAt(a); if (e > 0) c[1] += 0.28 * Math.sin(e * 2.4) * Math.exp(-1.1 * e) * es(0, 0.25, e);   // 물에 떨어진 몸이 한 번 살짝 떠올랐다 가라앉는다
        return { c, F: Fw, U, a,
          dip: es(0, 0.9, e) * (1 - 0.6 * es(1.8, 3.2, e)),
          tail: 0,   // 11-07: 꼬리를 물 위로 들어 올리던 움직임은 뺀다
          beat: a < -0.1 ? 1.4 : 0.15 + 1.25 * (1 - es(-0.1, 0.6, a)) + 0.45 * es(tAir + 0.8, tAir + 2.0, a),   // 솟을 때 세게 치고, 공중에서는 멈추고, 물속에서 다시 천천히 젓는다
          fin: es(-0.3, 0.9, a) * (1 - es(tAir - 0.1, tAir + 1.5, a)) + 0.12 * Math.sin(Math.max(0, e) * 3.2) * Math.exp(-1.4 * Math.max(0, e)) * es(0, 0.2, e),   // 지느러미는 물에 닿고 천천히 접히며 한 번 출렁인다
          arch: es(0.1, tAir * 0.5, a) * (1 - es(tAir * 0.65, tAir + 0.3, a)) };
      };
      const B = body(S);

      // 물 알갱이 만들기: 그 순간의 소리 일곱 대역을 그대로 높이로(가운데 저음 ~ 바깥 고음)
      const mu = v.mu || {}, on = v.mOn || 0;
      const bands = [mu.sub, mu.bass, mu.lowmid, mu.mid, mu.himid, mu.pres, mu.air].map(x => 0.35 + 0.85 * Math.min(1.2, on * (x || 0)));
      const bandAt = u => { const f = Math.min(0.999, Math.max(0, u)) * 6, i = Math.floor(f), t = f - i; return bands[i] * (1 - t) + bands[Math.min(6, i + 1)] * t; };
      const R = pod.R, D = pod.data;
      const put = (p, vv, b, lf, k, bd, lm) => { if (pod.n >= 10000) return; const o = pod.n++ * STRIDE; D[o] = p[0]; D[o + 1] = p[1]; D[o + 2] = p[2]; D[o + 3] = vv[0]; D[o + 4] = vv[1]; D[o + 5] = vv[2]; D[o + 6] = b; D[o + 7] = lf; D[o + 8] = k; D[o + 9] = bd; D[o + 10] = lm; pod.dirty = true; };
      const SP = T.spray;
      if (S >= -0.05 && !pod.em.out) {                               // 뚫고 나올 때: 몸 둘레 물보라 + 몸을 타고 흘러내리는 물 + 고리 하나
        pod.em.out = 1;
        const ex = body(s0).c;
        for (let i = 0; i < 1500; i++) {
          const ang = R() * 6.2832, u = Math.abs(Math.sin(ang)), lv = bandAt(u), rr = 1.1 + R() * 1.4;
          const p = [ex[0] + Math.cos(ang) * rr * 1.3, 0, ex[2] + Math.sin(ang) * rr];
          const up = (3.6 + 8.5 * lv * (0.55 + 0.6 * R())) * SP, out = 0.8 + 3.2 * R();
          put(p, [Math.cos(ang) * out + vx * 0.4, up, Math.sin(ang) * out * 0.7], S + R() * 0.9, 1.6 + R() * 1.6, 0, u, R());
        }
        for (let i = 0; i < 900; i++) {                              // 몸에서 떨어지는 물줄기: 솟구치는 동안 몸 곳곳에서 흘러내린다
          const tb = S + 0.15 + R() * (tAir * 0.85), bb = body(tb), w = (R() - 0.35) * 0.45 * T.size;
          const p = [bb.c[0] + bb.F[0] * w, bb.c[1] + bb.F[1] * w, bb.c[2] + bb.F[2] * w];
          if (p[1] < 0.2) continue;
          put(p, [vx * 0.5 + (R() - 0.5) * 0.8, (R() - 0.2) * 1.5, (R() - 0.5) * 0.8], tb, 1.2 + R() * 1.2, 0, R(), 0.3 + 0.7 * R());
        }
        for (let i = 0; i < 700; i++) { const ang = i / 700 * 6.2832, u = Math.abs(Math.sin(ang)); put([ex[0], 0.02, ex[2]], [Math.cos(ang) * 3.2, 0.12 + 0.5 * bandAt(u), Math.sin(ang) * 2.6], S + 0.3, 4.5, 2, u, R()); }
      }
      const sHit = s0 + tAir - 0.1;
      if (S >= sHit && !pod.em.hit) {                                // 쓰러져 물을 때릴 때: 몸 길이를 따라 크게 + 안개 + 고리 둘
        pod.em.hit = 1;
        const hb = body(sHit + 0.1), hc = hb.c, ln = [hb.F[0], 0, hb.F[2]], lh = Math.hypot(ln[0], ln[2]) || 1, lx = ln[0] / lh, lz = ln[2] / lh;
        for (let i = 0; i < 3000; i++) {
          const w = (R() - 0.5), u = Math.abs(w) * 2, lv = bandAt(u), side = R() < 0.5 ? -1 : 1, off = R() * 1.6;
          const p = [hc[0] + lx * w * T.size * 0.8 - lz * side * off, 0, hc[2] + lz * w * T.size * 0.8 + lx * side * off];
          const jet = R() < 0.12, up = (jet ? 9 + 9 * lv * R() : 3.5 + 8 * lv * Math.pow(R(), 0.8)) * SP * (0.8 + 0.2 * Math.cos(Math.PI * w)), out = jet ? 0.6 + R() : 2.2 + 7.5 * Math.pow(R(), 1.2) * (0.5 + 0.6 * lv);   // 왕관처럼 옆으로 넓게 + 몇 줄기만 높이(뾰족한 원뿔이 되지 않게)
          put(p, [-lz * side * out + lx * w * 2.5, up, lx * side * out * 0.7 + lz * w * 2.5], S + R() * 0.35, 2.0 + R() * 1.8, 0, u, R());
        }
        for (let i = 0; i < 1100; i++) {
          const w = (R() - 0.5), ang = R() * 6.2832, sp = 0.6 + 2.4 * R();
          put([hc[0] + lx * w * T.size * 0.9, 0.3 + R() * 1.5, hc[2] + lz * w * T.size * 0.9], [Math.cos(ang) * sp, (0.6 + 2.6 * R()) * SP, Math.sin(ang) * sp * 0.6], S + 0.15 + R() * 0.7, 3.5 + R() * 2.5, 1, R(), R());
        }
        for (const [lag, sp] of [[0.1, 3.8], [0.65, 2.6]]) for (let i = 0; i < 900; i++) {
          const ang = i / 900 * 6.2832, u = Math.abs(Math.sin(ang));
          put([hc[0], 0.02, hc[2]], [Math.cos(ang) * sp * 1.25, 0.15 + 0.6 * bandAt(u), Math.sin(ang) * sp], S + lag, 5, 2, u, R());
        }
      }

      if (false && S >= sHit + 1.75 && !pod.em.tail) {              // (11-07 꼬리를 들지 않으므로 꼬리 물보라도 뺀다)
        pod.em.tail = 1;
        const tb = body(sHit + 1.75), tp = [tb.c[0] - tb.F[0] * T.size * 0.45, 0, tb.c[2] - tb.F[2] * T.size * 0.45];
        for (let i = 0; i < 600; i++) { const ang = R() * 6.2832, u = Math.abs(Math.sin(ang)), lv = bandAt(u), out = 0.8 + 2.4 * R();
          put([tp[0] + Math.cos(ang) * 0.8, 0, tp[2] + Math.sin(ang) * 0.6], [Math.cos(ang) * out * 0.7, (1.6 + 3.2 * lv * R()) * SP, Math.sin(ang) * out * 0.5], S + R() * 0.35, 1.2 + R() * 1.1, 0, u, R()); }
      }
      // 차 기준 → 카메라 기준 축
      const hc0 = Math.cos(pod.h), hs0 = Math.sin(pod.h);
      const toW = p => [v.posX + p[0] * hc0 - p[2] * hs0, p[1], v.posZ + p[0] * hs0 + p[2] * hc0];
      const O = cm.local(...toW([0, 0, 0])), ax = j => { const e = [0, 0, 0]; e[j] = 1; const q = cm.local(...toW(e)); return [q[0] - O[0], q[1] - O[1], q[2] - O[2]]; };
      const AX = ax(0), AY = ax(1), AZ = ax(2);
      const see = sstep(0, 0.5, st.age) * Math.max(0, Math.min(1, st.left / 2));
      if (location.search.includes('debug')) { const g = window.__breachLog || (window.__breachLog = []); if (g.length < 2000) { const q = cm.local(...toW(B.c)); g.push([+S.toFixed(2), +see.toFixed(2), q.map(x => +x.toFixed(1)), pod.sd, +(v.sunX || 0).toFixed(2)]); } }
      if (see < 0.003) return;
      const proj = [2 * v.cx / v.W - 1, 1 - 2 * v.cy / v.H, 2 * v.H / v.W, 2];
      const p = v.pal, mixc = (a, b, t) => a.map((x, j) => (x + (b[j] - x) * t) / 255);
      const wc = F.waveCol(v, 0.95), col = wc.near, fog = wc.far, shade = mixc(p.sea, [0, 0, 0], 0.35);   // 11-05 광호님 「사운드 웨이브 앨리먼트 컬러와 동일하게」
      const sb = v.sunBearing, sw = [-Math.sin(sb), 0.25, Math.cos(sb)], sun = norm([sw[0] * hc0 + sw[2] * hs0, sw[1], -sw[0] * hs0 + sw[2] * hc0]);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      const common = P => {
        gl.useProgram(P.p);
        gl.uniform4f(P.U.uProj, proj[0], proj[1], proj[2], proj[3]); gl.uniform2f(P.U.uRS, Math.cos(v.roll), Math.sin(v.roll)); gl.uniform2f(P.U.uNF, 0.02, 800);
        gl.uniform3f(P.U.uO, O[0], O[1], O[2]); gl.uniform3f(P.U.uAx, ...AX); gl.uniform3f(P.U.uAy, ...AY); gl.uniform3f(P.U.uAz, ...AZ);
        gl.uniform1f(P.U.uPx, 0.005 * v.H * L.s); gl.uniform3fv(P.U.uFogC, fog);
      };
      // 몸: 물에 다시 들어간 뒤 1.6초 안에 물빛에 묻힌다
      const bodyA = see * T.tone * (1 - es(tAir + 0.8, tAir + 3.4, B.a)) * es(-1.5, -0.2, B.a);   // 잠기는 모습을 끝까지 보여 주고 물빛에 묻힌다
      if (bodyA > 0.003) {
        pod.ph += v.dt * Math.PI * 2 / (1.5 + 2.5 * es(-0.3, 0.8, B.a) - 0.8 * es(tAir + 0.8, tAir + 2, B.a));   // 박자도 끊기지 않게 서서히 느려진다
        common(PB);
        gl.uniform3f(PB.U.uC, ...B.c); gl.uniform3f(PB.U.uF, ...B.F); gl.uniform3f(PB.U.uU, ...B.U); gl.uniform3f(PB.U.uSun, ...sun);
        gl.uniform1f(PB.U.uSize, T.size); gl.uniform1f(PB.U.uPh, pod.ph % 6283.19); gl.uniform1f(PB.U.uBeat, B.beat);
        gl.uniform1f(PB.U.uFin, B.fin); gl.uniform1f(PB.U.uArch, B.arch); gl.uniform1f(PB.U.uDip, B.dip); gl.uniform1f(PB.U.uTail, B.tail); gl.uniform1f(PB.U.uSub, es(0.1, 0.55, B.a - tAir)); gl.uniform1f(PB.U.uA, bodyA);
        gl.bindVertexArray(vaoB);
        gl.uniform1f(PB.U.uShade, 0); gl.uniform3fv(PB.U.uCol, col); gl.drawArrays(gl.POINTS, 0, W.n);
      }
      if (pod.n) {
        if (pod.dirty) { gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.bufferData(gl.ARRAY_BUFFER, pod.data.subarray(0, pod.n * STRIDE), gl.DYNAMIC_DRAW); pod.dirty = false; }
        common(PD);
        gl.uniform1f(PD.U.uS, S); gl.uniform1f(PD.U.uA, see * T.tone);
        gl.uniform3fv(PD.U.uCol, col); gl.uniform3fv(PD.U.uLo, wc.far); gl.uniform3fv(PD.U.uHi, wc.near);   // 저음 알갱이는 광원 빛깔, 고음은 하이라이트 빛깔(웨이브의 먼·가까운 색)
        gl.bindVertexArray(vaoD); gl.drawArrays(gl.POINTS, 0, pod.n);
      }
      gl.bindVertexArray(null);
    },
  });
})();
