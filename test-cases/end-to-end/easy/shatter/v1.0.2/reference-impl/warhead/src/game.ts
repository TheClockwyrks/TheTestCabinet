// Shatter — the game: state machine, wave loop, and per-step simulation.
//
// Rendering lives in render.ts and reads this object's public fields. main.ts
// drives it: once-per-frame edge input via handleInput(), then fixed-timestep
// physics via fixedStep().

import { Audio } from "./audio";
import {
  BULLET_LIFE,
  BULLET_R,
  CORE_R,
  EXTRA_LIFE_STEP,
  FIELD_H,
  FIELD_W,
  FIRE_INTERVAL,
  HIT_FLASH_TIME,
  INVULN_TIME,
  MAX_BULLETS,
  MUZZLE_SPEED,
  ROCK,
  ROCK_CHILD,
  SAUCER_AIM_ERROR,
  SAUCER_AVOID_DIST,
  SAUCER_BULLET_LIFE,
  SAUCER_BULLET_SPEED,
  SAUCER_FIRE_INTERVAL,
  SAUCER_FIRST_DELAY,
  SAUCER_GAP_MAX,
  SAUCER_GAP_MIN,
  SAUCER_LIFETIME,
  SAUCER_MAX_TRAVEL,
  SAUCER_R,
  SAUCER_SCORE,
  SAUCER_SPEED,
  SAUCER_WEAVE_INTERVAL,
  SAUCER_WEAVE_SPEED,
  SHIP_DRAG_HALFLIFE,
  SHIP_MAX,
  SHIP_R,
  SHIP_THRUST,
  SHIP_TURN,
  SPLIT_KICK,
  STAR_X,
  STAR_Y,
  START_LIVES,
  TRAIL_TIME,
  TORPEDO_CONE,
  TORPEDO_LIFE,
  TORPEDO_R,
  TORPEDO_RECHARGE,
  TORPEDO_SCATTER,
  TORPEDO_SPEED,
  TORPEDO_TURN,
  WAVE_BANNER_TIME,
  WAVE_BASE_ROCKS,
  WAVE_MIN_SHIP_DIST,
  WAVE_MIN_STAR_DIST,
  WAVE_SPEED_CAP,
  WAVE_SPEED_STEP,
  type RockSize,
} from "./constants";
import {
  Ship,
  driftRock,
  makeRock,
  makeSaucer,
  rand,
  recycleRock,
} from "./entities";
import {
  Input,
  KEY,
  isBack,
  isConfirm,
  isMenuDown,
  isMenuUp,
  isPause,
} from "./input";
import {
  angleDiff,
  gravityAccel,
  shortestDelta,
  sweptHit,
  turnToward,
  wrap,
  wrapBody,
  wrappedDist,
} from "./physics";
import type {
  AppState,
  Bullet,
  EnemyBullet,
  Rock,
  Saucer,
  Torpedo,
  Vec,
} from "./types";

// Append a position to a bullet's motion-trail history, capping it to a fixed
// slice of recent travel time (TRAIL_TIME). dt is the fixed sim step, so the cap
// is a constant sample count; because the window is a slice of *time*, the
// trail's on-screen length scales with the bullet's current speed.
function recordTrail(trail: Vec[], x: number, y: number, dt: number): void {
  trail.push({ x, y });
  const max = Math.max(2, Math.round(TRAIL_TIME / dt) + 1);
  while (trail.length > max) trail.shift();
}

export const TITLE_ITEMS = ["PLAY", "HOW TO PLAY"];
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"];
export const OVER_ITEMS = ["PLAY AGAIN", "MENU"];

export class Game {
  readonly input: Input;
  readonly audio = new Audio();

  state: AppState = "title";
  menuIndex = 0;

  readonly ship = new Ship();
  bullets: Bullet[] = [];
  rocks: Rock[] = [];
  enemyBullets: EnemyBullet[] = [];
  saucer: Saucer | null = null;

  // Warhead secondary weapon: at most one torpedo in flight, at most one stored
  // charge. The charge is a property of the weapon (persists across respawn), so
  // it lives here rather than on the ship. `torpedoTimer` counts the recharge
  // down from TORPEDO_RECHARGE to 0; `torpedoCharged` is true when ready.
  torpedo: Torpedo | null = null;
  torpedoCharged = true;
  torpedoTimer = 0;

