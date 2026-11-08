// 오로라: 큰 전환(T1) 수십 초 전부터 수평선 너머에 옅게 생겨나, 전환에서 커튼이 깨어나듯 빛살이 서고, 구간이 끝나면 서서히 진다.
// 극광 5km 시안의 계산(고도 90~350km 셸을 시선마다 적분, 산란 없이 더하기만)을 가볍게 옮겼다. 발자국 지도 대신 커튼 두 줄을 식으로 그린다.
(function () {
  const F = window.vecFx; if (!F) return;
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const FS = `#version 300 es
  precision highp float;
  ${F.GLSL_CAM}
  uniform float uT,uI,uRay,uFold,uExp,uRefl,uSat,uDist,uWidth,uSec,uJ,uRoom;uniform vec3 uKx,uKa;
  uniform vec2 uN;uniform vec3 uTint;
  out vec4 o;
  float h1(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}
  float n1(float x){float i=floor(x),f=x-i;f=f*f*(3.-2.*f);return mix(h1(i),h1(i+1.),f);}
  float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
  const float RE=6371.;
  const vec3 C_G=vec3(.0,1.,.50),C_B=vec3(.10,.20,1.),C_P=vec3(1.,.08,.46),C_V=vec3(.36,.06,1.);
  vec3 aurora(vec3 d,float j){
    float dy=max(d.y,.004),b=RE*dy,bb=b*b,tP=0.;vec3 c=vec3(0.);
    vec2 E=vec2(uN.y,-uN.x);
    const int N=26;
    for(int i=0;i<=N;i++){
      float u=(float(i)+j)/float(N),h=90.+260.*pow(u,1.75);
      float t=sqrt(bb+h*(2.*RE+h))-b;
      if(i==0){tP=t;continue;}
      float dt=t-tP;tP=t;
      vec2 v=d.xz*t;
      float s=dot(v,E),y=dot(v,uN)+(h-105.)*.23;                    // 자력선을 따라 위로 갈수록 살짝 기운다
      float Fx=0.,Hb=0.,Tl=0.;
      for(int k=0;k<2;k++){
        float fk=float(k),A=k==0?1.:uSec;
        if(A<.01)continue;
        float c0=uDist*(1.+fk*.75)+70.*(n1(s*.0021+fk*9.+uT*.004)-.5)+uFold*(42.*sin(s/95.+uT*.03+fk*2.)+16.*sin(s/33.-uT*.05+fk));
        float w=uWidth*(1.+fk*.6),dd=(y-c0)/w;
        float core=exp(-dd*dd)+.55*exp(-pow((y-c0-w*3.3)/(w*.75),2.))+.35*exp(-pow((y-c0+w*4.4)/(w*1.5),2.));
        float sa=s+fk*173.;
        float r2=n1(sa/7.5-uT*.2),r3=n1(sa/21.+uT*.08),r4=n1(sa/96.-uT*.024);   // 2km 결(r1)은 뺐다: 수백 km 밖에서는 한 화소보다 가늘어 무늬가 겹쳐 물결무늬(모아레)를 만들었다(11-03 광호님 「지저분해」)
        float rr=pow(clamp(r2*.7+r3*.3,0.,1.),1.25)*2.1;   // 빛살 대비를 낮춰 줄기끼리 이어지게
        float lane=.68+.67*smoothstep(.15,.85,n1(s*.0033+fk*5.+uT*.003));   // 커튼이 끊기지 않고 길게 이어진다(11-03 광호님 「빛줄기가 더 연결된 느낌」, 11-07 「하나의 면처럼 약간만 더」 .6~1.35 → .68~1.35)
        float ray=mix(1.,rr*(.65+r3*.7),uRay*.6)*(.64+.72*r4)*lane;   // 11-07: 빛살 대비 .68 → .6, 큰 결의 밝기 차 .58~1.42 → .64~1.36(조금만)
        float kx=s/430.,kg=uKa.x*exp(-pow((kx-uKx.x)/.05,4.))+uKa.y*exp(-pow((kx-uKx.y)/.05,4.))+uKa.z*exp(-pow((kx-uKx.z)/.05,4.));   // 건반: 커튼을 따라 12칸, 지금 음이 난 칸이 은은하게 빛나고 앞서 친 칸은 잦아든다(11-04 광호님 「피아노 건반처럼 음에 맞춰 이동」)
        float fl=A*core*ray*(1.+.85*kg);
        float hb=mix(118.,100.,clamp(A*.55*(.4+r4),0.,1.))+2.*(n1(sa/11.+uT*.05)-.5);
        float H=mix(16.,24.,r4)+uRay*rr*14.;
        Fx+=fl;Hb+=fl*hb;Tl+=fl*H;
      }
      if(Fx>.0004){
        float hb=Hb/Fx,H=Tl/Fx,z=(h-hb)/H;
        float rise=clamp((h-hb+6.)/14.,0.,1.);rise*=rise*(3.-2.*rise);
        float g=rise*exp(-max(z,0.)),hard=clamp((116.-hb)/18.,0.,1.);
        c+=dt*Fx*(C_G*g+C_B*.26*rise*exp(-max((h-hb)/(H*.55),0.))+C_P*1.1*hard*hard*rise*exp(-max(h-hb,0.)/3.2));
        float pk=smoothstep(118.,168.,h)*exp(-max(h-168.,0.)/75.),vi=smoothstep(185.,275.,h)*exp(-max(h-275.,0.)/70.);
        c+=dt*Fx*(C_P*.24*pk+C_V*.1*vi);
      }
    }
    return c*.0112;
  }
  void main(){
    vec3 d=fxRay(gl_FragCoord.xy);
    float j=fract(hash(gl_FragCoord.xy*1.37+vec2(17.,3.))+uJ),k=1.;   // 화소마다 고정된 흔들림: 규칙 있는 무늬(IGN)는 낮은 해상도에서 확대되며 사선 물결무늬가 됐다 → 규칙 없는 고운 흔들림(11-03)
    if(d.y<0.){                                                     // 수면: 물결에 흔들린 반사를 옅게
      if(uRefl<.005){o=vec4(0.);return;}
      float t=.3/max(-d.y,.0005);vec2 w=uPos+d.xz*t;
      float r=noise(w*vec2(.9,.35)+vec2(0.,uT*.6))-.5,r2=noise(w*vec2(2.3,.8)-uT*.9)-.5;
      d=normalize(vec3(d.x+(r*.6+r2*.3)*.035,-d.y+(r+r2)*.012,d.z));
      k=uRefl*(.35+.65*pow(1.-min(1.,-fxRay(gl_FragCoord.xy).y*4.),3.));
    }
    float y=max(d.y,.004),e=degrees(asin(y)),X=1./(y+.15*pow(e+3.885,-1.253));
    vec3 c=aurora(d,j)*exp(-vec3(.09,.13,.2)*X);
    c*=uExp*uI;{float m=max(max(c.r,c.g),c.b),mm=uRoom*(1.-exp(-m/uRoom));c*=mm/max(m,1e-5);}   // 실제 오로라처럼 밝기에 끝이 있다: 가장 밝은 빛도 절반 남짓에서 부드럽게 멈추고, 색은 그대로라 하얗게 타지 않는다(11-03 광호님)
    float l=dot(c,vec3(.3,.5,.2));
    c=mix(vec3(l),c,uSat);
    c=mix(c,uTint*l*1.6,.18);
    o=vec4(c*k+(hash(gl_FragCoord.xy*.91+vec2(5.,11.))+hash(gl_FragCoord.xy*1.53+vec2(2.,19.))-1.)*.008,1.);   // 11-05 「깍두기」: 오로라 번짐의 계단도 고정 잡티로 흩뜨린다
  }`;
  let P, vao, clock = 0, wake = 0, lv = 0, frame = 0, lastHead = null, fresh = true;
  const keys = [{ x: 0, a: 0 }, { x: 0, a: 0 }, { x: 0, a: 0 }];   // 최근에 울린 건반 셋(자리 -1~1, 세기)
  let keyNow = -1;
  F.define({
    name: 'aurora', label: '오로라', color: '#8ff0c8',
    layer: { slot: 'sky', ctx: 'webgl2', scale: 0.5, maxDpr: 1, blend: 'plus-lighter', keep: true },
    tune: {
      az:     [0.5, -3.14, 3.14, 0.01, '방향(광원 기준)'],
      dist:   [280, 80, 1200, 10, '거리(km)'],
      width:  [9, 2, 30, 0.5, '커튼 두께'],
      fold:   [0.6, 0, 2, 0.05, '접힘'],
      ray:    [0.45, 0, 1, 0.01, '평소 빛살'],
      wakeRay:[1, 0, 1, 0.01, '전환 빛살'],
      sec:    [0.55, 0, 1, 0.01, '두 번째 커튼'],
      exp:    [2.4, 0.3, 6, 0.05, '밝기'],
      sat:    [0.78, 0, 1.2, 0.01, '채도'],
      refl:   [0.22, 0, 1, 0.01, '수면 반사'],
      react:  [0.12, 0, 0.5, 0.01, '음악 반응'],
      speed:  [1, 0.2, 4, 0.05, '흐름 속도'],
    },
    sync: { lead: [12, 30], hold: [20, 90], tail: 12, wants: ['impact', 'drop', 'section', 'entry'], tiers: [1], moments: ['grand'], momentLead: [3, 6], tension: [0.3, 1], minGap: 60, maxPerSong: 2, alone: true, minConf: 0.5 },
    init(L) { const gl = L.gl; P = F.program(gl, F.VS_FULL, FS); vao = gl.createVertexArray(); },
    draw(v, L, cues) {
      const gl = L.gl, T = this.T, tail = this.sync.tail || 12;
      // 세기: 앞서 시작에서 정점까지 서서히(곡선), 정점 직후 몇 초 깨어남, 끝 무렵 서서히 진다
      let I = 0, W = 0;
      for (const c of cues) {
        const s = c.st();
        let i = Math.pow(s.a, 1.6);
        if (s.a >= 1) i = 0.88 + 0.12 * Math.sin(s.age * 0.31);
        if (s.left < tail) i *= sstep(0, 1, s.left / tail);
        { // 숨결(11-07 광호님 「조건 때문에 떠 있는 거라면 약간씩 흐려지는 부분도 넣어서 변화감」): 정점에서 10초쯤 지나면 서서히 끼어들어
          //   느린 물결 두 개(17초·7.3초, 연출마다 다른 출발점)로 흐려졌다 돌아오고, 곡이 잦아든 때(고조 낮음)는 더 흐려진다. 가장 흐릴 때 약 30%까지
          const dep = sstep(8, 20, -s.toPeak), ph = (c.seed % 1000) * 0.0063;
          const b = Math.max(0, Math.min(1, 0.5 + 0.32 * Math.sin(s.age * 0.37 + ph) + 0.18 * Math.sin(s.age * 0.86 + ph * 2.3)));
          const tn = sstep(0.1, 0.55, (v.mu && v.mu.tens) || 0);
          i *= Math.max(0.3, 1 - dep * (0.5 * b + 0.3 * (1 - tn)));
        }
        const w = s.toPeak <= 0 ? Math.exp(-(-s.toPeak) / 5) : sstep(-1.5, 0, -s.toPeak);
        I = Math.max(I, i); W = Math.max(W, w * Math.min(1, i * 1.5));
      }
      this.dbgI = I;                                                 // 시험용: 지금 세기
      wake += (W - wake) * (1 - Math.exp(-v.dt / (W > wake ? 0.4 : 2)));
      const mu = v.mu, tgt = v.mOn * Math.min(1, (mu.pulse || 0) * 0.8 + (mu.loudN || 0) * 0.4);
      { // 음높이(곡 음역 안 0~1)를 12칸 건반에 대응: 칸이 바뀌면 새 칸이 빛나기 시작하고, 앞 칸들은 0.7초에 걸쳐 잦아든다
        const idx = Math.round(Math.max(0, Math.min(1, mu.pitchN || 0)) * 11), amp = v.mOn * (0.35 + 0.65 * Math.min(1, mu.loudN || 0));
        if (idx !== keyNow) { keyNow = idx; keys.unshift(keys.pop()); keys[0].x = idx / 11 * 2 - 1; keys[0].a = Math.max(keys[0].a * 0.3, 0.001); }
        keys[0].a += (amp - keys[0].a) * (1 - Math.exp(-v.dt / 0.12));
        for (let i = 1; i < 3; i++) keys[i].a *= Math.exp(-v.dt / 0.7); }
      lv += (tgt - lv) * (1 - Math.exp(-v.dt / (tgt > lv ? 0.25 : 1.2)));
      clock += v.dt * T.speed * (1 + 2.2 * wake);
      if (I < 0.004) { if (!fresh) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); fresh = true; } return; }
      // 프레임마다 흔들림을 바꿔 그리고 앞 프레임과 겹쳐 쌓는다: 시선마다 몇 번만 짚어 생기던 자글거림이 여러 프레임 평균으로 고와진다(11-03 광호님 「모아레가 지저분해」)
      // 시점이 빨리 돌면 새 프레임 비중을 높여 잔상이 남지 않게 한다
      const dh = lastHead == null ? 1 : Math.abs(Math.atan2(Math.sin(v.head - lastHead), Math.cos(v.head - lastHead))); lastHead = v.head;
      const wNew = fresh ? 1 : Math.min(1, 0.2 + dh * 40);
      fresh = false; frame++;
      gl.useProgram(P.p); gl.bindVertexArray(vao);
      F.glCam(gl, P.U, L, v);
      const phi = v.sunBearing + T.az;
      gl.uniform2f(P.U.uN, -Math.sin(phi), Math.cos(phi));
      gl.uniform1f(P.U.uT, clock % 4000);
      gl.uniform1f(P.U.uI, I * (1 + 0.25 * wake + T.react * lv));
      gl.uniform1f(P.U.uRay, T.ray + (T.wakeRay - T.ray) * wake);
      gl.uniform1f(P.U.uFold, T.fold * (1 + 0.8 * wake));
      gl.uniform1f(P.U.uExp, T.exp); gl.uniform1f(P.U.uRefl, T.refl); gl.uniform1f(P.U.uSat, T.sat);
      gl.uniform1f(P.U.uDist, T.dist); gl.uniform1f(P.U.uWidth, T.width); gl.uniform1f(P.U.uSec, T.sec);
      const t = v.pal.acc.map((x, i) => (x * 0.5 + v.pal.hi[i] * 0.5) / 255);
      gl.uniform3f(P.U.uTint, t[0], t[1], t[2]);
      gl.uniform3f(P.U.uKx, keys[0].x, keys[1].x, keys[2].x); gl.uniform3f(P.U.uKa, keys[0].a, keys[1].a, keys[2].a);
      const sky = (v.pal.hor[0] * 0.3 + v.pal.hor[1] * 0.55 + v.pal.hor[2] * 0.15 + v.pal.top[0] * 0.3 + v.pal.top[1] * 0.55 + v.pal.top[2] * 0.15) / 510;
      gl.uniform1f(P.U.uRoom, Math.max(0.16, Math.min(0.5, 0.92 - sky)));   // 하늘 위에 더해지는 빛이라 밝은 하늘일수록 더할 몫이 적다: 하늘+오로라가 하얗게 타지 않게
      gl.uniform1f(P.U.uJ, (frame * 0.6180339) % 1);
      gl.enable(gl.BLEND); gl.blendColor(0, 0, 0, wNew); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    },
  });
})();
