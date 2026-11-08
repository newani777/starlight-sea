// 음악 싱크 입구: 재생 중인 곡을 분석해 추가 앨리먼트에 포인트와 큐를 알린다. 지금 앱의 요소는 쓰지 않는다
(function () {
  const LEAD = 0.03, MAX_SEC = 15 * 60, TARGET = 22050;      // 영상이 소리보다 살짝 먼저 닿게 한다
  const q = new URLSearchParams(location.search), debug = q.get('sync') === 'debug';
  const S = { audio: null, latency: () => 0, offset: +(q.get('syncOffset') || 0), map: null, status: 'idle', job: 0, worker: null, elements: [], cues: [], active: new Map(), last: -1, pi: 0, seed: 1, hidden: false };
  const pointFns = [], cueFns = {};
  const pos = () => (S.audio ? S.audio.currentTime - S.latency() + S.offset + LEAD : 0);

  async function toMono(buf) {
    const dec = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf);
    if (dec.duration > MAX_SEC) return null;
    const n = Math.ceil(dec.duration * TARGET), off = new OfflineAudioContext(1, n, TARGET), src = off.createBufferSource();
    src.buffer = dec; src.connect(off.destination); src.start();
    return (await off.startRendering()).getChannelData(0);
  }
  function worker() {
    if (!S.worker) S.worker = new Worker('songsync.js');
    return S.worker;
  }
  async function load(url) {
    const job = ++S.job;                                        // 곡이 바뀌면 진행 중 결과를 버린다
    S.url = new URL(url, location.href).href;
    S.map = null; S.cues = []; S.active.clear(); S.status = 'loading'; S.last = -1; S.pi = 0;
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      if (job !== S.job) return;
      S.status = 'decoding';
      const pcm = await toMono(buf);
      if (job !== S.job) return;
      if (!pcm) { S.status = 'too_long'; return; }
      S.status = 'analyzing';
      const w = worker(), copy = pcm.slice();
      w.onmessage = e => {
        if (e.data.id !== job || job !== S.job) return;
        if (e.data.error) { S.status = 'failed'; console.warn('곡 분석 실패', e.data.error); return; }
        S.map = e.data.map; S.status = S.map.status;
        replan();
      };
      w.postMessage({ id: job, pcm: copy, sr: TARGET }, [copy.buffer]);
    } catch (err) { if (job === S.job) { S.status = 'failed'; console.warn('곡 분석 실패', err); } }
  }
  function replan() {
    if (!S.map || !self.SongSync) return;
    S.seed = Math.floor(Math.random() * 1e9);
    S.map.src = decodeURIComponent((S.url || '').split('?')[0].split('/').pop());   // 곡 파일 이름: 곡마다 손으로 정한 시각(fixed)을 찾는 데 쓴다
    S.cues = S.elements.length ? SongSync.plan(S.map, S.elements, S.seed) : [];
    S.active.clear(); reindex(pos());
  }
  function reindex(t) {                                         // 시크와 복귀: 지난 것은 몰아서 내지 않고, 진행 중인 큐는 그 지점부터 잇는다
    const pts = S.map ? S.map.points : [];
    S.pi = pts.findIndex(p => p.t > t); if (S.pi < 0) S.pi = pts.length;
    for (const [c, on] of S.active) if (t < c.start || t >= c.end) { S.active.delete(c); emitCue(c, 'cancel', t); }
    for (const c of S.cues) if (t >= c.start && t < c.end && !S.active.has(c)) { S.active.set(c, true); emitCue(c, 'resume', t); }
  }
  function emitCue(c, phase, t) {
    const span = c.end - c.start, info = { ...c, phase, progress: Math.min(1, Math.max(0, (t - c.start) / span)) };
    (cueFns[c.element] || []).forEach(f => f(info));
    if (debug) note(`${c.element} ${phase}`);
  }
  function step() {
    // 11-09 플레오스 최적화: 차량판이 주행 중 화면을 쉴 때(window.vecCarHide)는 초당 10번만 깨어난다(매 장 화면 갱신 요청을 하지 않는다). 웹은 예전 그대로
    if (window.vecCarHide) setTimeout(() => requestAnimationFrame(step), 100); else requestAnimationFrame(step);
    if (!S.audio || !S.map) return tag();
    const t = pos(), jump = S.last < 0 || t < S.last - 0.02 || t > S.last + 0.5;
    if (jump) reindex(t);
    else if (!S.audio.paused) {
      const pts = S.map.points;
      while (S.pi < pts.length && pts[S.pi].t <= t) { const p = pts[S.pi++]; pointFns.forEach(f => f(p)); if (debug && p.tier < 3) note(`T${p.tier} ${p.type} ${p.conf}`); }
      for (const c of S.cues) {
        if (!S.active.has(c) && t >= c.start && t < c.end) { S.active.set(c, true); emitCue(c, 'start', t); }
        else if (S.active.has(c) && t >= c.end) { S.active.delete(c); emitCue(c, 'end', t); }
      }
    }
    S.last = t; tag();
  }
  // 시험 표시: 앨리먼트가 생기기 전까지 발동을 눈으로 확인한다. ?sync=debug 일 때만 보인다
  let box = null, msg = [];
  function note(s) { msg.unshift(s); msg = msg.slice(0, 4); }
  function tag() {
    if (!debug) return;
    if (!box) { box = document.createElement('div'); box.style.cssText = 'position:fixed;right:12px;top:12px;z-index:50;padding:8px 12px;font:12px/1.5 "Malgun Gothic",sans-serif;color:#e8ecf4;background:rgba(12,18,40,.72);border-radius:6px;pointer-events:none;white-space:pre'; document.body.append(box); }
    const m = S.map, n = next(2);
    box.textContent = `싱크 ${S.status}${m ? ` · ${Math.round(m.tempo)} BPM · 주요 ${m.points.filter(p => p.tier < 3).length}개` : ''}\n다음 ${n ? `${n.point.type} ${n.in.toFixed(1)}초 뒤` : '-'}\n${msg.join('\n')}`;
  }
  function next(tier = 3) {
    if (!S.map) return null;
    const t = pos(), p = S.map.points.find(x => x.t > t && x.tier <= tier);
    return p ? { point: p, in: p.t - t } : null;
  }
  // ---------- 바깥 재생기 연결점(11-07 광호님 「공모전은 실시간 감지로. 수상 후 현대와 디벨롭하게 되면 그때를 위해 연결점은 만들어 두자」) ----------
  //   공모전판은 쓰지 않는다: 아무도 track() 을 부르지 않으면 지금과 똑같다(스트리밍은 실시간 감지가 소리를 듣고 따라간다).
  //   나중에 차량 쪽(플레오스 NowPlayingWatch, 또는 현대가 주는 미디어 API)이 「지금 재생 중인 곡」을 알려 주면:
  //     vecSync.track({ id, title, artist, album, duration(초), position(초), playing, source(앱 이름) })
  //   ① 같은 곡이면 재생 위치만 맞춘다(시크·일시정지 포함)  ② 새 곡이면 resolver 에게 그 곡의 분석 자료를 묻는다
  //   resolver(info) 가 돌려줄 수 있는 것: 분석 지도(songsync 결과와 같은 모양) · { url } 분석해도 되는 음원 주소 · null(모름 → 실시간 감지 그대로)
  //   기본 resolver 는 VEC_TRACK_MAPS 표(「가수 - 제목」 → 지도 json 주소)만 본다. 현대 서버 조회는 vecSync.resolver = async info => … 로 바꿔 끼운다
  //   track(null) 이면 바깥 곡을 놓고 앱 내장 곡으로 돌아간다
  const X = { info: null, at: 0, own: null, src: 'app' };
  const extClock = { get currentTime() { const i = X.info; return !i ? 0 : i.playing ? i.position + (performance.now() - X.at) / 1000 : i.position; }, get paused() { return !X.info || !X.info.playing; }, addEventListener() {} };
  const trackKey = i => (i.id || ((i.artist || '') + ' - ' + (i.title || ''))).trim().toLowerCase();
  async function defaultResolver(i) {
    const tbl = window.VEC_TRACK_MAPS || {}, u = tbl[trackKey(i)] || tbl[((i.artist || '') + ' - ' + (i.title || '')).trim().toLowerCase()];
    return u ? await (await fetch(u)).json() : null;
  }
  async function track(info) {
    if (!info) { if (X.info) { X.info = null; X.src = 'app'; S.job++; S.map = null; S.cues = []; S.active.clear(); S.status = 'idle'; if (X.own) S.audio = X.own; S.url = null; const u = X.own && (X.own.currentSrc || X.own.src); if (u) load(u); } return; }   // 내장 곡 분석을 다시 붙인다
    const same = X.info && trackKey(X.info) === trackKey(info);
    X.info = { ...info, position: +info.position || 0, duration: +info.duration || 0, playing: info.playing !== false }; X.at = performance.now();
    if (same) return;                                            // 위치만 맞췄다: step() 이 건너뛴 것을 보고 reindex 한다
    if (S.audio !== extClock) X.own = S.audio;
    S.audio = extClock; S.latency = () => 0;
    const job = ++S.job; S.map = null; S.cues = []; S.active.clear(); S.last = -1; S.pi = 0; S.status = 'resolving'; X.src = 'external-live';
    S.url = 'ext:' + trackKey(info);
    let got = null;
    try { got = await (window.vecSync.resolver || defaultResolver)(X.info); } catch (e) { console.warn('곡 자료 찾기 실패', e); }
    if (job !== S.job) return;
    if (got && got.url) { X.src = 'external-map'; const u = got.url; await load(u); S.url = 'ext:' + trackKey(info); return; }
    if (got && got.points) { got.src = (info.title || '') + '.ext'; S.map = got; S.status = got.status || 'ok'; X.src = 'external-map'; replan(); return; }
    S.status = 'live';                                           // 자료가 없다: 실시간 감지가 소리를 듣고 따라간다
  }

  window.vecSync = {
    attach(audio, latency) {
      S.audio = audio; if (latency) S.latency = latency;
      audio.addEventListener('play', () => { if (X.info || audio.dataset.nosync) return; const u = audio.currentSrc || audio.src; if (u && u !== S.url) load(u); });   // 바깥 곡을 따라가는 동안·긴 곡(녹턴 재즈)은 분석하지 않는다   // 처음 곡처럼 load 없이 재생된 곡도 분석한다
    },
    load,
    register(el) { S.elements = S.elements.filter(e => e.name !== el.name).concat(el); replan(); },
    cue(name, fn) { (cueFns[name] = cueFns[name] || []).push(fn); },
    on(fn) { pointFns.push(fn); },
    next,
    setOffset(v) { S.offset = +v || 0; },
    state() {
      const m = S.map, t = pos();
      return { status: S.status, position: t, tension: m ? m.tension[Math.max(0, Math.min(m.tension.length - 1, Math.round(t * m.rate)))] : 0, tempo: m ? m.tempo : 0, beatConf: m ? m.beatConf : 0, points: m ? m.points.length : 0, cues: S.cues.length, active: S.active.size, offset: S.offset };
    },
    track,
    resolver: null,
    get source() { return X.src; },                                // app: 앱 내장 곡 · external-map: 바깥 곡을 미리 분석한 자료로 · external-live: 바깥 곡을 실시간 감지로
    get map() { return S.map; },
    get cues() { return S.cues; },
  };
  requestAnimationFrame(step);
})();