  score = 0;
  lives = START_LIVES;
  private nextExtraLife = EXTRA_LIFE_STEP;

  wave = 0;
  waveBannerTimer = 0; // > 0 while the WAVE N banner shows
  private waitingToSpawn = false; // banner up, waiting to spawn the wave

  invuln = 0; // > 0 while the ship is in its post-respawn grace window
  extraLifeTimer = 0; // > 0 while the EXTRA SHIP indicator shows
  thrusting = false; // ship thrust key held this step (for the flame + audio)

  private fireCooldown = 0;
  private saucerCooldown = SAUCER_FIRST_DELAY;

  simTime = 0; // accumulated simulation time (seconds)

  constructor(input: Input) {
    this.input = input;
    this.input.onFirstPress(() => this.audio.resume());
    this.toTitle();
  }

  // ---- State transitions ------------------------------------------------

  private toTitle(): void {
    this.state = "title";
    this.menuIndex = 0;
    this.audio.setThrust(false);
    this.bullets = [];
    this.enemyBullets = [];
    this.saucer = null;
    this.torpedo = null;
    // Pose a little dimmed field furniture behind the menu: a few drifting
    // rocks and the ship parked at the lower left (see reference/title.html).
    this.rocks = [
      makeRock("large", 210, 180, 8, 5),
      makeRock("large", 1080, 560, -6, -7),
      makeRock("medium", 1110, 190, -5, 6),
      makeRock("medium", 220, 590, 7, -4),
      makeRock("small", 1040, 610, -6, -3),
    ];
    this.ship.reset();
    this.ship.x = 300;
    this.ship.y = 480;
    this.ship.angle = (-115 * Math.PI) / 180;
  }

  private startGame(): void {
    this.state = "playing";
    this.score = 0;
    this.lives = START_LIVES;
    this.nextExtraLife = EXTRA_LIFE_STEP;
    this.wave = 0;
    this.waveBannerTimer = 0;
    this.waitingToSpawn = false;
    this.bullets = [];
    this.rocks = [];
    this.enemyBullets = [];
    this.saucer = null;
    // The torpedo begins a new game charged and ready (specs/mode-warhead.md).
    this.torpedo = null;
    this.torpedoCharged = true;
    this.torpedoTimer = 0;
    this.fireCooldown = 0;
    this.saucerCooldown = SAUCER_FIRST_DELAY;
    this.extraLifeTimer = 0;
    this.ship.reset();
    // A brief grace at the very start, like a respawn, so a rock cannot end the
    // game before the player takes control.
    this.invuln = INVULN_TIME;
  }

  private pauseGame(): void {
    this.state = "paused";
    this.menuIndex = 0;
    this.audio.setThrust(false);
  }

  private resumeGame(): void {
    this.state = "playing";
  }

  private gameOver(): void {
    this.state = "gameover";
    this.menuIndex = 0;
    this.audio.setThrust(false);
  }

  // ---- Edge input (once per frame) --------------------------------------

  handleInput(): void {
    for (const code of this.input.drain()) {
      if (code === "KeyM") {
        this.audio.toggleMute();
        continue;
      }
      switch (this.state) {
        case "title":
          this.menuInput(code, TITLE_ITEMS.length, (i) => this.selectTitle(i));
          break;
        case "howto":
          if (isConfirm(code) || isBack(code)) this.toTitle();
          break;
        case "playing":
          if (isPause(code)) this.pauseGame();
          break;
        case "paused":
          if (isBack(code)) {
            this.resumeGame();
          } else {
            this.menuInput(code, PAUSE_ITEMS.length, (i) =>
              this.selectPause(i),
            );
          }
          break;
        case "gameover":
          this.menuInput(code, OVER_ITEMS.length, (i) => this.selectOver(i));
          break;
      }
    }
  }

  private menuInput(
    code: string,
    count: number,
    onConfirm: (index: number) => void,
  ): void {
    if (isMenuUp(code)) {
      this.menuIndex = (this.menuIndex + count - 1) % count;
    } else if (isMenuDown(code)) {
      this.menuIndex = (this.menuIndex + 1) % count;
    } else if (isConfirm(code)) {
      onConfirm(this.menuIndex);
    }
  }

