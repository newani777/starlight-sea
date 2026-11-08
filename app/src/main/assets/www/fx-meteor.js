// 별똥별: 한 복사점에서 흩어지듯 같은 결로 지나간다. 포인트 조금 전에 옅게 출발해 포인트에서 가장 밝고, 지나간 자리에 옅은 흔적이 남는다.
// 큰 포인트(T1)에는 서너 개가 시차를 두고 지나가고, 가운데 하나가 포인트에 맞는다.
(function () {
  const F = window.vecFx; if (!F) return;
  const wall = () => performance.now() / 1000;
  const songPos = () => (window.vecSync ? vecSync.state().position : 0);
  const rng = seed => { let s = (seed % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const rot = (v, k, ang) => { const c = Math.cos(ang), s = Math.sin(ang), d = dot(k, v), x = cross(k, v); return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)]; };
  const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const css = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const list = [];

  function spawn(c) {                                              // 11-05 광호님 「별똥별은 여러 개가 겹쳐서 떨어지지 않게」: 한 번에 하나만.
    if (list.length) return;                                       //   큰 포인트에서 여럿 떨어뜨리던 것(shower)을 없애고, 앞의 별똥별이 흔적까지 다 사라지기 전에는 새로 띄우지 않는다
    list.push({ key: c.key, clock: c.clock, t0: c.start, peak: c.peak, main: true, r: rng(c.seed || 1), dir: null, life: 0 });
  }

  F.define({
    name: 'meteor', label: '별똥별', color: '#ffe3c4',
    layer: { slot: 'near', ctx: '2d', scale: 1, maxDpr: 2, blend: 'plus-lighter' },
    tune: {
      radAz:  [-1.05, -3.14, 3.14, 0.01, '복사점 방위'],
      radEl:  [0.62, 0.1, 1.5, 0.01, '복사점 높이'],
      speed:  [24, 8, 60, 1, '속도(도/초)'],
      tail:   [0.2, 0.05, 0.6, 0.01, '꼬리 길이(초)'],
      bright: [0.68, 0.2, 2, 0.05, '밝기'],   // 11-04 광호님: 전체 그림에서 혼자 튀어 살짝 톤다운
      size:   [1.4, 0.5, 4, 0.1, '머리 크기'],
      train:  [0.22, 0, 1, 0.01, '흔적 세기'],
      trainLife: [1.6, 0.3, 4, 0.1, '흔적 시간'],
      warm:   [0.35, 0, 1, 0.01, '따뜻한 색'],
    },
    sync: { lead: [0.6, 1.2], tail: 1.6, wants: ['bloom', 'impact', 'accent', 'phrase', 'entry', 'resume'], tiers: [1, 2, 3], tension: [0, 1], minGap: 6, maxPerSong: 12, minConf: 0.45 },
    onCue(c, phase, off = 0) {
      if (phase === 'start' || phase === 'resume') { if (!list.some(m => m.key === c.key)) spawn(c); }
      else if (phase === 'cancel') for (let i = list.length - 1; i >= 0; i--) if (list[i].key === c.key) list.splice(i, 1);
      else if (phase === 'retime') for (const it of list) if (it.key === c.key) { it.clock = 'wall'; it.t0 += off; it.peak += off; }   // 곡 시계 → 벽시계(실시간 소리로 넘어갈 때)
    },
    draw(v, L) {
      const T = this.T, x = L.ctx, cm = F.cam(v);
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, L.w, L.h);
      if (!list.length) return;
      x.setTransform(L.s, 0, 0, L.s, 0, 0);
      x.globalCompositeOperation = 'lighter'; x.lineCap = 'round';
      const p = v.pal, head = mix([255, 250, 242], p.hi, 0.35), tailC = mix(p.hi, p.glow, T.warm), tailEnd = mix(tailC, p.top, 0.55), trainC = mix(p.hi, p.acc, 0.35);   // 꼬리 끝은 밤하늘 쪽 어두운 톤
      const radB = v.sunBearing + T.radAz, Rd = norm([-Math.sin(radB) * Math.cos(T.radEl), Math.sin(T.radEl), Math.cos(radB) * Math.cos(T.radEl)]);
      const w = T.speed * Math.PI / 180;
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i], t = m.clock === 'wall' ? wall() : songPos();
        const fade = 0.9, end = m.peak + fade + T.trainLife * 1.7, out = 1 - sstep(end - T.trainLife * 0.8, end, t);   // 11-04 「조금 빠르다」 → 조금 늦춤
        const sw = m.t0 - 0.2 + (m.peak + fade - m.t0 + 0.4) * Math.pow(sstep(m.peak, end - 0.2, t), 1.1);   // 흔적을 지우는 자리: 포인트부터 꼬리 쪽에서 머리 쪽으로 미끄러지며 스-윽 지운다(11-04 광호님)   // 흔적은 끝까지 0으로 잦아든 뒤 지운다(11-04 광호님 「잔상 마지막이 툭」: 20% 남은 채 지워졌다)   // 포인트 뒤 0.9초에 걸쳐 잦아든다(11-04 광호님 「툭 사라진다」)
        if (t > end || t < m.t0 - 0.3) { list.splice(i, 1); continue; }
        if (!m.dir) {                                               // 출발점: 지금 보는 쪽 하늘에서, 복사점에서 20~55° 떨어진 곳
          for (let k = 0; k < 80; k++) {
            const az = v.head + (m.r() - 0.5) * 1.6, el = 0.22 + m.r() * 0.55, d = norm([-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]);
            const ang = Math.acos(Math.max(-1, Math.min(1, dot(d, Rd))));
            const ax = norm(cross(Rd, d)), apart = list.every(o => o === m || !o.dir || (Math.acos(Math.max(-1, Math.min(1, dot(o.dir, d)))) > 0.22 && Math.acos(Math.max(-1, Math.min(1, dot(o.axis, ax)))) > 0.12));   // 다른 별똥별과 출발점(0.22)·지나는 길의 각(0.12)을 떨어뜨린다(11-04 광호님 「겹쳐서 내려오지 않게」)
            if (ang > 0.3 && ang < 1.0 && apart && dot(cross(Rd, d), cross(Rd, d)) > 1e-4) { m.dir = d; break; }
          }
          if (!m.dir) m.dir = norm([-Math.sin(v.head), 0.5, Math.cos(v.head)]);
          m.axis = norm(cross(Rd, m.dir)); m.sz = (m.main ? 1 : 0.65 + 0.25 * m.r()) * T.size; m.w = w * (0.85 + 0.3 * m.r());
        }
        const at = s => rot(m.dir, m.axis, m.w * (s - m.t0));
        // 밝기: 옅게 출발해 포인트에서 가장 밝고 빠르게 꺼진다
        const lum = s => {
          if (s < m.t0) return 0;
          if (s <= m.peak) { const u = (s - m.t0) / Math.max(0.05, m.peak - m.t0); return 0.12 + 0.88 * Math.pow(u, 2.2); }
          const u = (s - m.peak) / fade; return u >= 1 ? 0 : Math.exp(-(s - m.peak) / 0.3) * (1 - u * u * (3 - 2 * u));   // 빠르게 줄되 끝은 부드럽게 0으로
        };
        const vis = d => sstep(0.02, 0.09, d[1]);                   // 수평선 아래로는 가지 않는다
        const proj = d => cm.screen(cm.dir(d[0], d[1], d[2]));
        // 한 줄기로 그린다(11-04 광호님 「잔상에 하얀 점이 4~6개 찍힌다」): 마디마다 따로 긋던 둥근 끝이 겹쳐 밝은 점이 됐다 → 길이를 따라 폭이 줄어드는 띠 하나를 그라디언트로 채운다
        const ribbon = (pts, wid, col, alp) => {                   // pts: 머리→끝 화면 점, wid·alp: 점마다 폭·밝기
          if (pts.length < 2) return;
          const left = [], right = [];
          for (let k = 0; k < pts.length; k++) {
            const p0 = pts[Math.max(0, k - 1)], p1 = pts[Math.min(pts.length - 1, k + 1)];
            let nx = -(p1[1] - p0[1]), ny = p1[0] - p0[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
            const h = wid[k] / 2; left.push([pts[k][0] + nx * h, pts[k][1] + ny * h]); right.push([pts[k][0] - nx * h, pts[k][1] - ny * h]);
          }
          const A = pts[0], B = pts[pts.length - 1], gr = x.createLinearGradient(A[0], A[1], B[0], B[1]);
          const tot = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
          for (let k = 0; k < pts.length; k++) { const o = Math.min(1, Math.hypot(pts[k][0] - A[0], pts[k][1] - A[1]) / tot); gr.addColorStop(o, css(col[k], alp[k])); }
          x.fillStyle = gr; x.beginPath(); x.moveTo(left[0][0], left[0][1]);
          for (let k = 1; k < left.length; k++) x.lineTo(left[k][0], left[k][1]);
          for (let k = right.length - 1; k >= 0; k--) x.lineTo(right[k][0], right[k][1]);
          x.closePath(); x.fill();
        };
        const pathPts = (s0, s1, n) => { const o = []; for (let k = 0; k <= n; k++) { const s = s1 + (s0 - s1) * k / n, d = at(s), q = proj(d); if (!q) break; o.push({ q, s, d }); } return o; };   // s1(머리)→s0
        // 흔적: 지나간 자리가 천천히 식는다. 머리가 사라질 때까지 머리와 이어진다
        if (T.train > 0 && t > m.t0) {
          const P = pathPts(m.t0, Math.min(t, m.peak + fade), 16);   // 머리가 꺼진 자리 너머로는 흔적을 늘이지 않는다
          const al = P.map(({ s, d }) => { const age = t - s; return T.train * (m.main ? 1 : 0.6) * lum(Math.min(s, m.peak)) * Math.exp(-age / T.trainLife) * Math.min(1, age / 0.25) * vis(d) * out * sstep(sw - 0.14, sw + 0.14, s); });   // 지우는 자리 뒤는 사라지고 앞은 남는다(경계 0.28초 폭으로 부드럽게)
          ribbon(P.map(p => p.q), P.map(() => 7 * m.sz), P.map(() => trainC), al.map(a => a * 0.22));
          ribbon(P.map(p => p.q), P.map(() => 1.2 * m.sz), P.map(() => trainC), al.map(a => a * 0.5));
        }
        // 꼬리: 머리에서 뒤로 가늘어지고 끝으로 갈수록 어두운 톤. 태어난 자리보다 뒤로는 늘이지 않아 머리와 끊기지 않는다
        const L0 = lum(t), dNow = at(t), qh = proj(dNow);
        if (L0 > 0.002 && qh) {
          const P = pathPts(Math.max(m.t0, t - T.tail), t, 12), n = Math.max(1, P.length - 1);
          const f = P.map((_, k) => 1 - k / n), base = T.bright * L0 * (m.main ? 1 : 0.7);
          ribbon(P.map(p => p.q), f.map(v => Math.max(0.6, 2.6 * m.sz * v)), f.map(v => mix(tailEnd, tailC, v)), P.map((p, k) => base * f[k] * f[k] * vis(p.d) * 0.5));
          ribbon(P.map(p => p.q), f.map(v => Math.max(0.4, 0.9 * m.sz * v)), f.map(v => mix(tailC, head, v * v)), P.map((p, k) => base * f[k] * f[k] * vis(p.d) * 0.8));
          const a = Math.min(1, T.bright * L0 * vis(dNow)), r = 9 * m.sz * (0.6 + 0.4 * L0);
          const g = x.createRadialGradient(qh[0], qh[1], 0, qh[0], qh[1], r);
          g.addColorStop(0, css(head, a)); g.addColorStop(0.18, css(head, a * 0.55)); g.addColorStop(0.45, css(tailC, a * 0.16)); g.addColorStop(1, css(tailC, 0));
          x.fillStyle = g; x.beginPath(); x.arc(qh[0], qh[1], r, 0, 6.2832); x.fill();
        }
      }
    },
  });
})();
