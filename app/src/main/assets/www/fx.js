// 추가 요소 틀: 음악 포인트에 맞춰 나타나는 요소(별똥별·오로라·은하물고기·해무)를 하나씩 따로 만들고 다듬는다.
// 지금 앱의 요소는 그대로 둔다. 각 요소는 자기 캔버스 한 장, 조정값 T, 싱크 조건표 sync 를 가진다.
// 기본은 전부 켜짐(11-03 광호님 「켜고 하나씩 다듬는다」), 플레오스판(?car=1)은 꺼짐
// 고르기: ?fx=meteor,fog · 끄기: ?fx=none · 시험장: ?lab=1 (조정판·타임라인·지금 보기)
// 좌표는 바다와 같다: 1단위 = 약 3.7m, 눈높이 .3, 초점 거리 = 화면 높이 H. 세계에 놓인 것은 내가 움직인 만큼 지나간다.
(function () {
  const q = new URLSearchParams(location.search), lab = q.has('lab');
  const pick = (q.get('fx') || (q.has('car') ? 'none' : 'all')).split(',').map(s => s.trim()).filter(Boolean);
  const HOLD = ['fog'];                                            // 잠시 빼 둔 요소: 'all' 에서도 꺼짐, ?fx=fog 로 따로 켤 수 있다(11-04 광호님 「해무는 일단 빼자」)
  const defs = [], byName = {};
  const STORE = 'vecFx.tune.v3';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { saved = {}; }
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const wall = () => performance.now() / 1000;
  const songPos = () => (window.vecSync ? vecSync.state().position : 0);
  const SLOT = { sky: 'g', sea: 'p', near: 'c' };               // 이 캔버스 바로 뒤에 끼운다. 정의 순서대로 쌓인다
  const lastIn = {};

  // ---------- 카메라 ----------
  // 화면 좌표 ↔ 세계 방향. vec.html 의 물방울·수면과 같은 식이다
  function cam(v) {
    const rc = Math.cos(v.roll), rs = Math.sin(v.roll), hc = Math.cos(v.head), hs = Math.sin(v.head);
    const wrapD = a => ((a % 1000) + 1500) % 1000 - 500;
    return {
      rc, rs, hc, hs,
      // 세계 위치(바다 좌표, y 는 수면 위 높이) → 카메라 기준 (오른쪽, 위, 앞)
      local(wx, wy, wz) { const ox = wrapD(wx - v.posX), oz = wrapD(wz - v.posZ); return [ox * hc + oz * hs, wy - 0.3, -ox * hs + oz * hc]; },
      // 세계 방향(먼 하늘) → 카메라 기준
      dir(dx, dy, dz) { return [dx * hc + dz * hs, dy, -dx * hs + dz * hc]; },
      // 카메라 기준 → 화면(CSS px). 뒤에 있으면 null
      screen(l) { if (l[2] < 0.05) return null; const qx = l[0] / l[2], qy = l[1] / l[2]; return [v.cx + (rc * qx + rs * qy) * v.H, v.cy - (-rs * qx + rc * qy) * v.H, l[2]]; },
      // 카메라 기준 → 세계(바다 좌표)
      world(l) { return [v.posX + l[0] * hc - l[2] * hs, l[1] + 0.3, v.posZ + l[0] * hs + l[2] * hc]; },
      // 세계 방위각 φ 의 수평 방향(φ = 진행 방향과 같은 규칙)
      bearing(phi) { return [-Math.sin(phi), 0, Math.cos(phi)]; },
    };
  }
  // 셰이더 쪽 같은 계산. uC·uH 는 이 캔버스 픽셀 기준(GL 은 아래가 0)
  const GLSL_CAM = `
  uniform vec2 uC,uRS,uHS,uPos;uniform float uH;
  vec3 fxLocal(vec2 f){vec2 ab=(f-uC)/uH;return vec3(uRS.x*ab.x-uRS.y*ab.y,uRS.y*ab.x+uRS.x*ab.y,1.);}
  vec3 fxWorldDir(vec3 l){return vec3(l.x*uHS.x-l.z*uHS.y,l.y,l.x*uHS.y+l.z*uHS.x);}
  vec3 fxRay(vec2 f){return normalize(fxWorldDir(fxLocal(f)));}`;
  function glCam(gl, U, L, v) {
    if (U.uC) gl.uniform2f(U.uC, v.cx * L.s, (v.H - v.cy) * L.s);
    if (U.uH) gl.uniform1f(U.uH, v.H * L.s);
    if (U.uRS) gl.uniform2f(U.uRS, Math.cos(v.roll), Math.sin(v.roll));
    if (U.uHS) gl.uniform2f(U.uHS, Math.cos(v.head), Math.sin(v.head));
    if (U.uPos) gl.uniform2f(U.uPos, v.posX, v.posZ);
  }
  function program(gl, vs, fs) {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const U = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); U[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
    return { p, U };
  }
  const VS_FULL = `#version 300 es
  void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;

  // ---------- 등록 ----------
  // def: { name, label, layer: { slot: 'sky'|'sea'|'near', ctx: 'webgl2'|'2d', scale, maxDpr, blend, depth },
  //        tune: { 키: [기본값, 최소, 최대, 간격, '이름'] }, sync: 편성 조건표, init(L), onCue(c, phase), draw(v, L, cues) }
  function define(def) {
    def.T = {}; def.cues = []; def.on = (pick.includes('all') && !HOLD.includes(def.name)) || pick.includes(def.name);
    for (const k in def.tune) def.T[k] = def.tune[k][0];
    def.sync0 = JSON.parse(JSON.stringify(def.sync));
    const s = saved[def.name];
    if (s) { Object.assign(def.T, s.T || {}); if (s.sync) Object.assign(def.sync, s.sync); if (s.on != null && lab) def.on = s.on; }
    defs.push(def); byName[def.name] = def;
    if (window.vecSync) {
      vecSync.cue(def.name, info => onSongCue(def, info));
      if (def.on) vecSync.register({ name: def.name, ...def.sync });
    }
    if (lab) labAdd(def);
  }
  function stage(c) {
    const t = c.clock === 'wall' ? wall() : songPos();
    return { t, age: t - c.start, toPeak: c.peak - t, left: c.end - t,
      a: clamp01((t - c.start) / Math.max(1e-3, c.peak - c.start)),      // 시작 → 정점
      b: clamp01((t - c.peak) / Math.max(1e-3, c.end - c.peak)),         // 정점 → 끝
      u: clamp01((t - c.start) / Math.max(1e-3, c.end - c.start)) };
  }
  function pointAt(t) {
    const m = window.vecSync && vecSync.map;
    if (!m) return null;
    let best = null;
    for (const p of m.points) if (Math.abs(p.t - t) < 0.06 && (!best || p.tier < best.tier)) best = p;
    return best;
  }
  // 11-05 광호님 「도착했을 때 물고기가 화면에 나와서 멈춰 있는데 등장하지 않는 게 좋겠다」: 도착 마무리에서 hush() 하면
  //   새 곡 큐는 받지 않고, 생물(물고기·고래)은 1.6초에 걸쳐 걷어 낸다. 메뉴로 갈 때 페이지를 새로 여니 되돌릴 필요는 없다
  let hushed = false;
  function hush(fade = ['fish', 'whale']) {
    hushed = true;
    for (const d of defs) if (fade.includes(d.name) && d.L) { d.L.canvas.style.transition = 'opacity 1.6s cubic-bezier(.4,0,.2,1)'; d.L.canvas.style.opacity = 0; }
  }
  // 한 번 주행 동안의 등장 횟수(11-05 광호님 「고래는 두 번 이상 나오지 않게, 처음부터 등장하지 않게」·「점프는 30분 주행에 두 번 정도」):
  //   def.budget = { 모드: { first: 시작 뒤 이만큼 지나야(초), gap: 앞 등장과 이만큼 떨어져야(초), max: 최대 횟수 } }. 적힌 모드에서만 센다
  function budgetOk(d, key) {
    const dv = window.vecDrive, r = d.budget && dv && d.budget[dv.mode]; if (!r) return true;
    const u = d.used || (d.used = { n: 0, last: -1e9, keys: new Set(), t0: dv.t0 }); if (u.t0 !== dv.t0) { u.n = 0; u.last = -1e9; u.keys.clear(); u.t0 = dv.t0; }
    if (u.keys.has(key)) return true;
    const el = (performance.now() - dv.t0) / 1000;
    if (u.n >= (r.max ?? 99) || el < (r.first || 0) || el - u.last < (r.gap || 0)) return false;
    u.n++; u.last = el; u.keys.add(key); return true;
  }
  function onSongCue(d, info) {
    if (hushed && (info.phase === 'start' || info.phase === 'resume')) return;
    if (window.vecDrive?.mode === 'atelier' && (info.phase === 'start' || info.phase === 'resume')) return;   // 11-07 광호님 「아틀리에에서는 저장된 연출 시퀀스를 해제」: 곡 분석으로 미리 짠 순서는 안 쓰고, 지금 들리는 소리로만(liveStep)
    const key = info.start + ':' + info.seed;
    if ((info.phase === 'start' || info.phase === 'resume') && !budgetOk(d, key)) return;
    if (info.phase === 'start' || info.phase === 'resume') {
      if (d.cues.some(c => c.key === key)) return;
      const p = pointAt(info.peak);
      const c = { key, element: d.name, start: info.start, peak: info.peak, end: info.end, conf: info.conf, seed: info.seed, clock: 'song', tier: p ? p.tier : 2, type: p ? p.type : 'span' };
      c.st = () => stage(c);
      d.cues.push(c);
      if (d.on && d.onCue) d.onCue(c, info.phase);
    } else {
      const i = d.cues.findIndex(c => c.key === key);
      if (i >= 0) { const c = d.cues[i]; d.cues.splice(i, 1); if (d.on && d.onCue) d.onCue(c, info.phase); }
    }
  }
  // 사운드 웨이브와 같은 빛깔(11-05 광호님 「고래·물고기 점을 사운드 웨이브 앨리먼트 컬러와 동일하게」): 가까이 = 하이라이트와 수평선 색을 섞은 색,
  //   멀리 = 광원 빛과 수평선 색. 색(빛깔)만 같게 하고 밝기는 lum 으로 맞춘다(웨이브는 더해지는 빛이라 그대로 쓰면 점이 어두워진다)
  function waveCol(v, lum = 0.92) {
    const p = v.pal, mx = (a, b, t) => a.map((x, j) => x + (b[j] - x) * t), nz = c => { const m = Math.max(...c, 1); return c.map(x => x / m * lum); };
    return { near: nz(mx(p.hi, p.hor, 0.72)), far: nz(mx(v.sunGlow || p.hi, p.hor, 0.82)) };
  }
  // 시험: 지금부터 한 번. 곡이 없어도 된다
  function test(name, tier = 1, leadSec) {
    const d = byName[name]; if (!d) return;
    const mid = r => (r ? (r[0] + r[1]) / 2 : 0), now = wall(), lead = leadSec ?? mid(d.sync.lead), hold = mid(d.sync.hold);
    const c = { key: 'test:' + now, element: name, start: now, peak: now + lead, end: now + lead + hold + (d.sync.tail || 0), conf: 1, seed: Math.floor(Math.random() * 1e6), clock: 'wall', tier, type: 'test' };
    c.st = () => stage(c);
    d.cues.push(c);
    if (d.onCue) d.onCue(c, 'start');
  }

  // ---------- 매 프레임 ----------
  function layerOf(d) {
    if (d.L || d.broken) return d.L;
    const cv = document.createElement('canvas');
    cv.dataset.fx = d.name;
    cv.style.cssText = `pointer-events:none;mix-blend-mode:${d.layer.blend || 'normal'}`;
    const anchor = lastIn[d.layer.slot] || document.getElementById(SLOT[d.layer.slot]);
    anchor.after(cv); lastIn[d.layer.slot] = cv;
    const L = { canvas: cv, s: 1, w: 0, h: 0 };
    if (d.layer.ctx === '2d') L.ctx = cv.getContext('2d');
    else L.gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: !!d.layer.aa, depth: !!d.layer.depth, preserveDrawingBuffer: !!d.layer.keep });   // keep: 앞 프레임을 지우지 않고 쌓는 층(오로라)
    if (!L.ctx && !L.gl) { d.broken = '이 기기에서 그래픽을 열 수 없음'; cv.remove(); return null; }
    try { d.init && d.init(L); } catch (e) { d.broken = String(e.message || e); console.warn(d.label, '준비 실패', e); cv.remove(); return null; }
    return (d.L = L);
  }
  function fit(d, L, v) {
    const s = (d.layer.scale || 1) * Math.min(v.DPR, d.layer.maxDpr || 2);
    const w = Math.max(2, Math.round(v.W * s)), h = Math.max(2, Math.round(v.H * s));
    if (w !== L.w || h !== L.h) { L.canvas.width = L.w = w; L.canvas.height = L.h = h; L.s = s; if (L.gl) L.gl.viewport(0, 0, w, h); d.resize && d.resize(L); }
  }
  // ---------- 실시간 소리 입력의 순간 감지(11-07 광호님 「아틀리에에서 컴퓨터 소리를 넣었을 때도 오로라·물고기 떼·고래가 나오게」) ----------
  //   곡 파일은 통째로 미리 분석해 순간보다 먼저 차오르지만, 실시간 소리는 앞날을 모른다. 그래서 지금까지 들은 소리로 순간을 「알아챈 뒤」 따라 나온다(2~3초 늦게).
  //   쓰는 값(vec.html 실시간 분석 mu): tens = 곡의 긴 평균보다 솟은 정도(0~1, 첫 12~40초는 파악 구간) · loudN = 지금 세기 · gate = 음악이 들리는지 · hit = 저음이 치고 들어오는 순간
  //   웅장함: tens 0.6 이상이 2.5초 넘게 이어짐(다시 잠잠해야 다음 번) · 클라이맥스: 들은 지 100초가 지나고, 지금까지 가장 센 웅장함
  //   숨 고름: 10초 안에 고조가 있었고 tens 0.15·세기 0.35 아래가 1.5초 · 쿠앙: 고조 중(tens 0.4 이상) 센 저음 타격(hit 0.75 이상)
  //   연출마다 곡 분석 때와 같은 규칙표(sync)로 고른다: moments 에 그 순간이 있거나, climax 를 원하거나, wants 에 impact 가 있으면. 모드별 등장 제한(budget)과 연출의 최소 간격(minGap)은 그대로 지킨다
  const LV = { t: 0, hi: 0, arm: true, quietT: 0, lastGrand: -1e9, lastLoud: -1e9, lowT: 0, lastBreath: -1e9, lastImp: -1e9, best: 0, lastClimax: -1e9, listen: 0, sum: 0, n: 0 };
  function liveFire(kind, conf) {
    const now = wall();
    if (location.search.includes('sync=debug')) console.log('실시간 순간', kind, conf.toFixed(2));
    for (const d of defs) {
      if (!d.on || d.broken || !d.sync) continue;
      const s = d.sync, want = kind === 'climax' ? !!s.climax : kind === 'impact' ? (s.wants || []).includes('impact') : (s.moments || []).includes(kind);
      if (!want || (s.minConf && conf < s.minConf * 0.9)) continue;
      if (hushed) continue;
      if (now - (d.liveLast || -1e9) < (s.minGap || 30)) continue;
      if (d.cues.some(c => c.end > now + 3)) continue;              // 11-07 광호님 「오로라가 너무 오래 떠 있다」: 하던 연출이 끝나기 전에 다시 불러 겹치면 내내 켜져 있었다 → 끝나 갈 때까지 새로 부르지 않는다
      const key = 'live:' + kind + ':' + Math.round(now);
      if (!budgetOk(d, key)) continue;
      d.liveLast = now;
      const mid = r => (r ? (r[0] + r[1]) / 2 : 0), lead = Math.min(mid(s.momentLead || s.lead), 6), hold = Math.min(mid(s.hold) || 8, 40);   // 실시간은 앞날을 몰라 길게 잡지 않는다(오로라 55초 → 40초)
      const c = { key, element: d.name, start: now, peak: now + lead, end: now + lead + hold + (s.tail || 0), conf, seed: Math.floor(Math.random() * 1e6), clock: 'wall', tier: 1, type: 'live-' + kind };
      c.st = () => stage(c);
      d.cues.push(c);
      if (d.onCue) d.onCue(c, 'start');
    }
  }
  function liveStep(v) {
    const mu = v.mu || {}, dt = Math.min(0.1, v.dt || 0.016);
    if (!v.live) { LV.listen = 0; LV.arm = true; LV.hi = 0; return; }
    const tens = mu.tens || 0, loud = mu.loudN || 0, gate = mu.gate == null ? 1 : mu.gate, now = wall();
    if (gate < 0.4) { LV.hi = 0; return; }                          // 음악이 안 들리면 세지 않는다
    LV.listen += dt;
    if (tens > 0.6) { LV.hi += dt; LV.sum += tens * dt; LV.lastLoud = now; } else { if (LV.hi > 0) { LV.hi = 0; LV.sum = 0; } }
    if (tens < 0.3) { LV.quietT += dt; if (LV.quietT > 4) LV.arm = true; } else LV.quietT = 0;
    if (LV.arm && LV.hi > 2.5) {                                    // 웅장함
      const conf = Math.min(1, LV.sum / LV.hi); LV.arm = false; LV.lastGrand = now;
      liveFire('grand', conf);
      if (LV.listen > 100 && conf >= LV.best * 0.98 && conf > 0.6 && now - LV.lastClimax > 480) { LV.lastClimax = now; liveFire('climax', conf); }   // 지금까지 가장 센 웅장함
      LV.best = Math.max(LV.best, conf);
    }
    if (now - LV.lastLoud < 10 && tens < 0.15 && loud < 0.35) { LV.lowT += dt; if (LV.lowT > 1.5 && now - LV.lastBreath > 20) { LV.lastBreath = now; liveFire('breath', 0.7); } } else LV.lowT = 0;   // 숨 고름
    if ((mu.hit || 0) > 0.75 && tens > 0.4 && now - LV.lastImp > 4) { LV.lastImp = now; liveFire('impact', Math.min(1, mu.hit)); }   // 쿠앙
  }

  function frame(v) {
    liveStep(v);
    if (v.live) for (const d of defs) for (let i = d.cues.length - 1; i >= 0; i--) {   // 11-07 광호님 「별똥별이 하늘에 고정된 채 있어」: 실시간 소리로 넘어가면 내장 곡이 멈춰
      const c = d.cues[i]; if (c.clock !== 'song') continue;        //   곡 시간에 묶인 연출이 그 자리에 굳었다 → 하던 연출은 실제 시간(벽시계)으로 옮겨 끝까지 잇는다
      const off = wall() - songPos(); c.start += off; c.peak += off; c.end += off; c.clock = 'wall';
      if (d.onCue) d.onCue(c, 'retime', off);
    }
    for (const d of defs) {
      if (!d.on || d.broken) { if (d.L) d.L.canvas.style.display = 'none'; continue; }
      const L = layerOf(d); if (!L) continue;
      L.canvas.style.display = '';
      fit(d, L, v);
      for (let i = d.cues.length - 1; i >= 0; i--) {                // 끝난 시험 큐와, 시계가 지나간 곡 큐를 걷어 낸다
        const c = d.cues[i], t = c.clock === 'wall' ? wall() : songPos();
        if (t > c.end + 0.5 || (c.clock === 'song' && t < c.start - 0.5)) { d.cues.splice(i, 1); if (d.onCue) d.onCue(c, 'end'); }
      }
      try { d.draw(v, L, d.cues); }
      catch (e) { d.broken = String(e.message || e); console.warn(d.label, '그리기 멈춤', e); }
    }
    if (lab) labFrame(v);
  }

  // ---------- 시험장 ----------
  let panel, tl, tlx, status;
  function persist() {
    try {
      const o = {};
      for (const d of defs) o[d.name] = { on: d.on, T: d.T, sync: d.sync };
      localStorage.setItem(STORE, JSON.stringify(o));
    } catch (e) { /* 저장이 막힌 창에서도 시험은 된다 */ }
  }
  let regT = 0;
  function reRegister(d) {
    clearTimeout(regT);
    regT = setTimeout(() => { if (window.vecSync && d.on) vecSync.register({ name: d.name, ...d.sync }); persist(); }, 350);
  }
  function el(tag, attrs, ...kids) { const e = document.createElement(tag); Object.assign(e, attrs || {}); kids.forEach(k => e.append(k)); return e; }
  function labInit() {
    if (panel) return;
    const css = document.createElement('style');
    css.textContent = `
    #fxLab{position:fixed;right:max(16px,env(safe-area-inset-right));top:62px;width:min(318px,calc(100vw - 32px));max-height:calc(100dvh - 150px);overflow:auto;z-index:20;
      padding:12px 14px;border-radius:14px;background:rgba(14,18,44,.72);border:1px solid rgba(255,230,220,.16);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      font:12px/1.5 system-ui,-apple-system,"Noto Sans KR",sans-serif;color:#f6efe9;font-weight:300;touch-action:auto;user-select:none}
    #fxLab.min>*:not(.hd){display:none}
    #fxLab .hd{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
    #fxLab .hd b{font-weight:400;font-size:13px;letter-spacing:.04em}
    #fxLab .st{color:#c3bdd3;font-size:11px;margin-bottom:8px;font-variant-numeric:tabular-nums}
    #fxLab details{border-top:1px solid rgba(255,230,220,.12);padding:8px 0 6px}
    #fxLab summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none}
    #fxLab summary::-webkit-details-marker{display:none}
    #fxLab summary .nm{flex:1;font-size:13px}
    #fxLab summary i{width:9px;height:9px;border-radius:50%;flex:none}
    #fxLab button{padding:4px 10px;font-size:11px;border-radius:999px}
    #fxLab .row{display:grid;grid-template-columns:88px 1fr 42px;align-items:center;gap:8px;margin:5px 0}
    #fxLab .row span{color:#c3bdd3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #fxLab .row output{text-align:right;font-variant-numeric:tabular-nums}
    #fxLab input[type=range]{width:100%;accent-color:#ffb8a6}
    #fxLab input[type=checkbox]{accent-color:#ffb8a6;margin:0}
    #fxLab .tm{display:grid;grid-template-columns:88px 1fr 1fr;gap:6px;align-items:center;margin:4px 0}
    #fxLab .tm span{color:#c3bdd3}
    #fxLab input[type=number]{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,230,220,.18);border-radius:6px;color:#f6efe9;font:inherit;padding:2px 6px}
    #fxLab h4{margin:8px 0 2px;font-weight:400;font-size:11px;color:#ffd2c4;letter-spacing:.06em}
    #fxLab .err{color:#ffb0a0}
    #fxTl{position:fixed;left:max(16px,env(safe-area-inset-left));right:max(16px,env(safe-area-inset-right));top:10px;height:44px;z-index:19;border-radius:10px;
      background:rgba(14,18,44,.6);border:1px solid rgba(255,230,220,.14);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);cursor:pointer;touch-action:none}`;
    document.head.append(css);
    status = el('div', { className: 'st' });
    const min = el('button', { textContent: '접기', onclick: () => { panel.classList.toggle('min'); min.textContent = panel.classList.contains('min') ? '펴기' : '접기'; } });
    const copy = el('button', { textContent: '값 복사', onclick: () => {
      const o = {}; for (const d of defs) o[d.name] = { T: d.T, sync: d.sync };
      navigator.clipboard?.writeText(JSON.stringify(o, null, 1)).then(() => { copy.textContent = '복사됨'; setTimeout(() => (copy.textContent = '값 복사'), 1200); }, () => {});
    } });
    panel = el('div', { id: 'fxLab' }, el('div', { className: 'hd' }, el('b', { textContent: '추가 요소 시험장' }), el('span', {}, copy, ' ', min)), status);
    ['pointerdown', 'click', 'keydown', 'wheel', 'touchstart'].forEach(t => panel.addEventListener(t, e => e.stopPropagation()));
    document.body.append(panel);
    tl = el('canvas', { id: 'fxTl', title: '곡 지도: 누르면 그 자리로 이동' });
    tlx = tl.getContext('2d');
    ['pointerdown', 'click'].forEach(t => tl.addEventListener(t, e => e.stopPropagation()));
    tl.addEventListener('pointerdown', e => {
      const m = window.vecSync && vecSync.map, a = document.getElementById('music');
      if (!m || !a) return;
      const r = tl.getBoundingClientRect();
      a.currentTime = Math.max(0, Math.min(m.duration - 0.5, (e.clientX - r.left) / r.width * m.duration));
    });
    document.body.append(tl);
    labMoments();
    addEventListener('keydown', e => {                               // Shift + 1~9: 요소를 지금 한 번
      if (!e.shiftKey) return;
      const i = parseInt(e.code.replace('Digit', ''), 10) - 1;
      if (defs[i]) { test(defs[i].name); e.preventDefault(); }
    });
  }
  // 찾은 순간 귀로 확인: 엔진이 고른 웅장함·짠짜짠짜·한 음·쿠앙을 들어 보고 맞다/아니다를 남긴다. 놓친 곳은 그 자리에서 표시한다
  const KIND = { grand: ['웅장함', '#e8c15a'], build: ['짠짜짠짜', '#8fe08a'], bloom: ['한 음', '#8fd8f0'], impact: ['쿠앙', '#ff7a6a'] };
  const LSTORE = 'vecFx.labels.v1';
  let labels = {}, momBox, momMap = null;
  try { labels = JSON.parse(localStorage.getItem(LSTORE) || '{}') || {}; } catch (e) { labels = {}; }
  const songKey = () => { const a = document.getElementById('music'); return a ? (a.currentSrc || a.src).split('/').pop() : '-'; };
  const saveLabels = () => { try { localStorage.setItem(LSTORE, JSON.stringify(labels)); } catch (e) { /* 저장이 막혀도 이번 화면에선 남는다 */ } };
  const mmss = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  function playAt(t) { const a = document.getElementById('music'); if (!a) return; a.currentTime = Math.max(0, t); if (a.paused) a.play().catch(() => {}); }
  function labMoments() {
    momBox = el('details', { open: true }, el('summary', {}, el('span', { className: 'nm', textContent: '찾은 순간 · 귀로 확인' })));
    const mark = el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin:6px 0' }, el('span', { textContent: '지금 여기가', style: 'color:#c3bdd3;align-self:center;margin-right:2px' }));
    for (const k in KIND) mark.append(el('button', { textContent: KIND[k][0], onclick: e => {
      e.preventDefault();
      const key = songKey(), t = +songPos().toFixed(2);
      (labels[key] = labels[key] || { judged: {}, added: [] }).added.push({ kind: k, t });
      saveLabels(); momMap = null;
    } }));
    const copy = el('button', { textContent: '귀 확인 복사', onclick: e => {
      e.preventDefault();
      navigator.clipboard?.writeText(JSON.stringify(labels, null, 1)).then(() => { copy.textContent = '복사됨'; setTimeout(() => (copy.textContent = '귀 확인 복사'), 1200); }, () => {});
    } });
    momBox.append(el('div', { style: 'color:#c3bdd3;font-size:11px;margin:4px 0' , textContent: '「듣기」는 3초 전부터 틉니다. 맞으면 ○, 아니면 ×. 놓친 곳은 그 순간에 아래 버튼을 누르세요.' }), mark, el('div', { className: 'ml' }), el('div', { style: 'margin-top:6px' }, copy));
    panel.append(momBox);
  }
  function labMomentList() {
    const m = window.vecSync && vecSync.map;
    if (!momBox || m === momMap) return;
    momMap = m;
    const box = momBox.querySelector('.ml'); box.textContent = '';
    if (!m || !m.moments) { box.textContent = '곡 분석이 끝나면 나옵니다'; return; }
    const key = songKey(), L = labels[key] = labels[key] || { judged: {}, added: [] };
    const all = [...m.moments.map(x => ({ ...x, src: 'engine' })), ...L.added.map(x => ({ ...x, src: 'me' }))].sort((a, b) => a.t - b.t);
    if (!all.length) { box.textContent = '이 곡에서는 아직 못 찾았습니다'; return; }
    for (const x of all) {
      const id = `${x.kind}@${x.t}`, j = L.judged[id], [nm, col] = KIND[x.kind];
      const row = el('div', { style: 'display:grid;grid-template-columns:10px 92px 1fr auto;gap:6px;align-items:center;margin:3px 0' });
      const dot = el('i', { style: `width:8px;height:8px;border-radius:50%;background:${col}` });
      const tx = el('span', { textContent: x.end != null ? `${mmss(x.t)}~${mmss(x.end)}` : mmss(x.t), style: 'font-variant-numeric:tabular-nums' });
      const lab = el('span', { textContent: nm + (x.src === 'me' ? ' (내 표시)' : ` ${Math.round(x.conf * 100)}%`), style: 'color:#c3bdd3' });
      const bt = el('span', { style: 'display:flex;gap:3px' });
      bt.append(el('button', { textContent: '듣기', onclick: e => { e.preventDefault(); playAt(x.t - 3); } }));
      if (x.src === 'engine') for (const [v, s] of [[1, '○'], [0, '×']]) {
        const b = el('button', { textContent: s, onclick: e => { e.preventDefault(); L.judged[id] = L.judged[id] === v ? undefined : v; saveLabels(); momMap = null; } });
        if (j === v) b.classList.add('on');
        bt.append(b);
      } else bt.append(el('button', { textContent: '지우기', onclick: e => { e.preventDefault(); L.added = L.added.filter(q => q !== L.added.find(r => r.kind === x.kind && r.t === x.t)); saveLabels(); momMap = null; } }));
      row.append(dot, tx, lab, bt); box.append(row);
    }
  }
  function labAdd(d) {
    labInit();
    const sw = el('input', { type: 'checkbox', checked: d.on, title: '켜기', onchange: () => {
      d.on = sw.checked;
      if (window.vecSync) vecSync.register({ name: d.name, ...d.sync, maxPerSong: d.on ? d.sync.maxPerSong : 0 });
      if (!d.on) d.cues.length = 0;
      persist();
    } });
    const now = el('button', { textContent: '지금', title: '지금 한 번 보여 준다', onclick: e => { e.preventDefault(); test(d.name); } });
    const nxt = el('button', { textContent: '다음 큐', title: '곡에서 이 요소가 다음에 나오는 곳 1초 전으로', onclick: e => {
      e.preventDefault();
      const a = document.getElementById('music'); if (!a || !window.vecSync) return;
      const t = songPos(), c = vecSync.cues.find(x => x.element === d.name && x.start > t + 0.5) || vecSync.cues.find(x => x.element === d.name);
      if (c) { a.currentTime = Math.max(0, c.start - 1); if (a.paused) a.play().catch(() => {}); }
    } });
    const dot = el('i'); dot.style.background = d.color || '#ffd2c4';
    const box = el('details', {}, el('summary', {}, sw, dot, el('span', { className: 'nm', textContent: d.label }), now, ' ', nxt));
    d.labErr = el('div', { className: 'err' });
    box.append(d.labErr);
    box.append(el('h4', { textContent: '모습' }));
    for (const k in d.tune) {
      const [, lo, hi, step, name] = d.tune[k];
      const out = el('output', { textContent: (+d.T[k]).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0) });
      const r = el('input', { type: 'range', min: lo, max: hi, step, value: d.T[k], oninput: () => { d.T[k] = +r.value; out.textContent = (+r.value).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0); persist(); } });
      box.append(el('label', { className: 'row' }, el('span', { textContent: name, title: name }), r, out));
    }
    box.append(el('h4', { textContent: '타이밍(초)' }));
    const SN = { lead: '앞서 시작', momentLead: '웅장함에 앞서', hold: '머무름', tension: '긴장 범위', tail: '사라짐', minGap: '최소 간격', maxPerSong: '곡당 최대', minConf: '최소 확신도' };
    for (const k of Object.keys(SN)) {
      if (!(k in d.sync)) continue;
      const v = d.sync[k], pair = Array.isArray(v);
      const mk = i => el('input', { type: 'number', step: k === 'tension' || k === 'minConf' ? 0.05 : 0.1, value: pair ? v[i] : v, onchange: e => {
        const n = +e.target.value; if (pair) d.sync[k][i] = n; else d.sync[k] = n; reRegister(d);
      } });
      box.append(el('div', { className: 'tm' }, el('span', { textContent: SN[k] }), mk(0), pair ? mk(1) : el('span')));
    }
    const reset = el('button', { textContent: '기본값으로', onclick: e => {
      e.preventDefault();
      for (const k in d.tune) d.T[k] = d.tune[k][0];
      d.sync = JSON.parse(JSON.stringify(d.sync0));
      persist(); location.reload();
    } });
    box.append(el('div', { style: 'margin-top:6px' }, reset));
    panel.append(box);
  }
  let labT = 0;
  function labFrame(v) {
    if (v.now - labT < 100) return;
    labT = v.now;
    const s = window.vecSync ? vecSync.state() : null, m = window.vecSync && vecSync.map;
    const SAY = { idle: '대기', loading: '곡 받는 중', decoding: '곡 푸는 중', analyzing: '분석 중', ok: '분석 끝', flat: '변화가 적은 곡', no_beat: '박이 없는 곡', too_long: '15분 넘는 곡', failed: '분석 실패' };
    status.textContent = s ? `${SAY[s.status] || s.status}${m ? ` · ${Math.round(m.tempo)} BPM · 포인트 ${m.points.filter(p => p.tier < 3).length} · 큐 ${s.cues}` : ''} · Shift+숫자 = 지금` : '싱크 엔진 없음';
    for (const d of defs) if (d.labErr) d.labErr.textContent = d.broken ? '멈춤: ' + d.broken : '';
    labMomentList();
    // 타임라인: 위 = 포인트(T1 길게, T2 짧게), 아래 = 요소별 큐 띠, 흰 줄 = 지금
    const r = tl.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (tl.width !== Math.round(r.width * dpr)) { tl.width = Math.round(r.width * dpr); tl.height = Math.round(r.height * dpr); }
    const W = tl.width, H = tl.height, x = t => t / m.duration * W;
    tlx.clearRect(0, 0, W, H);
    if (!m || !m.duration) { tlx.fillStyle = 'rgba(195,189,211,.8)'; tlx.font = `${11 * dpr}px system-ui`; tlx.fillText('곡을 재생하면 분석 뒤 곡 지도가 나옵니다', 10 * dpr, H / 2 + 4 * dpr); return; }
    if (m.tension && m.tension.length) {                              // 긴장 곡선
      tlx.beginPath();
      m.tension.forEach((tv, i) => { const px = x(i / (m.rate || 2)), py = H * 0.42 - tv * H * 0.34; i ? tlx.lineTo(px, py) : tlx.moveTo(px, py); });
      tlx.strokeStyle = 'rgba(255,210,196,.35)'; tlx.lineWidth = dpr; tlx.stroke();
    }
    for (const p of m.points) {
      if (p.tier > 2) continue;
      tlx.fillStyle = p.tier === 1 ? 'rgba(255,236,226,.95)' : 'rgba(255,236,226,.5)';
      tlx.fillRect(x(p.t) - dpr * 0.5, p.tier === 1 ? 2 * dpr : H * 0.18, dpr * (p.tier === 1 ? 2 : 1), p.tier === 1 ? H * 0.42 : H * 0.26);
    }
    for (const k of m.moments || []) {                                // 순간의 성격: 웅장함 금색 띠(위), 짠짜짠짜 초록 띠, 한 음 하늘색, 쿠앙 빨강
      tlx.fillStyle = KIND[k.kind][1];
      if (k.kind === 'grand') tlx.fillRect(x(k.t), 0, Math.max(2, x(k.end) - x(k.t)), 3 * dpr);
      else if (k.kind === 'build') tlx.fillRect(x(k.t), H * 0.44, Math.max(2, x(k.end) - x(k.t)), 3 * dpr);
      else if (k.kind === 'impact') tlx.fillRect(x(k.t) - dpr, 0, 3 * dpr, H * 0.5);
      else { tlx.beginPath(); tlx.arc(x(k.t), H * 0.3, 3 * dpr, 0, 6.2832); tlx.fill(); }
    }
    const lb = labels[songKey()];
    if (lb) for (const a of lb.added) { tlx.fillStyle = KIND[a.kind][1]; tlx.beginPath(); tlx.moveTo(x(a.t), H * 0.06); tlx.lineTo(x(a.t) - 4 * dpr, 0); tlx.lineTo(x(a.t) + 4 * dpr, 0); tlx.fill(); }
    const rows = defs.filter(d => d.on), rh = (H * 0.46) / Math.max(1, rows.length);
    rows.forEach((d, i) => {
      tlx.fillStyle = d.color || '#ffd2c4';
      for (const c of vecSync.cues) if (c.element === d.name) {
        const y = H * 0.5 + i * rh + 1;
        tlx.globalAlpha = 0.35; tlx.fillRect(x(c.start), y, Math.max(2, x(c.end) - x(c.start)), rh - 2);
        tlx.globalAlpha = 1; tlx.fillRect(x(c.peak) - dpr, y, 2 * dpr, rh - 2);
      }
    });
    tlx.globalAlpha = 1;
    tlx.fillStyle = '#fff'; tlx.fillRect(x(s.position) - dpr * 0.5, 0, dpr * 1.5, H);
  }

  window.vecFx = { define, frame, test, hush, waveCol, cam, glCam, program, GLSL_CAM, VS_FULL, has: n => !!(byName[n] && byName[n].on && !byName[n].broken), get list() { return defs; }, lab };
})();