  private selectTitle(i: number): void {
    if (i === 0) this.startGame();
    else this.state = "howto";
  }

  private selectPause(i: number): void {
    if (i === 0) this.resumeGame();
    else if (i === 1) this.startGame();
    else this.toTitle();
  }

  private selectOver(i: number): void {
    if (i === 0) this.startGame();
    else this.toTitle();
  }

  // ---- Fixed-timestep update --------------------------------------------

  fixedStep(dt: number): void {
    if (this.state === "title") {
      this.stepTitle(dt);
    } else if (this.state === "playing") {
      this.stepPlaying(dt);
    }
    this.simTime += dt;
  }

  // On the title screen the furniture just drifts and tumbles (no gravity, no
  // collisions) as calm ambiance behind the menu.
  private stepTitle(dt: number): void {
    for (const r of this.rocks) {
      r.x = wrap(r.x + r.vx * dt, FIELD_W);
      r.y = wrap(r.y + r.vy * dt, FIELD_H);
      r.angle += r.spin * dt;
    }
  }

  private stepPlaying(dt: number): void {
    this.updateShip(dt);
    this.updateFire(dt);
    this.updateTorpedoCharge(dt);
    this.updateBullets(dt);
    this.updateRocks(dt);
    this.updateTorpedo(dt);
    this.updateSaucer(dt);
    this.updateEnemyBullets(dt);
    this.resolveCollisions(dt);
    this.updateWaves(dt);
    this.updateSaucerSpawn(dt);

    this.invuln = Math.max(0, this.invuln - dt);
    this.extraLifeTimer = Math.max(0, this.extraLifeTimer - dt);
  }

  // ---- The ship ---------------------------------------------------------

  private updateShip(dt: number): void {
    const ship = this.ship;
    const i = this.input;

    if (KEY.left(i)) ship.angle -= SHIP_TURN * dt;
    if (KEY.right(i)) ship.angle += SHIP_TURN * dt;

    this.thrusting = KEY.thrust(i);
    if (this.thrusting) {
      ship.vx += Math.cos(ship.angle) * SHIP_THRUST * dt;
      ship.vy += Math.sin(ship.angle) * SHIP_THRUST * dt;
    }
    this.audio.setThrust(this.thrusting);

    // Gentle drag so an un-thrusting ship coasts to a crawl.
    const drag = Math.pow(0.5, dt / SHIP_DRAG_HALFLIFE);
    ship.vx *= drag;
    ship.vy *= drag;

    // Speed cap (after thrust).
    const sp = ship.speed;
    if (sp > SHIP_MAX) {
      const k = SHIP_MAX / sp;
      ship.vx *= k;
      ship.vy *= k;
    }

    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    wrapBody(ship);

    // The solid, non-lethal core: slide the ship along its surface.
    this.slideOffCore(ship, SHIP_R);
  }

  // Push a body's center out to (CORE_R + bodyR) from the star and remove the
  // component of its velocity heading into the core, keeping the tangential
  // part — so it grazes around the surface. Uses the direct vector (the star is
  // a single central point, never near a wrap seam).
  private slideOffCore(
    body: { x: number; y: number; vx: number; vy: number },
    bodyR: number,
  ): void {
    const dx = body.x - STAR_X;
    const dy = body.y - STAR_Y;
    const d = Math.hypot(dx, dy);
    const minD = CORE_R + bodyR;
    if (d >= minD || d === 0) return;
    const nx = dx / d;
    const ny = dy / d;
    body.x = STAR_X + nx * minD;
    body.y = STAR_Y + ny * minD;
    const vn = body.vx * nx + body.vy * ny; // velocity along the outward normal
    if (vn < 0) {
      body.vx -= vn * nx;
      body.vy -= vn * ny;
    }
  }

  private updateFire(dt: number): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (
      KEY.fire(this.input) &&
      this.fireCooldown === 0 &&
      this.bullets.length < MAX_BULLETS
    ) {
      const nose = this.ship.nose();
      const c = Math.cos(this.ship.angle);
      const s = Math.sin(this.ship.angle);
      this.bullets.push({
        x: nose.x,
        y: nose.y,
        vx: this.ship.vx + c * MUZZLE_SPEED,
        vy: this.ship.vy + s * MUZZLE_SPEED,
        life: BULLET_LIFE,
        trail: [{ x: nose.x, y: nose.y }],
      });
      this.fireCooldown = FIRE_INTERVAL;
      this.audio.fire();
    }

