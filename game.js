// ═══════════════════════════════════════════════════════════════
//  SETUP — canvas, DOM refs, and shared input state
// ═══════════════════════════════════════════════════════════════

const c   = document.getElementById('c');
const ctx = c.getContext('2d');
const W = 480, H = 520;          // canvas dimensions

const overlay = document.getElementById('overlay');
const btn     = document.getElementById('btn');

// Track which keys are currently held down
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.key] = true;
  // Space / Enter starts the game when not already playing
  if ((e.key === ' ' || e.key === 'Enter') && !running) start();
  // Prevent the page from scrolling when arrow keys / space are pressed
  if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => keys[e.key] = false);
btn.addEventListener('click', start);


// ═══════════════════════════════════════════════════════════════
//  GAME STATE — everything that resets when a new game starts
// ═══════════════════════════════════════════════════════════════

let score;    // current score (increases automatically over time)
let best = 0; // all-time best score (persists across rounds)
let lives;    // remaining hull points (starts at 3)
let ship;     // the player object  { x, y, vx, inv, flicker }
let rocks;    // array of asteroid objects currently on screen
let sparks;   // array of explosion particle objects
let spawnT;   // countdown (seconds) until the next asteroid spawns
let lastT;    // timestamp of the previous frame, used to compute dt
let raf;      // requestAnimationFrame handle so we can cancel it
let running;  // true while the game loop is active


// ═══════════════════════════════════════════════════════════════
//  STARS — created once and reused every game
// ═══════════════════════════════════════════════════════════════

let stars;

// Build 80 stars with random positions, sizes, and fall speeds
function mkStars() {
  stars = Array.from({length: 80}, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * 1.2,        // radius (small dots)
    a: 0.2 + Math.random() * 0.5,  // opacity
    v: 8 + Math.random() * 18      // fall speed in px/s
  }));
}
mkStars(); // call once on page load


// ═══════════════════════════════════════════════════════════════
//  DIFFICULTY HELPERS
// ═══════════════════════════════════════════════════════════════

// Pad a number to 6 digits for the score display (e.g. 42 → "000042")
const fmt = n => String(Math.floor(n)).padStart(6, '0');

// Current level: increases every 150 score points (1, 2, 3 ...)
const lvl = () => Math.floor(score / 150) + 1;

// Asteroid speed multiplier: grows with each level and ramps
// smoothly within the level via the fractional part of score
const spd = () => 1 + (lvl() - 1) * 0.28 + (score % 150) * 0.001;


// ═══════════════════════════════════════════════════════════════
//  START / END
// ═══════════════════════════════════════════════════════════════

function start() {
  // Reset all game state
  score = 0; lives = 3;
  rocks = []; sparks = [];
  spawnT = 0; lastT = null;

  // Place ship in the bottom-centre of the canvas
  ship = { x: W / 2, y: H - 70, vx: 0, inv: 0, flicker: 0 };

  overlay.style.display = 'none'; // hide start/game-over screen
  cancelAnimationFrame(raf);      // stop any previous loop
  running = true;
  raf = requestAnimationFrame(loop);
}

function end() {
  running = false;
  if (score > best) best = score;

  // Update the overlay to show game-over info, then reveal it
  document.getElementById('bs').textContent = fmt(best);
  document.getElementById('result').textContent =
    'Score: ' + fmt(score) + '  ·  Level ' + lvl();
  overlay.querySelector('h2').textContent = 'DESTROYED';
  btn.textContent = 'RETRY';
  overlay.style.display = 'flex';
}


// ═══════════════════════════════════════════════════════════════
//  ASTEROID SPAWNING
// ═══════════════════════════════════════════════════════════════

function spawnRock() {
  const lv = lvl();
  const r  = 14 + Math.random() * 20; // random radius

  rocks.push({
    x: r + Math.random() * (W - r * 2), // random horizontal start, kept on-screen
    y: -r,                              // just above the top edge

    r,                                  // radius (also used for collision)
    vx: (Math.random() - .5) * Math.min(40 + lv * 15, 130), // lateral drift grows with level
    vy: (60 + Math.random() * 80) * spd(),                  // downward speed scales with difficulty

    rot: Math.random() * Math.PI * 2,         // initial rotation angle
    rv:  (Math.random() - .5) * 2 * (1 + lv * 0.1), // rotation speed grows with level

    // Generate a lumpy polygon by placing vertices at irregular radii
    pts: Array.from({length: 8 + Math.floor(Math.random() * 4)}, (_, i, a) => {
      const ang = (i / a.length) * Math.PI * 2;
      const rad = 0.7 + Math.random() * 0.3; // 0.7–1.0 fraction of r
      return [Math.cos(ang) * rad, Math.sin(ang) * rad];
    }),

    col: Math.random() > .3 ? '#4a6a80' : '#6a4a55' // blue-grey or red-grey
  });
}


// ═══════════════════════════════════════════════════════════════
//  MAIN GAME LOOP  (called ~60 times per second by the browser)
// ═══════════════════════════════════════════════════════════════

