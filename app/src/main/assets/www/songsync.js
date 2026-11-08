// 음악 싱크 엔진: 어떤 곡이든 주요 포인트를 찾아 추가 앨리먼트의 등장 시각을 정한다
// 의존성 없는 순수 JS. 브라우저 워커와 Node 에서 같은 코드가 돈다. 설계: docs/plans/2026-11-01-music-sync-engine.md
(function (root) {
  'use strict';
  const NFFT = 1024, HOP = 512, TARGET_SR = 22050, BANDS = 8, GRID = 0.125;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // 변화 크기의 절대 기준: dB 와 음색 거리. 곡마다 재지 않으므로 평평한 곡은 포인트가 나오지 않는다
  const NB0 = 3, NC0 = 0.12, GATE_T2 = 1.0, GATE_T1 = 1.9, BEAT_RATIO = 2.6;

  function fftTables(n) {
    const rev = new Uint32Array(n), cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = -Math.sin(2 * Math.PI * i / n); }
    return { rev, cos, sin };
  }
  function fft(re, im, t) {
    const n = re.length;
    for (let i = 0; i < n; i++) { const j = t.rev[i]; if (j > i) { let v = re[i]; re[i] = re[j]; re[j] = v; v = im[i]; im[i] = im[j]; im[j] = v; } }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
        const c = t.cos[k], s = t.sin[k], a = i + j, b = a + half, tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  function percentile(a, p) {
    const s = Float32Array.from(a).sort();
    return s.length ? s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)] : 0;
  }
  function boxMean(a, r) {                                       // 앞뒤 r 칸 평균. 곡 길이에 비례하는 시간
    const n = a.length, c = new Float64Array(n + 1), o = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i + 1] = c[i] + a[i];
    for (let i = 0; i < n; i++) { const p = Math.max(0, i - r), q = Math.min(n, i + r + 1); o[i] = (c[q] - c[p]) / (q - p); }
    return o;
  }
  function decimate(x, f) {
    if (f <= 1) return x;
    const o = new Float32Array(Math.floor(x.length / f));
    for (let i = 0; i < o.length; i++) { let s = 0; for (let j = 0; j < f; j++) s += x[i * f + j]; o[i] = s / f; }
    return o;
  }

  // ---------- 특징 ----------
  function features(x, sr) {
    const n = Math.max(0, Math.floor((x.length - NFFT) / HOP) + 1), t = fftTables(NFFT);
    const win = new Float32Array(NFFT), re = new Float32Array(NFFT), im = new Float32Array(NFFT);
    for (let i = 0; i < NFFT; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NFFT);
    const edges = [], hz = sr / NFFT, bandOf = new Int8Array(NFFT / 2).fill(-1), pcOf = new Int8Array(NFFT / 2).fill(-1);
    for (let b = 0; b <= BANDS; b++) edges.push(60 * Math.pow(10000 / 60, b / BANDS));
    for (let k = 1; k < NFFT / 2; k++) {
      const f = k * hz;
      for (let b = 0; b < BANDS; b++) if (f >= edges[b] && f < edges[b + 1]) bandOf[k] = b;
      if (f >= 100 && f <= 4000) pcOf[k] = ((Math.round(12 * Math.log2(f / 440)) + 9) % 12 + 12) % 12;
    }
    const bands = new Float32Array(n * BANDS), chroma = new Float32Array(n * 12), loud = new Float32Array(n), bright = new Float32Array(n);
    const bp = new Float64Array(BANDS);
    for (let f = 0; f < n; f++) {
      const s = f * HOP;
      for (let i = 0; i < NFFT; i++) { re[i] = x[s + i] * win[i]; im[i] = 0; }
      fft(re, im, t);
      bp.fill(0);
      let tot = 0, cw = 0, cs = 0;
      for (let k = 1; k < NFFT / 2; k++) {
        const p = re[k] * re[k] + im[k] * im[k], b = bandOf[k], c = pcOf[k];
        if (b >= 0) { bp[b] += p; tot += p; cw += p * Math.log2(k); cs += p; }
        if (c >= 0) chroma[f * 12 + c] += Math.sqrt(p);
      }
      for (let b = 0; b < BANDS; b++) bands[f * BANDS + b] = 10 * Math.log10(bp[b] + 1e-9);
      loud[f] = 10 * Math.log10(tot + 1e-9);
      bright[f] = cs > 0 ? cw / cs : 0;
    }
    return { n, bands, chroma, loud, bright, fps: sr / HOP };
  }

  // ---------- 박 ----------
  function onsetCurve(F, floorDb) {
    const { n, bands } = F, o = new Float32Array(n);
    for (let f = 2; f < n; f++) {
      let s = 0;
      for (let b = 0; b < BANDS; b++) s += Math.max(0, Math.max(bands[f * BANDS + b], floorDb) - Math.max(bands[(f - 2) * BANDS + b], floorDb));
      o[f] = s / BANDS;
    }
    return o;
  }
  function beatDP(o, base, tight) {
    const n = o.length, cum = new Float32Array(n), prev = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const tau = base[i], a = Math.max(0, Math.round(i - 1.3 * tau)), b = Math.round(i - 0.75 * tau);
      let best = 0, bj = -1;
      for (let j = a; j <= b && j < i; j++) { const l = Math.log((i - j) / tau), v = cum[j] - tight * l * l; if (v > best) { best = v; bj = j; } }
      cum[i] = o[i] + best; prev[i] = bj;
    }
    let e = n - 1, top = -1e9;
    for (let i = Math.max(0, n - Math.round(2 * base[n - 1])); i < n; i++) if (cum[i] > top) { top = cum[i]; e = i; }
    const out = [];
    for (let i = e; i >= 0; i = prev[i]) out.push(i);
    return out.reverse();
  }
  function trackBeats(oRaw, fps) {
    const n = oRaw.length, m = boxMean(oRaw, Math.round(fps * 1.5)), o = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) { o[i] = Math.max(0, oRaw[i] - m[i]); sum += o[i] * o[i]; }
    const rms = Math.sqrt(sum / Math.max(1, n)) || 1;
    let oMean = 0;
    for (let i = 0; i < n; i++) { o[i] /= rms; oMean += o[i] / n; }
    const lagA = Math.round(fps * 60 / 200), lagB = Math.min(Math.round(fps * 60 / 40), Math.floor(n / 3));
    if (n < fps * 6 || lagB <= lagA) return null;
    const acTop = Math.min(lagB * 4 + 2, Math.floor(n / 2)), ac = new Float32Array(acTop + 2), step = Math.max(1, Math.floor(n / 12000));
    for (let l = lagA; l <= acTop; l++) { let s = 0; for (let i = 0; i + l < n; i += step) s += o[i] * o[i + l]; ac[l] = s; }
    const acAt = v => { if (v >= acTop) return 0; const a = Math.floor(v), f = v - a; return ac[a] * (1 - f) + ac[a + 1] * f; };
    // 배음 빗: 한 간격만 보면 2/3배로 틀리기 쉬워 2·3·4배 간격의 일치까지 함께 본다
    const comb = l => acAt(l) + 0.8 * acAt(2 * l) + 0.7 * acAt(3 * l) + 0.6 * acAt(4 * l);
    const prior = l => { const b = 60 * fps / l; return Math.exp(-0.5 * Math.pow(Math.log2(b / 110) / 1.2, 2)); };
    const grid = [];
    for (let l = lagA; l <= lagB; l += 0.25) grid.push({ l, v: comb(l) });
    const cands = [];
    for (let i = 1; i + 1 < grid.length; i++) if (grid[i].v > grid[i - 1].v && grid[i].v >= grid[i + 1].v) cands.push({ l: grid[i].l, s: grid[i].v * prior(grid[i].l) });
    cands.sort((a, b) => b.s - a.s);
    const pool = [];
    const addLag = l => { if (l >= lagA && l <= lagB && !pool.some(p => Math.abs(p - l) / l < 0.025)) pool.push(l); };
    cands.slice(0, 4).forEach(c => { addLag(c.l); addLag(c.l * 2); addLag(c.l / 2); });
    if (!pool.length) return null;
    // 구간 템포: 8초 창마다 후보 둘레에서 가장 잘 맞는 간격을 찾아 곡 안의 템포 변화를 따라간다
    const localTempo = lag => {
      const wr = Math.round(fps * 4), hop = Math.round(fps), pts = [], lo = lag * 0.78, hi = lag * 1.28;
      for (let c = wr; c < n - wr; c += hop) {
        let best = -1, bl = lag;
        for (let l = lo; l <= hi; l += 0.5) { const a = Math.round(l), b = Math.round(2 * l); let s = 0; for (let i = c - wr; i < c + wr - b; i += 2) s += o[i] * (o[i + a] + 0.7 * o[i + b]); s *= 1 - 0.6 * Math.abs(Math.log(l / lag)); if (s > best) { best = s; bl = l; } }
        pts.push(bl);
      }
      const base = new Float32Array(n).fill(lag);
      if (pts.length > 2) {
        const med = pts.map((_, i) => { const w = pts.slice(Math.max(0, i - 3), i + 4).sort((a, b) => a - b); return w[w.length >> 1]; });
        for (let i = 0; i < n; i++) { const p = clamp((i - wr) / hop, 0, med.length - 1), a = Math.floor(p), b = Math.min(med.length - 1, a + 1); base[i] = med[a] + (med[b] - med[a]) * (p - a); }
      }
      return base;
    };
    const score = beats => {
      if (beats.length < 8) return { q: 0, ratio: 1 };
      let on = 0, off = 0;
      for (let i = 0; i + 1 < beats.length; i++) { on += o[beats[i]]; off += o[Math.round((beats[i] + beats[i + 1]) / 2)]; }
      const c = beats.length - 1, mean = oMean;
      return { q: (on / c) / (mean + 1e-6), ratio: (on / c + 1e-3) / (off / c + 1e-3) };
    };
    let ac0 = 0; for (let i = 0; i < n; i += step) ac0 += o[i] * o[i];
    const longAt = lag => { const L = Math.round(lag); if (L >= n - 1) return 0; let v = 0; for (let i = 0; i + L < n; i += step) v += o[i] * o[i + L]; return v / (ac0 + 1e-6); };
    const longMatch = l => (longAt(4 * l) + longAt(8 * l) + longAt(16 * l)) / 3;
    let best = null; const all = [];
    for (const l of pool) {
      const base = localTempo(l), beats = beatDP(o, base, 120), s = score(beats), v = (s.q + 1.5 * Math.log2(60 * fps / l / 100) + 4 * longMatch(l)) * Math.pow(prior(l), 0.1);   // 느린 후보가 박마다 큰 소리만 골라 유리해지는 만큼 덜어 내고, 8·16박 뒤에도 곡이 맞물리는지 본다
      const gaps = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b), real = gaps.length ? gaps[gaps.length >> 1] : l;
      const it = { lag: l, real, beats, q: s.q, ratio: s.ratio, v };
      all.push(it);
      if (!best || v > best.v) best = it;
    }
    const others = all.filter(a => a !== best).sort((a, b) => b.v - a.v);
    // 구간별 박 확신도: 8초 창에서 박 자리와 박 사이의 대비
    const beats = best.beats, wf = Math.round(fps * 8), wins = Math.ceil(n / wf), on = new Float32Array(wins), off = new Float32Array(wins), cnt = new Float32Array(wins);
    for (let i = 0; i + 1 < beats.length; i++) { const w = Math.floor(beats[i] / wf); on[w] += o[beats[i]]; off[w] += o[Math.round((beats[i] + beats[i + 1]) / 2)]; cnt[w]++; }
    const local = new Float32Array(wins), wmean = new Float32Array(wins);
    for (let i = 0; i < n; i++) wmean[Math.floor(i / wf)] += o[i] / wf;
    let good = 0;
    for (let w = 0; w < wins; w++) { const min = 8 * fps / best.real * 0.5; local[w] = cnt[w] >= min ? (on[w] / cnt[w]) / (wmean[w] + 1e-3) : 0; if (local[w] >= BEAT_RATIO) good++; }
    return { o, beats, lag: best.real, alt: others.length ? others[0].real : 0, conf: good / wins, local, wf };
  }
  function findMeter(B, F, fps) {
    const bs = B.beats, c = bs.length;
    if (c < 32) return { meter: 4, conf: 0, phase: 0 };
    const a = new Float32Array(c);
    for (let i = 0; i < c; i++) { const f = bs[i]; let s = 0; for (let b = 0; b < 3; b++) s += Math.max(0, F.bands[f * BANDS + b] - F.bands[Math.max(0, f - 4) * BANDS + b]); a[i] = s + B.o[f]; }
    let m = 0; for (let i = 0; i < c; i++) m += a[i]; m /= c;
    const ac = l => { let s = 0, k = 0; for (let i = 0; i + l < c; i++) { s += (a[i] - m) * (a[i + l] - m); k++; } return s / k; };
    const v = { 2: ac(2), 3: ac(3), 4: ac(4) }, meter = v[3] > v[4] * 1.2 && v[3] > 0 ? 3 : 4, other = meter === 3 ? v[4] : v[3], top = Math.max(v[meter], 1e-6);
    let phase = 0, best = -1;
    for (let p = 0; p < meter; p++) { let s = 0, k = 0; for (let i = p; i < c; i += meter) { s += a[i]; k++; } s /= k; if (s > best) { best = s; phase = p; } }
    return { meter, conf: clamp((top - Math.max(other, 0)) / top, 0, 1), phase };
  }

  // ---------- 변화 ----------
  function gridded(F, floorDb) {
    const fp = Math.round(F.fps * GRID), g = Math.floor(F.n / fp), bands = new Float32Array(g * BANDS), chroma = new Float32Array(g * 12), loud = new Float32Array(g);
    for (let i = 0; i < g; i++) {
      for (let f = i * fp; f < (i + 1) * fp; f++) {
        for (let b = 0; b < BANDS; b++) bands[i * BANDS + b] += Math.max(F.bands[f * BANDS + b], floorDb) / fp;
        for (let c = 0; c < 12; c++) chroma[i * 12 + c] += F.chroma[f * 12 + c] / fp;
        loud[i] += Math.max(F.loud[f], floorDb) / fp;
      }
    }
    return { g, bands, chroma, loud, step: fp / F.fps };
  }
  function prefix(a, dim, g) { const c = new Float64Array((g + 1) * dim); for (let i = 0; i < g; i++) for (let d = 0; d < dim; d++) c[(i + 1) * dim + d] = c[i * dim + d] + a[i * dim + d]; return c; }
  function change(G, w) {
    const { g } = G, cb = prefix(G.bands, BANDS, g), cc = prefix(G.chroma, 12, g), nb = new Float32Array(g), nc = new Float32Array(g);
    for (let i = w; i < g - w; i++) {
      let s = 0;
      for (let d = 0; d < BANDS; d++) s += Math.abs((cb[(i + w) * BANDS + d] - cb[i * BANDS + d]) - (cb[i * BANDS + d] - cb[(i - w) * BANDS + d])) / w;
      nb[i] = s / BANDS;
      let dot = 0, na = 0, nd = 0;
      for (let d = 0; d < 12; d++) { const p = cc[i * 12 + d] - cc[(i - w) * 12 + d], q = cc[(i + w) * 12 + d] - cc[i * 12 + d]; dot += p * q; na += p * p; nd += q * q; }
      nc[i] = na > 0 && nd > 0 ? 1 - dot / Math.sqrt(na * nd) : 0;
    }
    return { nb, nc };
  }

  function analyze(input, inputSr, opts = {}) {
    const t0 = Date.now(), dec = Math.max(1, Math.round(inputSr / TARGET_SR)), x = decimate(input, dec), sr = inputSr / dec;
    const dur = x.length / sr, empty = status => ({ engine: 'songsync-1', status, duration: dur, tempo: 0, tempoAlt: 0, beatConf: 0, meter: 4, meterConf: 0, beats: [], downbeats: [], beatGaps: [], points: [], spans: [], moments: [], tension: [], rate: 2, fingerprint: fingerprint(x, sr), ms: Date.now() - t0 });
    if (dur < 6) return empty('flat');
    let rms = 0; for (let i = 0; i < x.length; i += 8) rms += x[i] * x[i];
    if (Math.sqrt(rms / (x.length / 8)) < 1e-4) return empty('flat');
    const F = features(x, sr), { fps } = F, ref = percentile(F.loud, 0.95), floorDb = ref - 50;
    const oRaw = onsetCurve(F, floorDb), B = trackBeats(oRaw, fps), Mt = B ? findMeter(B, F, fps) : { meter: 4, conf: 0, phase: 0 };
    const G = gridded(F, floorDb), { g, step: gStep } = G, gfps = 1 / gStep;
    // 위치는 변화량 봉우리로 잡고, 세기는 그 자리의 변화가 얼마나 급한지로 깎는다. 느리게 변하는 곳은 포인트가 아니라 흐름이다
    const win = sec => Math.round(sec / gStep), w4 = change(G, win(4)), w8 = change(G, win(8)), w1 = change(G, win(1)), wf = change(G, win(1.5)), combo = new Float32Array(g), S1 = win(1), S2 = win(1.2);
    for (let i = 0; i < g; i++) combo[i] = Math.max(w4.nb[i] / NB0 + w4.nc[i] / NC0, 0.85 * (w8.nb[i] / NB0 + w8.nc[i] / NC0));
    const sharpAt = i => { let m = 0; for (let j = Math.max(0, i - S1); j <= Math.min(g - 1, i + S1); j++) m = Math.max(m, w1.nb[j]); return clamp(m / (w4.nb[i] + 0.3), 0.15, 1); };
    // 시각 정밀화에 쓰는 소리 크기 변화
    const lsm = boxMean(F.loud, 2), slope = new Float32Array(F.n), ogm = boxMean(oRaw, 2);
    for (let f = 4; f < F.n; f++) slope[f] = lsm[f] - lsm[f - 4];
    const meanAt = (a, s, e) => { const p = clamp(Math.round(s * fps), 0, a.length - 1), q = clamp(Math.round(e * fps), p + 1, a.length); let v = 0; for (let i = p; i < q; i++) v += a[i]; return v / (q - p); };
    const hasBeat = t => { if (!B) return false; const w = Math.floor(t * fps / B.wf); return B.local[clamp(w, 0, B.local.length - 1)] >= BEAT_RATIO; };
    const snap = t => {
      if (!B || !hasBeat(t)) return t;
      const f = t * fps; let best = 1e9, v = t;
      for (let lo = 0, hi = B.beats.length - 1; lo <= hi;) { const m = (lo + hi) >> 1, d = B.beats[m] - f; if (Math.abs(d) < best) { best = Math.abs(d); v = B.beats[m] / fps; } if (d < 0) lo = m + 1; else hi = m - 1; }
      return Math.abs(v - t) <= 0.08 ? v : t;
    };
    const tension = tensionCurve(F, oRaw, ref, dur);
    const cand = [], R = Math.round(2 * gfps);
    for (let i = 2; i < g - 2; i++) {
      if (combo[i] < GATE_T2) continue;
      let top = true;
      for (let j = Math.max(0, i - R); j <= Math.min(g - 1, i + R) && top; j++) if (combo[j] > combo[i]) top = false;
      if (!top) continue;
      const strength = combo[i] * (0.35 + 0.65 * sharpAt(i));
      if (strength < GATE_T2) continue;
      // 긴 창의 봉우리는 뭉툭하다. 짧은 창에서 변화가 실제로 일어난 자리를 다시 찾는다
      let iF = i, fv = -1;
      for (let j = Math.max(0, i - S2); j <= Math.min(g - 1, i + S2); j++) { const v = (wf.nb[j] / NB0 + wf.nc[j] / NC0) * (1 - 0.5 * Math.abs(j - i) / S2); if (v > fv) { fv = v; iF = j; } }
      const tc = (iF + 0.5) * gStep, a = clamp(Math.round((tc - 0.5) * fps), 4, F.n - 1), b = clamp(Math.round((tc + 0.5) * fps), a + 1, F.n);
      let bv = -1, bf = Math.round(tc * fps);
      for (let f = a; f < b; f++) { const v = Math.max(ogm[f], -slope[f] * 0.5); if (v > bv) { bv = v; bf = f; } }
      const t = snap(bf / fps);
      if (t < 0.5 || t > dur - 1) continue;
      const pre = meanAt(F.loud, t - 2, t - 0.1), post = meanAt(F.loud, t + 0.1, t + 2), hush = meanAt(F.loud, t - 0.6, t - 0.05), up = post - pre;
      const ti = Math.round(t * 2), rise = ti > 16 ? (tension[Math.min(ti, tension.length - 1)] - tension[ti - 16]) : 0;
      const type = hush < ref - 28 && up > 3 ? 'resume' : up >= 8 || (up >= 4 && rise > 0.05) ? 'drop' : up <= -4 ? 'break' : up >= 2.5 ? 'entry' : 'section';
      let lead = 0;
      for (let j = ti; j > 1 && lead < 30; j--) { if (tension[j - 2] > tension[j] + 0.01) break; lead += 0.5; }
      cand.push({ t: +t.toFixed(3), c: strength, type, lead });
    }
    // 튀는 소리: 주변 20초 안에서 얼마나 솟았는가
    const mid = boxMean(oRaw, Math.round(fps * 10)), devi = new Float32Array(F.n);
    for (let i = 0; i < F.n; i++) devi[i] = Math.abs(oRaw[i] - mid[i]);
    const mad = boxMean(devi, Math.round(fps * 10)), madFloor = percentile(devi, 0.5) * 0.8 + 0.05, acc = [];
    const nms = Math.round(fps * 0.5);
    for (let f = 3; f < F.n - 3; f++) {
      const z = (oRaw[f] - mid[f]) / Math.max(mad[f], madFloor);
      if (z < 7 || oRaw[f] < 1.5) continue;
      let top = true;
      for (let j = Math.max(0, f - nms); j <= Math.min(F.n - 1, f + nms) && top; j++) if (oRaw[j] > oRaw[f]) top = false;
      if (top) acc.push({ t: +snap(f / fps).toFixed(3), z });
    }
    const points = [];
    const near = (t, gap, tier) => points.some(p => (tier == null || p.tier === tier) && Math.abs(p.t - t) < gap);
    const conf = c => +(1 - Math.exp(-c / 1.4)).toFixed(2);
    cand.sort((a, b) => b.c - a.c);
    for (const c of cand) if (c.c >= GATE_T1 && !near(c.t, 20, 1) && points.filter(p => p.tier === 1).length < 8) points.push({ t: c.t, tier: 1, type: c.type, conf: conf(c.c), lead: c.lead });
    for (const c of cand) if (!near(c.t, 4)) points.push({ t: c.t, tier: 2, type: c.type, conf: conf(c.c), lead: c.lead });
    acc.sort((a, b) => b.z - a.z);
    for (const a of acc) if (a.z >= 11 && !near(a.t, 4)) points.push({ t: a.t, tier: 2, type: 'accent', conf: +clamp(a.z / 24, 0.3, 0.9).toFixed(2), lead: 0 });
    const perMin = Math.ceil(dur / 60 * 60);
    let t3 = 0;
    for (const a of acc) if (t3 < perMin && !near(a.t, 0.5)) { points.push({ t: a.t, tier: 3, type: 'accent', conf: +clamp(a.z / 24, 0.2, 0.8).toFixed(2), lead: 0 }); t3++; }
    // 순간의 성격을 포인트에도 새긴다: 쿠앙은 큰 포인트로, 한 음은 중간 포인트로
    const moms = moments(F, oRaw, ref, floorDb, dur, B, tension, points);
    const leadAt = t => { let l = 0; for (let j = Math.round(t * 2); j > 1 && l < 30; j--) { if (tension[j - 2] > tension[j] + 0.01) break; l += 0.5; } return l; };
    for (const m of moms) {
      if (m.kind === 'impact') {
        const p1 = points.find(p => p.tier === 1 && Math.abs(p.t - m.t) < 0.35), p2 = points.find(p => p.tier === 2 && Math.abs(p.t - m.t) < 0.35);
        if (p1) p1.type = 'impact';
        else if (!near(m.t, 20, 1) && points.filter(p => p.tier === 1).length < 8) { if (p2) points.splice(points.indexOf(p2), 1); points.push({ t: m.t, tier: 1, type: 'impact', conf: m.conf, lead: leadAt(m.t) }); }
        else if (p2) p2.type = 'impact';
        else points.push({ t: m.t, tier: 2, type: 'impact', conf: m.conf, lead: leadAt(m.t) });
      } else if (m.kind === 'bloom' && !points.some(p => p.tier <= 2 && Math.abs(p.t - m.t) < 1)) points.push({ t: m.t, tier: 2, type: 'bloom', conf: m.conf, lead: 0 });
    }
    points.sort((a, b) => a.t - b.t);
    const spans = makeSpans(points, tension, dur);
    spanRich(F, spans, ref);
    for (const b of breaths(points, tension)) moms.push(b);   // 숨 고르기: 큰 터짐 뒤 긴장이 풀린 골짜기
    moms.sort((x, y) => x.t - y.t);
    const beats = B ? Array.from(B.beats).filter(f => B.local[Math.floor(f / B.wf)] >= BEAT_RATIO).map(f => +(f / fps).toFixed(3)) : [];   // 박이 또렷한 구간의 박만 내보낸다
    const beatGaps = [];
    if (B) for (let w = 0, s = -1; w <= B.local.length; w++) { const ok = w < B.local.length && B.local[w] >= BEAT_RATIO; if (!ok && s < 0) s = w; if (ok || w === B.local.length) { if (s >= 0 && !(!ok && w < B.local.length)) { beatGaps.push([+(s * B.wf / fps).toFixed(1), +Math.min(dur, w * B.wf / fps).toFixed(1)]); s = -1; } } }
    const down = B && Mt.conf > 0.3 ? beats.filter((_, i) => (i - Mt.phase) % Mt.meter === 0) : [];
    const major = points.filter(p => p.tier < 3).length;
    const status = major ? (B && B.conf >= 0.4 ? 'ok' : 'no_beat') : 'flat';
    return {
      engine: 'songsync-1', status, duration: +dur.toFixed(2), tempo: B ? +(60 * fps / B.lag).toFixed(1) : 0, tempoAlt: B && B.alt ? +(60 * fps / B.alt).toFixed(1) : 0,
      beatConf: B ? +B.conf.toFixed(2) : 0, meter: Mt.meter, meterConf: +Mt.conf.toFixed(2), beats, downbeats: down, beatGaps, points, spans, moments: moms, tension: Array.from(tension, v => +v.toFixed(3)), rate: 2, fingerprint: fingerprint(x, sr), ms: Date.now() - t0,
    };
  }

  // ---------- 순간의 성격 ----------
  // 광호님이 말한 네 가지를 잴 수 있는 값으로 옮겼다. 소리를 듣는 게 아니라 대역 세기·음높이·시간 간격으로 가른다
  //  grand  웅장함: 곡에서 가장 큰 쪽이고, 저음부터 고음까지 거의 모든 대역이 꽉 찬 채 6초 넘게 이어진다
  //  build  짠짜짠짜: 짧은 음이 초당 2~8번 고르게 반복되고 음높이가 거의 같다. 바로 뒤에 무언가 터지거나 계속 솟는다
  //  bloom  한 음: 주변이 비어 있는 데서 음높이가 또렷한 음 하나가 오래 울린다
  //  impact 쿠앙: 저음과 전 대역이 한꺼번에 뛰고, 그 울림이 1초 넘게 크게 남는다
  function moments(F, o, ref, floorDb, dur, B, tension, points) {
    const { n, fps, bands, chroma, loud } = F, fr = s => Math.round(s * fps), C = (v, a, b) => clamp(v, a, b);
    const mean = (a, f0, f1, dim = 1, d0 = 0, d1 = 0) => {
      const p = C(f0, 0, n - 1), q = C(f1, p + 1, n); let v = 0, k = 0;
      for (let f = p; f < q; f++) { if (dim === 1) v += a[f]; else for (let d = d0; d <= d1; d++) v += Math.max(a[f * dim + d], floorDb) / (d1 - d0 + 1); k++; }
      return k ? v / k : 0;
    };
    const bandM = (f0, f1, b0, b1) => mean(bands, f0, f1, BANDS, b0, b1);
    const chromaV = (f0, f1) => { const v = new Float32Array(12), p = C(f0, 0, n - 1), q = C(f1, p + 1, n); for (let f = p; f < q; f++) for (let c = 0; c < 12; c++) v[c] += chroma[f * 12 + c]; return v; };
    const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < 12; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x > 0 && y > 0 ? d / Math.sqrt(x * y) : 0; };
    const peakR = v => { let s = 0, m = 0; for (const x of v) { s += x; m = Math.max(m, x); } return s > 0 ? m / s : 0; };
    const L1 = boxMean(loud, fr(1)), tAt = t => tension[C(Math.round(t * 2), 0, tension.length - 1)] || 0;
    // 음의 머리(온셋 봉우리)
    const thr = percentile(o, 0.5), pk = [];
    for (let f = 3; f < n - 3; f++) { const v = o[f]; if (v > thr && v >= o[f - 1] && v >= o[f - 2] && v >= o[f - 3] && v > o[f + 1] && v > o[f + 2] && v > o[f + 3]) pk.push(f); }
    const out = [];

    // 쿵·쿠앙(11-03 광호님): 저음·중저음의 타격감 있는 드럼·퍼커션. 곡에서 손꼽히게 큰 저음 타격만 「쿠앙」으로 남긴다(매 타격은 실시간 반응이 맡는다)
    const oTop = percentile(o, 0.96), imp = [];
    for (const f of pk) {
      if (o[f] < oTop) continue;
      const pre = f - fr(0.4), pre1 = f - fr(0.05), on1 = f + fr(0.12);
      const lowJump = bandM(f, on1, 0, 2) - bandM(pre, pre1, 0, 2), hiJump = bandM(f, on1, 5, 7) - bandM(pre, pre1, 5, 7);
      if (lowJump < 8 || lowJump < hiJump) continue;                     // 저음 쪽이 더 크게 뛴 타격
      const ring = mean(loud, f + fr(0.6), f + fr(1.4)) - mean(loud, pre, pre1);
      imp.push({ f, s: 0.6 * C((lowJump - 8) / 12, 0, 1) + 0.25 * C(o[f] / (oTop * 3), 0, 1) + 0.15 * C(ring / 8, 0, 1) });
    }
    imp.sort((a, b) => b.s - a.s);
    for (const c of imp) { const t = c.f / fps; if (out.some(m => m.kind === 'impact' && Math.abs(m.t - t) < 8)) continue; out.push({ kind: 'impact', t: +t.toFixed(3), conf: +C(c.s, 0.3, 1).toFixed(2) }); }

    // 한 음
    const thrB = percentile(o, 0.6), blo = [];
    for (const f of pk) {
      const v = o[f]; if (v < thrB) continue;
      let iso = 0;
      for (let j = f - fr(1.2); j < f + fr(1); j++) if (j >= 0 && j < n && Math.abs(j - f) > fr(0.12)) iso = Math.max(iso, o[j]);
      if (iso > 0.4 * v) continue;
      const pr = peakR(chromaV(f + fr(0.08), f + fr(0.45)));
      const peakL = mean(loud, f, f + fr(0.15)), keep = mean(loud, f + fr(0.7), f + fr(1)), before = mean(loud, f - fr(1.5), f - fr(0.2));
      if (pr < 0.2 || keep < peakL - 8 || peakL - before < 4 || peakL < floorDb + 15) continue;
      blo.push({ f, s: 0.5 * C((pr - 0.2) / 0.25, 0, 1) + 0.3 * C(1 - iso / v / 0.4, 0, 1) + 0.2 * C((keep - peakL + 8) / 8, 0, 1) });
    }
    blo.sort((a, b) => b.s - a.s);
    for (const c of blo) { const t = c.f / fps; if (out.some(m => (m.kind === 'bloom' && Math.abs(m.t - t) < 6) || (m.kind === 'impact' && Math.abs(m.t - t) < 1))) continue; out.push({ kind: 'bloom', t: +t.toFixed(3), conf: +C(0.3 + 0.7 * c.s, 0.3, 1).toFixed(2) }); }

    // 짠짜짠짜: 3초 창을 0.5초씩 밀며 본다
    const thrR = percentile(o, 0.55), strong = pk.filter(f => o[f] >= thrR), beatGap = B ? B.lag / fps : 0.6;
    // 「곧 터진다」: 창이 끝나고 2.5초 안에 쿠앙·큰 포인트·드롭이 온다
    const burstAt = t => { const c = [...out.filter(m => m.kind === 'impact').map(m => m.t), ...points.filter(p => p.tier === 1 || p.type === 'drop').map(p => p.t)].filter(x => x >= t - 0.3 && x <= t + 2.5); return c.length ? Math.min(...c) : null; };
    const after = t => burstAt(t) != null;
    const hit = [];
    for (let s = 0; s + 3 <= dur; s += 0.5) {
      const a = fr(s), b = fr(s + 3), on = strong.filter(f => f >= a && f < b);
      if (on.length < 6 || on.length > 24) continue;
      const ioi = on.slice(1).map((f, i) => (f - on[i]) / fps), m = ioi.reduce((p, q) => p + q, 0) / ioi.length;
      const cv = Math.sqrt(ioi.reduce((p, q) => p + (q - m) * (q - m), 0) / ioi.length) / m;
      if (cv > 0.3 || m > beatGap * 1.15) continue;                    // 고르고, 박보다 촘촘하거나 같아야 한다
      let sim = 0; for (let i = 1; i < on.length; i++) sim += cos(chromaV(on[i - 1], on[i - 1] + fr(0.08)), chromaV(on[i], on[i] + fr(0.08)));
      sim /= on.length - 1;
      if (sim < 0.8) continue;                                          // 같은 음을 되풀이한다
      const rise = mean(loud, b - fr(0.8), b) - mean(loud, a, a + fr(0.8)), brightUp = mean(F.bright, b - fr(0.8), b) - mean(F.bright, a, a + fr(0.8));
      if (!(after(s + 3) && rise >= -1) && !(rise >= 5 && brightUp > 0)) continue;   // 곧 무언가 터지거나, 크게 솟아오를 때만
      hit.push({ s, e: s + 3, c: 0.4 * C((0.3 - cv) / 0.3, 0, 1) + 0.3 * C((sim - 0.8) / 0.2, 0, 1) + 0.3 * C(rise / 6, 0, 1) });
    }
    // 짠—짠—짠: 곡에서 손꼽히게 센 타격이 1.5~16초 동안 4번 넘게 고른 간격으로 되풀이되고, 타격 사이에 울림이 빠진다
    const pv = pk.map(f => o[f]), pTop = percentile(pv, 0.85), oMed = boxMean(o, fr(4));
    const st = pk.filter(f => o[f] >= pTop && o[f] >= 2.2 * oMed[f]);   // 곡 전체로도 주변 8초에 비해서도 튀는 타격
    const runs = [];
    for (let i = 0; i < st.length;) {                                   // 2.8초 안으로 이어진 사슬을 만들고, 다음 타격 전에 울림이 빠지지 않는 곳에서 끊는다
      let j = i; while (j + 1 < st.length && (st[j + 1] - st[j]) / fps <= 2.8) j++;
      const ch = st.slice(i, j + 1); i = j + 1;
      let cur = [];
      ch.forEach((f, k) => {
        const g = (k + 1 < ch.length ? ch[k + 1] : f + fr(1.5)) - f, dip = bandM(f, f + fr(0.1), 0, 2) - bandM(f + Math.round(g * 0.6), f + Math.round(g * 0.95), 0, 2);
        if (dip >= 6) cur.push(f); else { if (cur.length) { cur.push(f); runs.push(cur); } cur = []; }
      });
      if (cur.length) runs.push(cur);
    }
    for (const ch of runs) {
      const span = (ch[ch.length - 1] - ch[0]) / fps;
      if (typeof process !== 'undefined' && process.env && process.env.SS_DEBUG) console.log('  [타격 사슬]', (ch[0] / fps).toFixed(1), '~', (ch[ch.length - 1] / fps).toFixed(1), ch.length + '번');
      if (ch.length < 4 || span < 1.5 || span > 16) continue;
      const ioi = ch.slice(1).map((f, k) => (f - ch[k]) / fps), m = ioi.reduce((p, q) => p + q, 0) / ioi.length;
      const cv = Math.sqrt(ioi.reduce((p, q) => p + (q - m) * (q - m), 0) / ioi.length) / m;
      if (cv > 0.4) continue;
      let sim = 0, dip = 0;
      for (let k = 1; k < ch.length; k++) {
        sim += cos(chromaV(ch[k - 1], ch[k - 1] + fr(0.1)), chromaV(ch[k], ch[k] + fr(0.1)));
        const g = ch[k] - ch[k - 1]; dip += bandM(ch[k - 1], ch[k - 1] + fr(0.1), 0, 2) - bandM(ch[k - 1] + Math.round(g * 0.6), ch[k - 1] + Math.round(g * 0.95), 0, 2);
      }
      sim /= ch.length - 1; dip /= ch.length - 1;
      if (sim < 0.75) continue;                                         // 같은 화음을 되풀이한다
      const s = ch[0] / fps, e = ch[ch.length - 1] / fps, firstL = mean(loud, ch[0], ch[0] + fr(0.15)), lastL = mean(loud, ch[ch.length - 1], ch[ch.length - 1] + fr(0.15));
      if (!(after(e + 0.5) || lastL - firstL >= 1.5)) continue;         // 곧 무언가 터지거나 칠수록 커진다
      hit.push({ s, e: e + 0.4, c: 0.35 * C((0.4 - cv) / 0.4, 0, 1) + 0.35 * C((dip - 4) / 10, 0, 1) + 0.3 * C((sim - 0.75) / 0.25, 0, 1) });
    }
    hit.sort((a, b) => a.s - b.s);
    for (const h of hit) {                                              // 이어진 창은 한 구간으로
      const last = out[out.length - 1];
      if (last && last.kind === 'build' && h.s <= last.end) { last.end = +h.e.toFixed(2); last.conf = +Math.max(last.conf, C(0.4 + h.c * 0.6, 0.3, 1)).toFixed(2); }
      else out.push({ kind: 'build', t: +h.s.toFixed(2), end: +h.e.toFixed(2), conf: +C(0.4 + h.c * 0.6, 0.3, 1).toFixed(2) });
    }
    for (let i = out.length - 1; i >= 0; i--) {                         // 16초 넘게 이어지면 반복 그루브다. 터지는 곳이 있으면 거기서 끝낸다
      const m = out[i]; if (m.kind !== 'build') continue;
      if (m.end - m.t > 16) { out.splice(i, 1); continue; }
      const b = burstAt(m.end); if (b != null) { m.end = +b.toFixed(2); m.into = 1; }
    }

    // 웅장함(11-03 광호님 귀 확인으로 다시 정함): 저음·중저음이 길게 무드를 잇는 곳. 합창곡 1:38~1:49·3:15 정답에서
    // 가장 잘 가른 값 셋 = 중저음 지속분이 고음보다 두드러짐 · 저음 타격이 셈 · 고음이 가라앉음. 1초 칸, 앞뒤 2초 창, 곡 안 순위로 본다
    const B_ = (f, k) => Math.max(bands[f * BANDS + k], floorDb), win4 = (t, fn, p) => { const a = C(fr(t - 2), 0, n - 1), b = C(fr(t + 2), a + 1, n), v = []; for (let f = a; f < b; f++) v.push(fn(f)); v.sort((x, y) => x - y); return v[Math.floor(p * (v.length - 1))]; };
    const secs = [];
    for (let t = 2; t < dur - 2; t += 1) {
      const low2 = f => (B_(f, 0) + B_(f, 1)) / 2;
      secs.push({ t, tilt: win4(t, f => (B_(f, 2) + B_(f, 3)) / 2, 0.4) - win4(t, f => (B_(f, 5) + B_(f, 6) + B_(f, 7)) / 3, 0.5), hitL: win4(t, low2, 0.97) - win4(t, low2, 0.3), high: win4(t, f => (B_(f, 5) + B_(f, 6) + B_(f, 7)) / 3, 0.5) });
    }
    const rankOf = k => { const s = secs.map(r => r[k]).sort((a, b) => a - b); return v => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return 100 * lo / Math.max(1, s.length); }; };
    const rT = rankOf('tilt'), rH = rankOf('hitL'), rHi = rankOf('high');
    const G = secs.map(r => 0.45 * rT(r.tilt) + 0.35 * rH(r.hitL) + 0.2 * (100 - rHi(r.high)));
    const Gs = G.map((_, i) => { let s = 0, k = 0; for (let j = i - 2; j <= i + 2; j++) if (G[j] != null) { s += G[j]; k++; } return s / k; });
    for (let i = 0, s0 = -1, gap = 0; i <= Gs.length; i++) {
      const on = i < Gs.length && Gs[i] >= 66;
      if (on) { if (s0 < 0) s0 = i; gap = 0; continue; }
      if (s0 < 0) continue;
      if (i < Gs.length && ++gap <= 2) continue;
      const e = i - (i < Gs.length ? gap : 0);
      if (e - s0 >= 4) { let gv = 0; for (let k = s0; k < e; k++) gv += Gs[k]; out.push({ kind: 'grand', t: secs[s0].t - 0.5, end: Math.min(dur, secs[e - 1].t + 0.5), conf: +C((gv / (e - s0) - 60) / 25, 0.3, 1).toFixed(2) }); }
      s0 = -1; gap = 0;
    }
    const grands = out.filter(m => m.kind === 'grand');                 // 웅장함 안의 반복 타격은 웅장함의 일부다(합창곡 1:38~1:49 귀 확인)
    return out.filter(m => m.kind !== 'build' || !grands.some(g => Math.min(g.end, m.end) - Math.max(g.t, m.t) > 0.5 * (m.end - m.t))).sort((a, b) => a.t - b.t);
  }

  // 「숨 고르기」(11-05 광호님 「42dot VEC 45초 부분의 곡 느낌을 파악하고 다른 곡도 유사한 상황에」): 42dot VEC 45초는
  //   38.9초 첫 큰 터짐(drop, 긴장 0.85) 뒤 긴장이 0.63까지 풀린 골짜기이고, 46.5초 새 구간부터 다시 차오른다(→ 53초 쿵).
  //   큰 터짐(drop·impact, 1~2단) 뒤 3~12초 안에서 긴장이 가장 낮은 곳이 0.1 이상 풀렸고, 5초 뒤 다시 오르면 그 골짜기를 순간으로 낸다
  function breaths(points, tension) {
    const T = i => tension[Math.max(0, Math.min(tension.length - 1, i))], out = [];
    for (const d of points) {
      if (d.tier > 2 || (d.type !== 'drop' && d.type !== 'impact')) continue;
      const i0 = Math.round((d.t + 3) * 2), i1 = Math.min(tension.length - 11, Math.round((d.t + 12) * 2));
      if (i1 <= i0) continue;
      let bi = -1, bv = 9, peak = 0;
      for (let i = Math.round((d.t + 1) * 2); i <= i1; i++) peak = Math.max(peak, T(i));
      for (let i = i0; i <= i1; i++) if (T(i) < bv) { bv = T(i); bi = i; }
      if (bi < 0 || bi >= i1 - 1) continue;                       // 창 끝이면 아직 내려가는 중: 골짜기가 아니다
      const ease = peak - bv, rise = T(bi + 10) - bv, t = bi / 2;
      if (ease < 0.1 || rise < 0.05) continue;
      const next = points.some(p => p.t > t - 1 && p.t < t + 4 && p.tier <= 2 && p.type !== 'break'), gap = t - d.t;
      // 점수 = 42dot VEC 45초와 얼마나 닮았나(터짐 정점 0.85·풀린 폭 0.22·다시 오름 0.12·터짐 뒤 7초, 1단 터짐, 곧 새 구간)
      const sim = Math.exp(-0.5 * (((peak - 0.85) / 0.12) ** 2 + ((ease - 0.22) / 0.09) ** 2 + ((rise - 0.12) / 0.08) ** 2 + ((gap - 7) / 3) ** 2));
      const conf = clamp(0.25 + 0.55 * sim + (next ? 0.1 : 0) + (d.tier === 1 ? 0.1 : 0), 0, 1);
      const b = { kind: 'breath', t, conf: +conf.toFixed(2), from: d.t, f: [+peak.toFixed(2), +ease.toFixed(2), +rise.toFixed(2), +gap.toFixed(1)] };
      if (out.length && t - out[out.length - 1].t < 8) { if (conf > out[out.length - 1].conf) out[out.length - 1] = b; continue; }
      out.push(b);
    }
    return out;
  }
  function tensionCurve(F, o, ref, dur) {
    const { fps } = F, n = Math.floor(dur * 2), out = new Float32Array(n), r = Math.round(fps * 1.5), L = boxMean(F.loud, r), O = boxMean(o, r), Bt = boxMean(F.bright, r);
    const oTop = percentile(O, 0.95) + 1e-3, bLo = percentile(Bt, 0.05), bHi = percentile(Bt, 0.95) + 1e-3, base = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const f = clamp(Math.round(i / 2 * fps), 0, F.n - 1);
      base[i] = 0.6 * clamp((L[f] - ref + 30) / 30, 0, 1) + 0.25 * clamp(O[f] / oTop, 0, 1) + 0.15 * clamp((Bt[f] - bLo) / (bHi - bLo), 0, 1);
    }
    const s = boxMean(base, 4);
    for (let i = 0; i < n; i++) out[i] = clamp(s[i] + 0.8 * (i >= 40 ? s[i] - s[i - 40] : 0), 0, 1);
    return boxMean(out, 2);
  }
  function makeSpans(points, tension, dur) {
    const cuts = [0, ...points.filter(p => p.tier < 3 && p.type !== 'accent' && p.type !== 'bloom').map(p => p.t), dur], spans = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const s = cuts[i], e = cuts[i + 1];
      if (spans.length && e - spans[spans.length - 1].start < 8) { spans[spans.length - 1].end = e; continue; }
      spans.push({ start: +s.toFixed(2), end: +e.toFixed(2) });
    }
    for (const p of spans) { let v = 0, k = 0; for (let i = Math.round(p.start * 2); i < Math.round(p.end * 2) && i < tension.length; i++) { v += tension[i]; k++; } p.tension = +(k ? v / k : 0).toFixed(2); p.level = p.tension < 0.45 ? 'low' : p.tension < 0.7 ? 'mid' : 'high'; }
    return spans;
  }

  // 구간의 「다채로움」(11-05 광호님 「곡이 가장 다채롭게 전개되는 부분」): 1초 창마다 ① 화성이 얼마나 움직이나(크로마가 바뀌는 정도)
  //   ② 소리가 여러 음역에 고루 퍼졌나(대역 에너지의 고름) ③ 음색이 얼마나 바뀌나(밝기 흔들림)를 재서, 곡 안의 구간끼리 견줘 0~1 로 매긴다.
  //   조용해서 거의 안 들리는 창은 뺀다. 마지막에 긴장도를 조금 섞는다(다채로운데 너무 숨죽인 구간보다는 꽉 찬 구간 쪽으로)
  function spanRich(F, spans, ref) {
    const { fps, bands, chroma, loud, bright } = F, w = Math.max(1, Math.round(fps)), raw = [];
    for (const p of spans) {
      const f0 = Math.round(p.start * fps), f1 = Math.min(F.n, Math.round(p.end * fps)), wins = [];
      for (let f = f0; f + w <= f1; f += w) {
        let L = 0; for (let k = f; k < f + w; k++) L += loud[k]; L /= w;
        if (L < ref - 30) continue;
        const c = new Float32Array(12), e = new Float64Array(BANDS); let b = 0, b2 = 0;
        for (let k = f; k < f + w; k++) { for (let j = 0; j < 12; j++) c[j] += chroma[k * 12 + j]; for (let j = 0; j < BANDS; j++) e[j] += Math.pow(10, bands[k * BANDS + j] / 10); b += bright[k]; b2 += bright[k] * bright[k]; }
        let es = 0; for (let j = 0; j < BANDS; j++) es += e[j]; let ent = 0; for (let j = 0; j < BANDS; j++) { const q = e[j] / (es || 1); if (q > 0) ent -= q * Math.log(q); }
        b /= w; wins.push({ c, even: ent / Math.log(BANDS), bv: Math.sqrt(Math.max(0, b2 / w - b * b)), b });
      }
      let mv = 0, ev = 0, bvar = 0;
      for (let i = 0; i < wins.length; i++) {
        ev += wins[i].even; bvar += wins[i].bv;
        if (i) { const a = wins[i - 1].c, d = wins[i].c; let ab = 0, aa = 0, dd = 0; for (let j = 0; j < 12; j++) { ab += a[j] * d[j]; aa += a[j] * a[j]; dd += d[j] * d[j]; } mv += 1 - ab / (Math.sqrt(aa * dd) || 1); bvar += Math.abs(wins[i].b - wins[i - 1].b); }
      }
      const k = wins.length; raw.push(k >= 3 ? [mv / (k - 1), ev / k, bvar / k] : null);
    }
    const ok = raw.filter(Boolean), nz = j => { const v = ok.map(r => r[j]), lo = Math.min(...v), hi = Math.max(...v); return x => hi - lo > 1e-6 ? (x - lo) / (hi - lo) : 0.5; };
    const N = ok.length ? [nz(0), nz(1), nz(2)] : null;
    spans.forEach((p, i) => { const r = raw[i]; p.rich = r && N ? +(0.75 * (0.45 * N[0](r[0]) + 0.3 * N[1](r[1]) + 0.25 * N[2](r[2])) + 0.25 * p.tension).toFixed(2) : 0; });
  }

  // ---------- 곡 식별 ----------
  function fingerprint(x, sr) {
    const h = Math.round(sr / 20), n = Math.floor(x.length / h), e = new Int8Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < h; j += 4) s += x[i * h + j] * x[i * h + j]; e[i] = clamp(Math.round(5 * Math.log10(s + 1e-7)), -127, 127); }
    return Array.from(e);
  }
  function zoneMatch(a, b, s, len) {
    let best = -1, off = 0; const R = 40, scores = [];
    const mean = (x, p, q) => { let v = 0; for (let i = p; i < q; i++) v += x[i]; return v / (q - p); };
    const ma = mean(a, s, s + len);
    for (let d = -R; d <= R; d++) {
      if (s + d < 0 || s + d + len > b.length) { scores.push(-1); continue; }
      const mb = mean(b, s + d, s + d + len); let n = 0, p = 0, q = 0;
      for (let i = 0; i < len; i++) { const u = a[s + i] - ma, v = b[s + d + i] - mb; n += u * v; p += u * u; q += v * v; }
      const r = p > 0 && q > 0 ? n / Math.sqrt(p * q) : 0; scores.push(r);
      if (r > best) { best = r; off = d; }
    }
    const k = off + R, y0 = scores[k - 1], y1 = scores[k], y2 = scores[k + 1];
    const frac = y0 != null && y2 != null && y0 > -1 && y2 > -1 ? clamp(0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 || 1), -0.5, 0.5) : 0;
    return { r: best, off: (off + frac) * 0.05 };
  }
  function matchPrint(a, b) {                                     // 같은 곡인가, 시간은 얼마나 다른가
    const n = Math.min(a.length, b.length);
    if (n < 400 || Math.abs(a.length - b.length) > 60) return { same: false, offset: 0, r: 0 };
    const len = Math.floor(n / 6), z = [0.08, 0.31, 0.54, 0.77].map(p => zoneMatch(a, b, Math.floor(n * p), len));
    const offs = z.map(q => q.off), same = z.every(q => q.r >= 0.9) && Math.max(...offs) - Math.min(...offs) <= 0.1;
    return { same, offset: +(offs.reduce((p, q) => p + q, 0) / 4).toFixed(3), r: +Math.min(...z.map(q => q.r)).toFixed(3) };
  }

  // ---------- 편성 ----------
  function rng(seed) { let s = seed >>> 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // elements: { name, lead:[a,b], hold:[a,b], tail, wants:[...], tiers:[...], tension:[a,b], minGap, maxPerSong, alone, minConf, span, rich, richKeep, moments:['grand'|'build'|'bloom'|'impact'], climax }
  function plan(sync, elements, seed = 1) {
    const R = rng(seed), cues = [], dur = sync.duration, tensionAt = t => sync.tension[clamp(Math.round(t * 2), 0, sync.tension.length - 1)] || 0;
    const free = (start, end, alone, mix) => !cues.some(c => (alone || c.alone) && !(mix && mix.includes(c.element)) && start < c.end && end > c.start);   // mix: 함께 나와도 되는 요소(예: 물속 고래 + 하늘 오로라)
    const order = elements.slice().sort((a, b) => (b.lead[1] + (b.hold ? b.hold[1] : 0)) - (a.lead[1] + (a.hold ? a.hold[1] : 0)));
    for (const el of order) {
      const pick = [], tens = el.tension || [0, 1], minConf = el.minConf ?? 0.4, tail = el.tail || 0;
      for (const t0 of (el.fixed && sync.src && el.fixed[sync.src]) || []) {   // 곡마다 손으로 정한 시각(예: 42dot VEC 45초). 이 시각에 「보이기 시작」하도록 fixedLead 초 먼저 띄운다. 자동 후보보다 먼저
        const lead = el.lead[0] + R() * (el.lead[1] - el.lead[0]), hold = el.hold ? el.hold[0] + R() * (el.hold[1] - el.hold[0]) : 0, start = Math.max(0.5, t0 - (el.fixedLead ?? 0));
        pick.push({ start, peak: start + lead, end: Math.min(dur, start + lead + hold + tail), conf: 2, key: t0, fixed: true });
      }
      for (const m of (el.moments ? sync.moments || [] : [])) {         // 순간의 성격으로 고른다: 구간(웅장함·짠짜짠짜)은 그 안에서 차오르고, 점(한 음·쿠앙)은 그 시각이 정점
        if (!el.moments.includes(m.kind) || m.conf < minConf) continue;
        if (el.edge && (m.t < Math.min(el.edge[0], dur * 0.1) || m.t > dur - el.edge[1])) continue;   // 곡 도입·끝은 뺀다
        const lr = el.momentLead || el.lead, lead = lr[0] + R() * (lr[1] - lr[0]);
        if (m.end != null) { const peak = Math.min(m.end, m.t + lead); pick.push({ start: m.t, peak, end: Math.min(dur, m.end + tail), conf: m.conf, key: m.t }); }
        else if (m.t - lead >= 0.5) { const hold = el.hold ? el.hold[0] + R() * (el.hold[1] - el.hold[0]) : 0; pick.push({ start: m.t - lead, peak: m.t, end: Math.min(dur, m.t + hold + tail), conf: m.conf, key: m.t }); }
      }
      if (el.climax) {                                               // 클라이맥스 한 점(11-05 광호님 「음악의 가장 고조와 클라이맥스 순간」): 1단 타격(impact·drop) 가운데
        const G = (sync.moments || []).filter(m => m.kind === 'grand');  //   웅장한 구간 안에 있고, 곡 뒤쪽일수록, 확신이 클수록 높게 친다. 곡 앞 35%와 끝 el.edge[1]초는 뺀다
        for (const p of sync.points || []) {
          if (p.tier !== 1 || (p.type !== 'impact' && p.type !== 'drop') || p.t < dur * 0.35 || p.t > dur - (el.edge ? el.edge[1] : 8)) continue;
          const g = G.find(m => p.t >= m.t - 0.5 && p.t <= m.end + 0.5), lead = el.lead[0] + R() * (el.lead[1] - el.lead[0]), hold = el.hold ? el.hold[0] + R() * (el.hold[1] - el.hold[0]) : 0;
          if (p.t - lead < 0.5) continue;
          pick.push({ start: p.t - lead, peak: p.t, end: Math.min(dur, p.t + hold + tail), conf: +(p.conf + (g ? 0.4 + 0.3 * g.conf : 0) + 0.3 * p.t / dur).toFixed(3), key: p.t });
        }
      }
      if (el.rich) {                                                 // 곡에서 가장 다채로운 구간(spanRich)부터. 맨 위 구간의 richKeep 배 이상인 구간만 후보 → 한 곡에 1번, 비슷하게 다채로운 곳이 또 있으면 최대 maxPerSong
        const ranked = (sync.spans || []).filter(s => s.rich > 0 && s.end - s.start >= 3 && s.start >= Math.min(20, dur * 0.1) && s.start <= dur - 12)   // 짧은 구간도 된다(구간이 끝나도 제 흐름대로 지나간다). 곡 머리(도입)와 꼬리는 뺀다: 「전개되는」 부분
       .sort((a, b) => b.rich - a.rich);
        const top = ranked.length ? ranked[0].rich : 0;
        for (const s of ranked) {
          if (s.rich < top * (el.richKeep ?? 0.85)) break;
          const lead = el.lead[0] + R() * (el.lead[1] - el.lead[0]), hold = el.hold ? el.hold[0] + R() * (el.hold[1] - el.hold[0]) : 0, start = s.start + 0.5, peak = start + lead;
          pick.push({ start, peak, end: Math.min(dur, peak + hold + tail), conf: +((0.5 + 0.5 * s.rich / (top || 1)) * (el.richConf ?? 1)).toFixed(3), key: s.start });   // richConf: 다른 기준(순간)이 먼저일 때 낮춘다
        }
      } else if (el.span) {
        for (const s of sync.spans) {
          const len = s.end - s.start, hold = Math.min(el.hold[1], len - el.lead[0] - tail - 1);
          if (hold < el.hold[0] || s.tension < tens[0] || s.tension > tens[1]) continue;
          const lead = el.lead[0] + R() * (el.lead[1] - el.lead[0]), start = s.start + 0.5, peak = start + lead;
          pick.push({ start, peak, end: Math.min(peak + hold + tail, s.end - 0.5), conf: 0.7, key: s.start });
        }
      } else if (el.wants) {
        for (const p of sync.points) {
          if (!el.wants.includes(p.type) || !(el.tiers || [1, 2]).includes(p.tier) || p.conf < minConf) continue;
          const v = tensionAt(p.t);
          if (v < tens[0] || v > tens[1]) continue;
          const span = sync.spans.find(s => p.t >= s.start && p.t < s.end), lead = clamp(Math.max(p.lead, el.lead[0]), el.lead[0], el.lead[1]), start = p.t - lead;
          if (start < 0.5) continue;
          const hold = el.hold ? el.hold[0] + R() * (el.hold[1] - el.hold[0]) : 0, cap = el.hold && span ? Math.max(p.t + 1, Math.min(span.end - 0.5, p.t + hold)) : p.t + hold;
          pick.push({ start, peak: p.t, end: Math.min(dur, cap + tail), conf: p.conf, key: p.t });
        }
      }
      for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)), v = pick[i]; pick[i] = pick[j]; pick[j] = v; }
      pick.sort((a, b) => b.conf - a.conf);
      const mine = [];
      for (const c of pick) {
        if (mine.length >= (el.maxPerSong ?? 99)) break;
        if (mine.some(m => Math.abs(m.start - c.start) < (el.minGap ?? 0))) continue;
        if (!c.fixed && !free(c.start, c.end, el.alone, el.mix)) continue;   // 손으로 정한 시각은 다른 요소에 양보하지 않는다
        const q = { element: el.name, start: +c.start.toFixed(3), peak: +c.peak.toFixed(3), end: +c.end.toFixed(3), conf: c.conf, seed: Math.floor(R() * 1e6), alone: !!el.alone };
        mine.push(q); cues.push(q);
      }
    }
    return cues.sort((a, b) => a.start - b.start);
  }

  const api = { analyze, plan, matchPrint, fingerprint, _inner: { features, onsetCurve, percentile } };   // _inner 는 시험 도구용
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SongSync = api;
  if (typeof importScripts === 'function') {
    root.onmessage = e => {
      const { id, pcm, sr } = e.data;
      try { root.postMessage({ id, map: analyze(pcm, sr) }); } catch (err) { root.postMessage({ id, error: String(err) }); }
    };
  }
})(typeof self !== 'undefined' ? self : this);