    // Secondary fire (F): launch the guided torpedo if one is charged and none
    // is already in flight.
    if (KEY.torpedo(this.input)) this.tryLaunchTorpedo();
  }

  // ---- The torpedo (Warhead secondary weapon) ---------------------------

  private updateTorpedoCharge(dt: number): void {
    if (this.torpedoCharged) return;
    this.torpedoTimer = Math.max(0, this.torpedoTimer - dt);
    if (this.torpedoTimer <= 0) this.torpedoCharged = true;
  }

  // Charge fraction for the HUD bar: full when ready, else filling 0 -> 1 across
  // the recharge.
  torpedoChargeFrac(): number {
    if (this.torpedoCharged) return 1;
    return 1 - this.torpedoTimer / TORPEDO_RECHARGE;
  }

  private tryLaunchTorpedo(): void {
    if (!this.torpedoCharged || this.torpedo) return;
    const nose = this.ship.nose();
    const angle = this.ship.angle;
    // Self-propelled: it leaves along the ship's facing at its own speed and
    // does NOT inherit the ship's drift.
    this.torpedo = {
      x: nose.x,
      y: nose.y,
      vx: Math.cos(angle) * TORPEDO_SPEED,
      vy: Math.sin(angle) * TORPEDO_SPEED,
      angle,
      life: TORPEDO_LIFE,
    };
    this.torpedoCharged = false;
    this.torpedoTimer = TORPEDO_RECHARGE;
    this.audio.torpedo();
  }

  private updateTorpedo(dt: number): void {
    const t = this.torpedo;
    if (!t) return;
    // Look for the nearest rock or saucer within the forward acquisition cone
    // and turn toward it; otherwise keep the current heading. It is powered, so
    // gravity never acts on it — it holds its heading through the well.
    const target = this.findTorpedoTarget(t);
    if (target) {
      const d = shortestDelta(t.x, t.y, target.x, target.y);
      const desired = Math.atan2(d.dy, d.dx);
      t.angle = turnToward(t.angle, desired, TORPEDO_TURN * dt);
    }
    t.vx = Math.cos(t.angle) * TORPEDO_SPEED;
    t.vy = Math.sin(t.angle) * TORPEDO_SPEED;
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    wrapBody(t);
    t.life -= dt;
    if (t.life <= 0) this.torpedo = null;
  }

  // The nearest rock or saucer whose bearing lies within +/- TORPEDO_CONE of the
  // torpedo's current heading (a forward-only cone, so it can never double back),
  // by shortest wrapped distance.
  private findTorpedoTarget(t: Torpedo): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    const consider = (x: number, y: number): void => {
      const d = shortestDelta(t.x, t.y, x, y);
      const dist = Math.hypot(d.dx, d.dy);
      if (dist === 0 || dist >= bestDist) return;
      const bearing = Math.atan2(d.dy, d.dx);
      if (Math.abs(angleDiff(bearing, t.angle)) > TORPEDO_CONE) return;
      bestDist = dist;
      best = { x, y };
    };
    for (const r of this.rocks) consider(r.x, r.y);
    if (this.saucer) consider(this.saucer.x, this.saucer.y);
    return best;
  }

  // ---- Ballistic bodies (pulled by gravity) -----------------------------

  private updateBullets(dt: number): void {
    const keep: Bullet[] = [];
    for (const b of this.bullets) {
      const g = gravityAccel(b.x, b.y);
      b.vx += g.ax * dt;
      b.vy += g.ay * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      wrapBody(b);
      recordTrail(b.trail, b.x, b.y, dt);
      b.life -= dt;
      if (b.life > 0) keep.push(b);
    }
    this.bullets = keep;
  }

  private updateRocks(dt: number): void {
    for (const r of this.rocks) {
      const g = gravityAccel(r.x, r.y);
      r.vx += g.ax * dt;
      r.vy += g.ay * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      wrapBody(r);
      r.angle += r.spin * dt;
      if (r.hitFlash > 0) r.hitFlash = Math.max(0, r.hitFlash - dt);
    }
  }

  private updateEnemyBullets(dt: number): void {
    const keep: EnemyBullet[] = [];
    for (const b of this.enemyBullets) {
      const g = gravityAccel(b.x, b.y);
      b.vx += g.ax * dt;
      b.vy += g.ay * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      wrapBody(b);
      b.life -= dt;
      if (b.life > 0) keep.push(b);
    }
    this.enemyBullets = keep;
  }

  // ---- The saucer -------------------------------------------------------

  private updateSaucer(dt: number): void {
    const s = this.saucer;
    if (!s) return;

    // Weave: reroll the vertical direction every so often.
    s.weaveTimer -= dt;
    if (s.weaveTimer <= 0) {
      s.vy = rand(-1, 1) * SAUCER_WEAVE_SPEED;
      s.weaveTimer = SAUCER_WEAVE_INTERVAL;
    }

    // Steer clear of the star's core: within the avoid radius, push straight
    // away from the star vertically so the saucer arcs around it.
    const dx = s.x - STAR_X;
    const dy = s.y - STAR_Y;
    if (Math.abs(dx) < SAUCER_AVOID_DIST && Math.abs(dy) < SAUCER_AVOID_DIST) {
      const away = dy >= 0 ? 1 : -1;
      s.vy = away * SAUCER_WEAVE_SPEED * 1.5;
    }

    s.x += s.vx * dt;
    s.y += s.vy * dt;
    wrapBody(s);
    // A hard guarantee it never overlaps the core.
    this.slideOffCore(s, SAUCER_R);

    s.age += dt;
    s.travel += Math.abs(s.vx) * dt;

    // Firing: an aimed shot with a little random error.
    s.fireTimer -= dt;
    if (s.fireTimer <= 0) {
      this.fireSaucerBullet(s);
      s.fireTimer = SAUCER_FIRE_INTERVAL;
    }

    if (s.age >= SAUCER_LIFETIME || s.travel >= SAUCER_MAX_TRAVEL) {
      this.saucer = null;
    }
  }

  private fireSaucerBullet(s: Saucer): void {
    // Aim at the ship across the shortest wrapped path, with +/- error.
    const d = shortestDelta(s.x, s.y, this.ship.x, this.ship.y);
    const aim =
      Math.atan2(d.dy, d.dx) + rand(-SAUCER_AIM_ERROR, SAUCER_AIM_ERROR);
    this.enemyBullets.push({
      x: s.x,
      y: s.y,
      vx: s.vx + Math.cos(aim) * SAUCER_BULLET_SPEED,
      vy: s.vy + Math.sin(aim) * SAUCER_BULLET_SPEED,
      life: SAUCER_BULLET_LIFE,
    });
  }

  private updateSaucerSpawn(dt: number): void {
    if (this.saucer) return; // at most one at a time
    this.saucerCooldown -= dt;
    if (this.saucerCooldown <= 0) {
      this.saucer = makeSaucer(SAUCER_SPEED, SAUCER_WEAVE_SPEED);
      this.saucerCooldown = rand(SAUCER_GAP_MIN, SAUCER_GAP_MAX);
      this.audio.saucer();
    }
  }

  // ---- Collision resolution ---------------------------------------------

  private resolveCollisions(dt: number): void {
    // Ship-fired bullets: against the core (absorbed), the saucer, then rocks.
    const keep: Bullet[] = [];
    for (const b of this.bullets) {
      if (this.bulletHitsCore(b, dt)) continue; // absorbed by the star
      if (this.saucer && this.bulletHitsBody(b, this.saucer, SAUCER_R, dt)) {
        this.destroySaucer();
        continue;
      }
      const ri = this.firstRockHit(b, dt);
      if (ri >= 0) {
        this.hitRockWithBullet(ri, b);
        continue; // the bullet is spent on any hit, fatal or not
      }
      keep.push(b);
    }
    this.bullets = keep;

    // The torpedo: absorbed by the core, or destroys the saucer or a rock (any
    // size, any armor) in one hit, then is removed.
    if (this.torpedo) {
      const t = this.torpedo;
      if (this.bodyHitsCore(t.x, t.y, t.vx, t.vy, TORPEDO_R, dt)) {
        this.torpedo = null;
      } else if (
        this.saucer &&
        this.movingHitsBody(t.x, t.y, t.vx, t.vy, TORPEDO_R, this.saucer, SAUCER_R, dt)
      ) {
        this.destroySaucer();
        this.torpedo = null;
      } else {
        const ti = this.firstRockHitByTorpedo(t, dt);
        if (ti >= 0) {
          // Torpedo kill: harder radial scatter than a bullet shatter.
          const axis = Math.atan2(t.vy, t.vx) + Math.PI / 2;
          this.destroyRock(ti, axis, TORPEDO_SCATTER);
          this.torpedo = null;
        }
      }
    }

    // Rocks pulled into the core are recycled to the edge (no score). The
    // recycle carries the rock's remaining health across — a damaged rock
    // re-enters just as damaged (specs/mode-warhead.md) — while resetting its
    // move speed to a fresh base drift so it doesn't keep accelerating.
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      if (this.bodyHitsCore(r.x, r.y, r.vx, r.vy, r.radius, dt)) {
        this.rocks[i] = recycleRock(r.size, r.hp);
      }
    }

    // Saucer bullets absorbed by the core.
    this.enemyBullets = this.enemyBullets.filter(
      (b) => !this.bulletHitsCore(b, dt),
    );

    // The ship: the core is non-lethal (handled in updateShip). During the
    // invulnerability window the ship ignores every lethal collision.
    if (this.invuln <= 0) {
      let dead = false;
      for (const r of this.rocks) {
        if (wrappedDist(this.ship.x, this.ship.y, r.x, r.y) <= SHIP_R + r.radius) {
          dead = true;
          break;
        }
      }
      if (!dead && this.saucer) {
        if (
          wrappedDist(this.ship.x, this.ship.y, this.saucer.x, this.saucer.y) <=
          SHIP_R + SAUCER_R
        ) {
          dead = true;
        }
      }
      if (!dead) {
        for (const b of this.enemyBullets) {
          if (wrappedDist(this.ship.x, this.ship.y, b.x, b.y) <= SHIP_R + BULLET_R) {
            dead = true;
            break;
          }
        }
      }
      if (dead) this.killShip();
    }
  }

  private bulletHitsCore(b: Bullet | EnemyBullet, dt: number): boolean {
    return this.bodyHitsCore(b.x, b.y, b.vx, b.vy, BULLET_R, dt);
  }

  private bodyHitsCore(
    x: number,
    y: number,
    vx: number,
    vy: number,
    r: number,
    dt: number,
  ): boolean {
    // Direct vector to the star: the core is a single central point.
    return sweptHit(x - STAR_X, y - STAR_Y, vx, vy, CORE_R + r, dt);
  }

  private bulletHitsBody(
    b: Bullet,
    target: { x: number; y: number; vx: number; vy: number },
    targetR: number,
    dt: number,
  ): boolean {
    return this.movingHitsBody(b.x, b.y, b.vx, b.vy, BULLET_R, target, targetR, dt);
  }

  // Swept overlap of a moving circle (a bullet or a torpedo) against a moving
  // body, using the shortest wrapped separation.
  private movingHitsBody(
    x: number,
    y: number,
    vx: number,
    vy: number,
    r: number,
    target: { x: number; y: number; vx: number; vy: number },
    targetR: number,
    dt: number,
  ): boolean {
    const rel = shortestDelta(target.x, target.y, x, y); // self - target
    return sweptHit(
      rel.dx,
      rel.dy,
      vx - target.vx,
      vy - target.vy,
      r + targetR,
      dt,
    );
  }

  private firstRockHit(b: Bullet, dt: number): number {
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      if (this.bulletHitsBody(b, r, r.radius, dt)) return i;
    }
    return -1;
  }

  private firstRockHitByTorpedo(t: Torpedo, dt: number): number {
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      if (this.movingHitsBody(t.x, t.y, t.vx, t.vy, TORPEDO_R, r, r.radius, dt)) {
        return i;
      }
    }
    return -1;
  }

  // A bullet reached a rock. In Warhead the rock is armored: the hit lowers its
  // health by 1 and only the hit that drops it to 0 destroys it. A non-fatal hit
  // flashes the rock and leaves it intact (no split, no score).
  private hitRockWithBullet(index: number, bullet: Bullet): void {
    const rock = this.rocks[index];
    rock.hp -= 1;
    if (rock.hp > 0) {
      rock.hitFlash = HIT_FLASH_TIME;
      this.audio.hit();
      return;
    }
    // The killing hit: split fragments to opposite sides of the shot direction.
    const axis = Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2;
    this.destroyRock(index, axis, SPLIT_KICK);
  }

  // Destroy a rock: award its score, remove it, and split it into two children
  // (if any) blasted to opposite sides of `axis` at `kick` px/s. A bullet kill
  // fans them perpendicular to the shot at SPLIT_KICK; a torpedo kill blasts them
  // apart at the much larger TORPEDO_SCATTER.
  private destroyRock(index: number, axis: number, kick: number): void {
    const rock = this.rocks[index];
    this.addScore(ROCK[rock.size].score);
    this.rocks.splice(index, 1);

    const child: RockSize | null = ROCK_CHILD[rock.size];
    if (child) {
      const kx = Math.cos(axis) * kick;
      const ky = Math.sin(axis) * kick;
      // Fragments re-enter at full health for their size (makeRock).
      this.rocks.push(
        makeRock(child, rock.x, rock.y, rock.vx + kx, rock.vy + ky),
        makeRock(child, rock.x, rock.y, rock.vx - kx, rock.vy - ky),
      );
    }
    this.audio.shatter();
  }

  private destroySaucer(): void {
    this.addScore(SAUCER_SCORE);
    this.saucer = null;
    this.audio.shatter();
  }

  private killShip(): void {
    this.audio.death();
    this.audio.setThrust(false);
    this.lives -= 1;
    if (this.lives <= 0) {
      this.gameOver();
      return;
    }
    this.ship.reset();
    this.invuln = INVULN_TIME;
  }

  private addScore(points: number): void {
    this.score += points;
    while (this.score >= this.nextExtraLife) {
      this.lives += 1;
      this.nextExtraLife += EXTRA_LIFE_STEP;
      this.extraLifeTimer = 2.0;
      this.audio.extraLife();
    }
  }

  // ---- Waves ------------------------------------------------------------

  private updateWaves(dt: number): void {
    // A cleared field (only ever by shooting every rock) advances the wave.
    if (this.rocks.length === 0 && !this.waitingToSpawn && this.waveBannerTimer <= 0) {
      this.wave += 1;
      this.waveBannerTimer = WAVE_BANNER_TIME;
      this.waitingToSpawn = true;
    }
    if (this.waitingToSpawn) {
      this.waveBannerTimer -= dt;
      if (this.waveBannerTimer <= 0) {
        this.spawnWave(this.wave);
        this.waitingToSpawn = false;
      }
    }
  }

  private spawnWave(n: number): void {
    const count = WAVE_BASE_ROCKS + n;
    const speedMult = 1 + Math.min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (n - 1));
    for (let i = 0; i < count; i++) {
      const pos = this.findSpawnPos();
      this.rocks.push(driftRock("large", pos.x, pos.y, speedMult));
    }
  }

  // A random field position at least WAVE_MIN_SHIP_DIST from the ship and
  // WAVE_MIN_STAR_DIST from the star. Rejection-sampled with a bounded number
  // of tries so it always terminates.
  private findSpawnPos(): { x: number; y: number } {
    for (let tries = 0; tries < 200; tries++) {
      const x = rand(0, FIELD_W);
      const y = rand(0, FIELD_H);
      if (wrappedDist(x, y, this.ship.x, this.ship.y) < WAVE_MIN_SHIP_DIST) {
        continue;
      }
      if (Math.hypot(x - STAR_X, y - STAR_Y) < WAVE_MIN_STAR_DIST) continue;
      return { x, y };
    }
    // Fallback: a corner, far from both the central star and the below-star
    // safe point.
    return { x: 80, y: 80 };
  }

  // ---- Render-facing helpers --------------------------------------------

  // Whether the ship is drawn this frame: it blinks during invulnerability.
  shipVisible(): boolean {
    if (this.invuln <= 0) return true;
    return Math.floor(this.simTime * 12) % 2 === 0;
  }
}
