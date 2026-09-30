(function(){
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const menuOverlay = document.getElementById('menuOverlay');
  const endOverlay = document.getElementById('endOverlay');
  const goalFlash = document.getElementById('goalFlash');
  const scoreLeftDigits = document.getElementById('scoreLeftDigits');
  const scoreRightDigits = document.getElementById('scoreRightDigits');
  const hudTime = document.getElementById('hudTime');
  const p2label = document.getElementById('p2label');
  const panelLeft = document.getElementById('panelLeft');
  const panelRight = document.getElementById('panelRight');
  const joyP2 = document.getElementById('joyP2');
  const kickP2 = document.getElementById('kickP2');

  const GOAL_TOP = H/2 - 65;
  const GOAL_BOTTOM = H/2 + 65;
  const WALL = 14;

  let mode = null;
  let running = false;
  let paused = false;
  let matchTime = 120;
  let lastTs = null;
  let scoreL = 0, scoreR = 0;
  let kickoffFreeze = 0;

  const WALL_RESTITUTION = 0.72;
  const MIN_VELOCITY = 0.035;
  function killJitter(v){ return Math.abs(v) < MIN_VELOCITY ? 0 : v; }

  /* ---------- Unified input (keyboard + touch) ---------- */
  const input = {
    p1:{up:false,down:false,left:false,right:false,kickReq:false,touchVec:{x:0,y:0}},
    p2:{up:false,down:false,left:false,right:false,kickReq:false,touchVec:{x:0,y:0}}
  };

  window.addEventListener('keydown', e=>{
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Enter'].includes(e.code)) e.preventDefault();
    switch(e.code){
      case 'KeyW': input.p1.up = true; break;
      case 'KeyS': input.p1.down = true; break;
      case 'KeyA': input.p1.left = true; break;
      case 'KeyD': input.p1.right = true; break;
      case 'Space': if(!e.repeat) input.p1.kickReq = true; break;
      case 'ArrowUp': input.p2.up = true; break;
      case 'ArrowDown': input.p2.down = true; break;
      case 'ArrowLeft': input.p2.left = true; break;
      case 'ArrowRight': input.p2.right = true; break;
      case 'Enter': if(!e.repeat) input.p2.kickReq = true; break;
      case 'Escape': if(running) paused = !paused; break;
    }
  });
  window.addEventListener('keyup', e=>{
    switch(e.code){
      case 'KeyW': input.p1.up = false; break;
      case 'KeyS': input.p1.down = false; break;
      case 'KeyA': input.p1.left = false; break;
      case 'KeyD': input.p1.right = false; break;
      case 'ArrowUp': input.p2.up = false; break;
      case 'ArrowDown': input.p2.down = false; break;
      case 'ArrowLeft': input.p2.left = false; break;
      case 'ArrowRight': input.p2.right = false; break;
    }
  });

  function wireJoystick(joyEl, knobEl, player){
    let active = false;
    let touchId = null;

    function getPoint(ev){
      if(ev.changedTouches && ev.changedTouches.length){
        for(const t of ev.touches.length ? ev.touches : ev.changedTouches){
          if(touchId === null || t.identifier === touchId) return t;
        }
        return ev.changedTouches[0];
      }
      return ev;
    }

    function start(ev){
      ev.preventDefault();
      active = true;
      const p = ev.changedTouches ? ev.changedTouches[0] : ev;
      touchId = ev.changedTouches ? p.identifier : 'mouse';
      updateFromPoint(p);
    }
    function moveHandler(ev){
      if(!active) return;
      ev.preventDefault();
      updateFromPoint(getPoint(ev));
    }
    function updateFromPoint(p){
      const rect = joyEl.getBoundingClientRect();
      const cx = rect.left + rect.width/2;
      const cy = rect.top + rect.height/2;
      const maxR = rect.width/2 * 0.85;
      let dx = p.clientX - cx, dy = p.clientY - cy;
      const dist = Math.hypot(dx,dy);
      if(dist > maxR){ dx = dx/dist*maxR; dy = dy/dist*maxR; }
      knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      input[player].touchVec.x = dx / maxR;
      input[player].touchVec.y = dy / maxR;
    }
    function end(ev){
      if(ev) ev.preventDefault();
      active = false;
      touchId = null;
      knobEl.style.transform = 'translate(-50%,-50%)';
      input[player].touchVec.x = 0;
      input[player].touchVec.y = 0;
    }

    joyEl.addEventListener('touchstart', start, {passive:false});
    joyEl.addEventListener('touchmove', moveHandler, {passive:false});
    joyEl.addEventListener('touchend', end, {passive:false});
    joyEl.addEventListener('touchcancel', end, {passive:false});
    joyEl.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', ev=>{ if(active && touchId==='mouse') moveHandler(ev); });
    window.addEventListener('pointerup', ev=>{ if(active && touchId==='mouse') end(ev); });
  }
  function wireTouchKick(btnEl, player){
    const trigger = ev=>{
      ev.preventDefault();
      input[player].kickReq = true;
      btnEl.classList.add('active');
      setTimeout(()=>btnEl.classList.remove('active'),120);
    };
    btnEl.addEventListener('touchstart', trigger, {passive:false});
    btnEl.addEventListener('pointerdown', trigger);
  }
  wireJoystick(document.getElementById('joyP1'), document.getElementById('knobP1'), 'p1');
  wireJoystick(joyP2, document.getElementById('knobP2'), 'p2');
  wireTouchKick(document.getElementById('kickP1'), 'p1');
  wireTouchKick(kickP2, 'p2');

  function tryLockLandscape(){
    try{
      const el = document.documentElement;
      const reqFs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
      const doLock = ()=>{
        try{
          if(screen.orientation && screen.orientation.lock){
            screen.orientation.lock('landscape').catch(()=>{});
          }
        }catch(e){}
      };
      if(document.fullscreenElement || document.webkitFullscreenElement){
        doLock();
      } else if(reqFs){
        Promise.resolve(reqFs.call(el)).then(doLock).catch(()=>{ doLock(); });
      } else {
        doLock();
      }
    }catch(e){
      // Not supported (e.g. iOS Safari) — the CSS rotate-prompt covers this case.
    }
  }

  function shade(hex, pct){
    const f = parseInt(hex.slice(1),16);
    const t = pct<0 ? 0 : 255;
    const p = pct<0 ? -pct : pct;
    const R = f>>16, G = f>>8 & 0x00FF, B = f & 0x0000FF;
    return "#" + (0x1000000 + (Math.round((t-R)*p)+R)*0x10000 + (Math.round((t-G)*p)+G)*0x100 + (Math.round((t-B)*p)+B)).toString(16).slice(1);
  }

  /* ---------- Customization state ---------- */
  const PALETTE = ['#c73e3e','#2f6fb0','#2e8b57','#e0b84a','#7a4fc7','#222222','#e8712f','#f2e9d0'];
  const PATTERNS = [
    {id:'solid', label:'Liso'},
    {id:'stripe', label:'Faixa'},
    {id:'star', label:'Estrela'},
    {id:'number', label:'Número'}
  ];

  let custom = {
    1:{color:PALETTE[0], pattern:'solid', number:'1'},
    2:{color:PALETTE[1], pattern:'stripe', number:'2'}
  };

  function buildCustomUI(team){
    const swWrap = document.getElementById('swatches'+team);
    PALETTE.forEach(color=>{
      const b = document.createElement('button');
      b.className = 'swatch' + (custom[team].color===color ? ' selected':'');
      b.style.background = color;
      b.addEventListener('click', ()=>{
        custom[team].color = color;
        [...swWrap.children].forEach(c=>c.classList.remove('selected'));
        b.classList.add('selected');
        drawPreview(team);
      });
      swWrap.appendChild(b);
    });
    const patWrap = document.getElementById('patterns'+team);
    PATTERNS.forEach(p=>{
      const b = document.createElement('button');
      b.className = 'pattern-btn' + (custom[team].pattern===p.id ? ' selected':'');
      b.textContent = p.label;
      b.addEventListener('click', ()=>{
        custom[team].pattern = p.id;
        [...patWrap.children].forEach(c=>c.classList.remove('selected'));
        b.classList.add('selected');
        drawPreview(team);
      });
      patWrap.appendChild(b);
    });
  }
  buildCustomUI(1);
  buildCustomUI(2);

  function drawDiscOn(pctx, cx, cy, r, color, pattern, number){
    const dark = shade(color, -0.42);
    pctx.save();
    pctx.shadowColor = 'rgba(0,0,0,0.5)';
    pctx.shadowBlur = 5;
    pctx.shadowOffsetY = 2;
    pctx.beginPath();
    pctx.fillStyle = color;
    pctx.arc(cx, cy, r, 0, Math.PI*2);
    pctx.fill();
    pctx.restore();

    if(pattern === 'stripe'){
      pctx.save();
      pctx.beginPath();
      pctx.arc(cx, cy, r, 0, Math.PI*2);
      pctx.clip();
      pctx.fillStyle = 'rgba(255,255,255,0.85)';
      pctx.fillRect(cx-r, cy-r*0.28, r*2, r*0.56);
      pctx.restore();
    } else if(pattern === 'star'){
      pctx.save();
      pctx.translate(cx,cy);
      pctx.fillStyle = 'rgba(255,255,255,0.9)';
      pctx.beginPath();
      const spikes=5, outer=r*0.5, inner=r*0.22;
      let rot = Math.PI/2*3;
      let x=0,y=0;
      const step = Math.PI/spikes;
      pctx.moveTo(0,-outer);
      for(let i=0;i<spikes;i++){
        x = Math.cos(rot)*outer; y = Math.sin(rot)*outer;
        pctx.lineTo(x,y); rot += step;
        x = Math.cos(rot)*inner; y = Math.sin(rot)*inner;
        pctx.lineTo(x,y); rot += step;
      }
      pctx.lineTo(0,-outer);
      pctx.closePath();
      pctx.fill();
      pctx.restore();
    } else if(pattern === 'number'){
      pctx.save();
      pctx.fillStyle = 'rgba(255,255,255,0.92)';
      pctx.font = 'bold ' + Math.round(r*1.05) + 'px Arial';
      pctx.textAlign = 'center';
      pctx.textBaseline = 'middle';
      pctx.fillText(number || '1', cx, cy+1);
      pctx.restore();
    }

    pctx.beginPath();
    pctx.strokeStyle = dark;
    pctx.lineWidth = Math.max(2, r*0.16);
    pctx.arc(cx, cy, r-2, 0, Math.PI*2);
    pctx.stroke();
    pctx.beginPath();
    pctx.fillStyle = 'rgba(255,255,255,0.22)';
    pctx.arc(cx-r*0.28, cy-r*0.32, r*0.26, 0, Math.PI*2);
    pctx.fill();
  }

  function drawPreview(team){
    const c = document.getElementById('preview'+team);
    const pctx = c.getContext('2d');
    pctx.clearRect(0,0,c.width,c.height);
    drawDiscOn(pctx, c.width/2, c.height/2, 19, custom[team].color, custom[team].pattern, custom[team].number);
  }
  drawPreview(1);
  drawPreview(2);

  /* ---------- Game entities ---------- */
  function makeDisc(x,y,team){
    return {x,y,vx:0,vy:0,r:19,
      color:custom[team].color,
      pattern:custom[team].pattern,
      number:custom[team].number,
      dark:shade(custom[team].color,-0.42)};
  }

  let ball, p1, p2;
  const p1Kick = {timer:0};
  const p2Kick = {timer:0};

  function resetPositions(kickoff){
    p1 = makeDisc(W*0.28, H/2, 1);
    p2 = makeDisc(W*0.72, H/2, 2);
    ball = {x:W/2, y:H/2, vx:0, vy:0, r:10};
    if(kickoff === 'L') ball.x = W/2 - 40;
    if(kickoff === 'R') ball.x = W/2 + 40;
  }

  function startGame(selectedMode){
    mode = selectedMode;
    tryLockLandscape();
    if(mode === '1p'){
      p2label.textContent = '🔵 CPU';
      joyP2.classList.add('hidden');
      kickP2.classList.add('hidden');
    } else {
      p2label.textContent = '🔵 P2: Setas + Enter (chute)';
      joyP2.classList.remove('hidden');
      kickP2.classList.remove('hidden');
    }
    panelLeft.style.setProperty('--panel-color', shade(custom[1].color,-0.35));
    panelRight.style.setProperty('--panel-color', shade(custom[2].color,-0.35));
    scoreL = 0; scoreR = 0;
    matchTime = 120;
    resetPositions(null);
    kickoffFreeze = 0.8;
    menuOverlay.classList.add('hidden');
    endOverlay.classList.add('hidden');
    updateHud();
    running = true;
    paused = false;
    lastTs = null;
    requestAnimationFrame(loop);
  }

  function updateHud(){
    scoreLeftDigits.textContent = scoreL;
    scoreRightDigits.textContent = scoreR;
    const m = Math.floor(matchTime/60);
    const s = Math.floor(matchTime%60);
    hudTime.textContent = m + ':' + (s<10?'0':'') + s;
  }

  function flashGoal(text){
    goalFlash.textContent = text;
    goalFlash.classList.remove('show');
    void goalFlash.offsetWidth;
    goalFlash.classList.add('show');
  }

  function endGame(){
    running = false;
    let title, desc;
    if(scoreL === scoreR){
      title = 'EMPATE!';
      desc = `${scoreL} x ${scoreR} — jogo equilibrado até o apito final.`;
    } else if(scoreL > scoreR){
      title = mode==='1p' ? 'VOCÊ VENCEU!' : 'VERMELHO VENCEU!';
      desc = `${scoreL} x ${scoreR} — time vermelho leva a taça.`;
    } else {
      title = mode==='1p' ? 'A MÁQUINA VENCEU' : 'AZUL VENCEU!';
      desc = `${scoreR} x ${scoreL} — time azul leva a taça.`;
    }
    document.getElementById('endTitle').textContent = title;
    document.getElementById('endDesc').textContent = desc;
    endOverlay.classList.remove('hidden');
  }

  function moveDisc(d, ax, ay){
    const accel = 0.65;
    const maxSpeed = 4.1;
    d.vx += ax*accel;
    d.vy += ay*accel;
    const sp = Math.hypot(d.vx, d.vy);
    if(sp > maxSpeed){ d.vx *= maxSpeed/sp; d.vy *= maxSpeed/sp; }
    d.vx *= 0.88;
    d.vy *= 0.88;
    d.vx = killJitter(d.vx);
    d.vy = killJitter(d.vy);
    d.x += d.vx;
    d.y += d.vy;
    if(d.x < WALL+d.r){ d.x = WALL+d.r; d.vx = Math.max(0, d.vx); }
    if(d.x > W-WALL-d.r){ d.x = W-WALL-d.r; d.vx = Math.min(0, d.vx); }
    if(d.y < WALL+d.r){ d.y = WALL+d.r; d.vy = Math.max(0, d.vy); }
    if(d.y > H-WALL-d.r){ d.y = H-WALL-d.r; d.vy = Math.min(0, d.vy); }
  }

  function updateBall(){
    ball.vx *= 0.982;
    ball.vy *= 0.982;
    ball.vx = killJitter(ball.vx);
    ball.vy = killJitter(ball.vy);
    ball.x += ball.vx;
    ball.y += ball.vy;

    if(ball.y < WALL+ball.r){ ball.y = WALL+ball.r; ball.vy = Math.abs(ball.vy)*WALL_RESTITUTION; }
    if(ball.y > H-WALL-ball.r){ ball.y = H-WALL-ball.r; ball.vy = -Math.abs(ball.vy)*WALL_RESTITUTION; }

    const margin = ball.r*0.5;
    const withinGoalY = ball.y > GOAL_TOP+margin && ball.y < GOAL_BOTTOM-margin;

    // Only bounce off the side walls outside the goal mouth. Inside the
    // mouth the ball is free to coast toward the net — scoring is checked
    // separately in checkGoal(), right after collisions each frame.
    if(!withinGoalY){
      if(ball.x < WALL+ball.r){ ball.x = WALL+ball.r; ball.vx = Math.abs(ball.vx)*WALL_RESTITUTION; }
      if(ball.x > W-WALL-ball.r){ ball.x = W-WALL-ball.r; ball.vx = -Math.abs(ball.vx)*WALL_RESTITUTION; }
    }
  }

  // A goal counts the instant the whole ball has crossed behind the goal
  // line (the post), not once it has drifted deep off-screen — friction
  // was killing its speed before it ever reached the old, far-away line.
  function checkGoal(){
    const margin = ball.r*0.5;
    const withinGoalY = ball.y > GOAL_TOP+margin && ball.y < GOAL_BOTTOM-margin;
    if(!withinGoalY) return;
    if(ball.x + ball.r < WALL){ goalScored('R'); return; }
    if(ball.x - ball.r > W-WALL){ goalScored('L'); }
  }

  function clampBallToField(){
    const margin = ball.r*0.5;
    const withinGoalY = ball.y > GOAL_TOP+margin && ball.y < GOAL_BOTTOM-margin;
    if(withinGoalY){
      // generous net-back limit just so the ball can't fly off-screen
      // forever if something odd happens — checkGoal() already resolves
      // the actual score before this ever matters in normal play.
      if(ball.x < WALL-70) ball.x = WALL-70;
      if(ball.x > W-WALL+70) ball.x = W-WALL+70;
    } else {
      if(ball.x < WALL+ball.r){ ball.x = WALL+ball.r; ball.vx = Math.abs(ball.vx)*WALL_RESTITUTION; }
      if(ball.x > W-WALL-ball.r){ ball.x = W-WALL-ball.r; ball.vx = -Math.abs(ball.vx)*WALL_RESTITUTION; }
    }
    if(ball.y < WALL+ball.r){ ball.y = WALL+ball.r; ball.vy = Math.abs(ball.vy)*WALL_RESTITUTION; }
    if(ball.y > H-WALL-ball.r){ ball.y = H-WALL-ball.r; ball.vy = -Math.abs(ball.vy)*WALL_RESTITUTION; }
  }

  function goalScored(side){
    if(side === 'R'){ scoreR++; flashGoal('GOOOOL AZUL!'); }
    else { scoreL++; flashGoal('GOOOOL VERMELHO!'); }
    updateHud();
    resetPositions(side === 'R' ? 'L' : 'R');
    kickoffFreeze = 1.1;
  }

  const DISC_MASS = 3, BALL_MASS = 1;
  function collide(d, b){
    const dx = b.x - d.x, dy = b.y - d.y;
    const dist = Math.hypot(dx,dy);
    const minDist = d.r + b.r;
    if(dist < minDist && dist > 0){
      const nx = dx/dist, ny = dy/dist;
      const overlap = minDist - dist + 0.4;
      b.x += nx*overlap;
      b.y += ny*overlap;

      const rvx = b.vx - d.vx, rvy = b.vy - d.vy;
      const velAlongNormal = rvx*nx + rvy*ny;
      if(velAlongNormal < 0){
        const restitution = 1.15; // gentle touch — the dedicated kick is the real shot
        const j = -(1+restitution)*velAlongNormal / (1/DISC_MASS + 1/BALL_MASS);
        b.vx += (j/BALL_MASS)*nx;
        b.vy += (j/BALL_MASS)*ny;
        d.vx -= (j/DISC_MASS)*nx*0.15;
        d.vy -= (j/DISC_MASS)*ny*0.15;
      }
      const minPop = 1.1;
      const sp = Math.hypot(b.vx,b.vy);
      if(sp < minPop){
        const scale = sp < 0.01 ? 1 : minPop/sp;
        b.vx *= scale; b.vy *= scale;
      }
    }
  }

  function discDiscCollide(a,b){
    const dx = b.x-a.x, dy = b.y-a.y;
    const dist = Math.hypot(dx,dy);
    const minDist = a.r+b.r;
    if(dist < minDist && dist > 0){
      const nx=dx/dist, ny=dy/dist;
      const overlap = (minDist-dist)/2 + 0.3;
      a.x -= nx*overlap; a.y -= ny*overlap;
      b.x += nx*overlap; b.y += ny*overlap;
      const rvx = b.vx-a.vx, rvy = b.vy-a.vy;
      const velAlongNormal = rvx*nx+rvy*ny;
      if(velAlongNormal < 0){
        const j = -(1+0.6)*velAlongNormal/2;
        a.vx -= j*nx; a.vy -= j*ny;
        b.vx += j*nx; b.vy += j*ny;
      }
    }
  }

  /* Dedicated kick action: moderate, fixed-ish power so it's neither a
     free super-shot nor a useless tap. Has range + cooldown. */
  const KICK_POWER = 7.6;
  const KICK_RANGE_PAD = 15;
  const KICK_COOLDOWN = 0.32;
  function tryKick(d, cd){
    const dx = ball.x-d.x, dy = ball.y-d.y;
    const dist = Math.hypot(dx,dy);
    if(cd.timer <= 0 && dist > 0 && dist < d.r+ball.r+KICK_RANGE_PAD){
      const nx = dx/dist, ny = dy/dist;
      ball.vx = nx*KICK_POWER + d.vx*0.35;
      ball.vy = ny*KICK_POWER + d.vy*0.35;
      cd.timer = KICK_COOLDOWN;
    }
  }

  function aiControl(dt){
    const ownGoalX = W - WALL;
    const targetGoalX = WALL;
    const midY = H/2;

    const lead = 14;
    let bx = ball.x + ball.vx*lead;
    let by = ball.y + ball.vy*lead;
    by = Math.max(WALL+ball.r+4, Math.min(H-WALL-ball.r-4, by));
    bx = Math.max(WALL+ball.r, Math.min(W-WALL-ball.r, bx));

    // Attacking target: line up on the far side of the ball from the
    // opponent's goal so contact (and kicks) drive the ball forward.
    const dxg = targetGoalX - bx, dyg = midY - by;
    const dg = Math.hypot(dxg,dyg) || 1;
    const anx = dxg/dg, any = dyg/dg*0.35;
    const offset = p2.r + ball.r + 8;
    const attackX = bx - anx*offset;
    const attackY = by - any*offset;

    // Defensive target: sit between the ball and the own goal.
    const guard = 0.42;
    let defendX = ownGoalX - (ownGoalX - bx) * guard;
    defendX = Math.min(defendX, W - 55);
    const defendY = midY + (by - midY) * 0.7;

    // Blend the two based on how threatening the ball currently is —
    // mostly attacking/pressing, only falling back when the ball is
    // genuinely close to goal and heading that way. This keeps the CPU
    // active and moving instead of camping on the goal line.
    const proximityThreat = Math.max(0, (bx - W*0.58) / (W*0.42));
    const speedThreat = ball.vx > 0.2 ? Math.min(1, ball.vx/3) : 0;
    const threat = Math.max(0, Math.min(1, proximityThreat*0.7 + speedThreat*0.5));

    let targetX = attackX + (defendX-attackX)*threat;
    let targetY = attackY + (defendY-attackY)*threat;

    targetX = Math.max(WALL+p2.r, Math.min(W-WALL-p2.r, targetX));
    targetY = Math.max(WALL+p2.r, Math.min(H-WALL-p2.r, targetY));

    const dx = targetX - p2.x, dy = targetY - p2.y;
    const dist = Math.hypot(dx,dy) || 1;
    const ax = dx/dist, ay = dy/dist;
    const ease = Math.min(1, dist/18);
    moveDisc(p2, ax*ease, ay*ease);

    tryKick(p2, p2Kick);
  }

  function loop(ts){
    if(!running) return;
    if(!lastTs) lastTs = ts;
    const dt = (ts-lastTs)/1000;
    lastTs = ts;

    if(!paused){
      matchTime -= dt;
      if(matchTime <= 0){
        matchTime = 0;
        updateHud();
        draw();
        endGame();
        return;
      }

      if(p1Kick.timer > 0) p1Kick.timer -= dt;
      if(p2Kick.timer > 0) p2Kick.timer -= dt;

      let ax1=0, ay1=0;
      if(input.p1.left) ax1 -= 1;
      if(input.p1.right) ax1 += 1;
      if(input.p1.up) ay1 -= 1;
      if(input.p1.down) ay1 += 1;
      if(Math.hypot(input.p1.touchVec.x, input.p1.touchVec.y) > 0.08){
        ax1 = input.p1.touchVec.x; ay1 = input.p1.touchVec.y;
      }
      moveDisc(p1, ax1, ay1);
      if(input.p1.kickReq){ tryKick(p1, p1Kick); input.p1.kickReq = false; }

      if(mode === '2p'){
        let ax2=0, ay2=0;
        if(input.p2.left) ax2 -= 1;
        if(input.p2.right) ax2 += 1;
        if(input.p2.up) ay2 -= 1;
        if(input.p2.down) ay2 += 1;
        if(Math.hypot(input.p2.touchVec.x, input.p2.touchVec.y) > 0.08){
          ax2 = input.p2.touchVec.x; ay2 = input.p2.touchVec.y;
        }
        moveDisc(p2, ax2, ay2);
        if(input.p2.kickReq){ tryKick(p2, p2Kick); input.p2.kickReq = false; }
      } else {
        aiControl(dt);
      }

      if(kickoffFreeze > 0){
        kickoffFreeze -= dt;
        ball.vx = 0; ball.vy = 0;
      } else {
        updateBall();
        collide(p1, ball);
        collide(p2, ball);
        checkGoal();
        clampBallToField();
      }
      discDiscCollide(p1, p2);

      updateHud();
    }

    draw();
    requestAnimationFrame(loop);
  }

  function draw(){
    ctx.clearRect(0,0,W,H);

    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,'#177a4d');
    grad.addColorStop(1,'#0f5c3a');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,W,H);

    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#000';
    for(let i=0;i<10;i++){
      if(i%2===0) ctx.fillRect(i*(W/10),0,W/10,H);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(232,224,200,0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(W/2, WALL);
    ctx.lineTo(W/2, H-WALL);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W/2, H/2, 52, 0, Math.PI*2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W/2, H/2, 3, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(232,224,200,0.85)';
    ctx.fill();

    ctx.strokeRect(WALL, H/2-95, 90, 190);
    ctx.strokeRect(W-WALL-90, H/2-95, 90, 190);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, GOAL_TOP, WALL, GOAL_BOTTOM-GOAL_TOP);
    ctx.fillRect(W-WALL, GOAL_TOP, WALL, GOAL_BOTTOM-GOAL_TOP);
    ctx.strokeStyle = '#e8e0c8';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, GOAL_TOP, WALL, GOAL_BOTTOM-GOAL_TOP);
    ctx.strokeRect(W-WALL, GOAL_TOP, WALL, GOAL_BOTTOM-GOAL_TOP);

    // subtle stadium vignette for depth
    const vg = ctx.createRadialGradient(W/2,H/2, H*0.25, W/2,H/2, H*0.9);
    vg.addColorStop(0,'rgba(0,0,0,0)');
    vg.addColorStop(1,'rgba(0,0,0,0.28)');
    ctx.fillStyle = vg;
    ctx.fillRect(0,0,W,H);

    drawDiscOn(ctx, p1.x, p1.y, p1.r, p1.color, p1.pattern, p1.number);
    drawDiscOn(ctx, p2.x, p2.y, p2.r, p2.color, p2.pattern, p2.number);

    ctx.beginPath();
    ctx.fillStyle = '#f2e9d0';
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = '#2a1c10';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 3, 0, Math.PI*2);
    ctx.fillStyle = '#2a1c10';
    ctx.fill();

    if(paused && running){
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0,0,W,H);
      ctx.fillStyle = '#e0b84a';
      ctx.font = 'bold 26px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSADO — ESC para continuar', W/2, H/2);
    }
  }

  document.getElementById('btn2p').addEventListener('click', ()=>startGame('2p'));
  document.getElementById('btn1p').addEventListener('click', ()=>startGame('1p'));
  document.getElementById('btnMenu').addEventListener('click', ()=>{
    endOverlay.classList.add('hidden');
    menuOverlay.classList.remove('hidden');
  });

  resetPositions(null);
  draw();
})();