function loop(ts) {
  // dt = seconds since last frame (capped to avoid huge jumps after tab switches)
  if (!lastT) lastT = ts;
  const dt = Math.min((ts - lastT) / 1000, 0.05);
  lastT = ts;

  // Score grows automatically with time
  score += dt * 10;
  const lv = lvl();


  // ── Update HUD ──────────────────────────────────────────────
  document.getElementById('sc').textContent = fmt(score);
  document.getElementById('lv').textContent = String(lv).padStart(2, '0');
  // Level colour shifts from orange → red as danger increases
  const danger = Math.min((lv - 1) / 9, 1);
  document.getElementById('lv').style.color = `rgb(255,${Math.round(154 * (1 - danger))},0)`;
  document.getElementById('hp').textContent = '❤'.repeat(lives) + '🖤'.repeat(3 - lives);


  // ── Draw background ─────────────────────────────────────────
  ctx.fillStyle = '#050a0f';
  ctx.fillRect(0, 0, W, H);

  // Faint cyan grid lines for the retro feel
  ctx.strokeStyle = 'rgba(0,229,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }


  // ── Draw & scroll stars ─────────────────────────────────────
  // Stars fall faster at higher levels to sell the sensation of speed
  const starSpeed = 1 + (lv - 1) * 0.4;
  stars.forEach(s => {
    s.y += s.v * dt * starSpeed;
    if (s.y > H) { s.y = 0; s.x = Math.random() * W; } // wrap to top
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;


  // ── Spawn asteroids ─────────────────────────────────────────
  spawnT -= dt;
  if (spawnT <= 0) {
    // Spawn interval shrinks each level (floor of 0.12 s)
    const interval = Math.max(0.12, 0.85 - (lv - 1) * 0.07);
    spawnT = interval * (0.6 + Math.random() * 0.7); // add randomness

    // Higher levels can spawn 2 or 3 rocks at once
    const count = lv >= 8 ? 3 : (lv >= 4 && Math.random() < .5) ? 2 : 1;
    for (let i = 0; i < count; i++) spawnRock();
  }


  // ── Update & draw asteroids ─────────────────────────────────
  rocks = rocks.filter(r => r.y < H + r.r * 2); // remove ones that left the screen
  rocks.forEach(r => {
    r.x   += r.vx  * dt;
    r.y   += r.vy  * dt;
    r.rot += r.rv  * dt;

    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.rot);
    ctx.beginPath();
    r.pts.forEach(([px, py], i) =>
      i ? ctx.lineTo(px * r.r, py * r.r) : ctx.moveTo(px * r.r, py * r.r)
    );
    ctx.closePath();
    ctx.fillStyle   = r.col;     ctx.fill();
    ctx.strokeStyle = '#8aacbe'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  });


  // ── Update & draw explosion sparks ──────────────────────────
  sparks = sparks.filter(p => p.life > 0); // remove dead sparks
  sparks.forEach(p => {
    p.x   += p.vx * dt;
    p.y   += p.vy * dt;
    p.vy  += 80 * dt;   // gravity pulls sparks down
    p.life -= dt * 2.5; // fade out over ~0.4 s

    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;


  // ── Move the ship ────────────────────────────────────────────
  ship.inv     = Math.max(0, ship.inv - dt); // count down invincibility timer
  ship.flicker += dt * 18;                   // angle used for thruster animation

  if      (keys['ArrowLeft']  || keys['a'] || keys['A']) ship.vx = -300;
  else if (keys['ArrowRight'] || keys['d'] || keys['D']) ship.vx =  300;
  else ship.vx *= 0.7; // friction: slide to a stop when no key is held

  // Clamp to canvas edges
  ship.x = Math.max(22, Math.min(W - 22, ship.x + ship.vx * dt));


  // ── Draw the ship ────────────────────────────────────────────
  // Blink (skip drawing) while invincible after a hit
  const blinking = ship.inv > 0 && Math.floor(ship.inv * 10) % 2 === 0;
  if (!blinking) {
    ctx.save();
    ctx.translate(ship.x, ship.y);

    // Animated thruster flame below the ship body
    const thrustLen = 6 + Math.sin(ship.flicker) * 3;
    ctx.fillStyle   = '#ff6a00';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(-6, 14); ctx.lineTo(0, 14 + thrustLen); ctx.lineTo(6, 14);
    ctx.fill();

    // Ship body (a simple arrowhead polygon)
    ctx.globalAlpha = 1;
    ctx.fillStyle   = '#00e5ff';
    ctx.beginPath();
    ctx.moveTo(0, -16); ctx.lineTo(13, 14); ctx.lineTo(8, 10);
    ctx.lineTo(0,  14); ctx.lineTo(-8, 10); ctx.lineTo(-13, 14);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }


  // ── Collision detection ──────────────────────────────────────
  // Only check if the ship isn't currently invincible
  if (ship.inv <= 0) {
    for (const r of rocks) {
      // Simple circle vs circle check (ship hitbox radius ≈ 11px)
      if (Math.hypot(r.x - ship.x, r.y - ship.y) < r.r + 11) {
        lives--;
        ship.inv = 2.0; // 2 seconds of invincibility after a hit

        // Burst of coloured sparks at the ship's position
        const cols = ['#ff4d6d', '#ff9a3c', '#ffdf80', '#fff'];
        for (let i = 0; i < 18; i++) {
          sparks.push({
            x: ship.x, y: ship.y,
            vx: (Math.random() - .5) * 200,
            vy: (Math.random() - .5) * 200 - 60,
            life: 1,
            r:   2 + Math.random() * 3,
            col: cols[i % 4]
          });
        }

        if (lives <= 0) { end(); return; } // no lives left → game over
        break; // only take one hit per frame
      }
    }
  }

  raf = requestAnimationFrame(loop); // schedule the next frame
}
