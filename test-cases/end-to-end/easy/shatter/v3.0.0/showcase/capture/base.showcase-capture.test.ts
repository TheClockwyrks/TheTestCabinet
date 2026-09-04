// showcase-capture — record a REAL GAMEPLAY clip for the `base` case showcase.
//
// NOT A VALIDATOR. No review item names this file, it lives outside
// `validation/` so a run never loads it, and it is staged into the reference
// workspace by hand (see the README beside it). It is the case's own validator
// harness reused as a recording rig.
//
// WHAT IT DOES. It opens a real game the way a player does — the title screen,
// then `PLAY` confirmed with a real key edge — and then flies the ship with
// scripted keyboard input for half a minute: turning, thrusting, firing, and
// dodging. Nothing is posed mid-play. The only debug operation the take uses is
// `reset({seed})`, which is how a take is made reproducible, and it runs before
// the game opens. Every rock that breaks, every wave that turns over and every
// saucer that arrives on screen is the build's own rules answering that input.
//
// HOW THE PLAYER AIMS. Shatter's whole idea is that the well bends a shot, so
// "point at the rock and fire" misses almost everything. The player therefore
// PLANS through the game's own rules: a candidate facing is flown forward as a
// bullet under `specs/gravity.md`'s law and `specs/field.md`'s wrap — the
// spec-derived oracle in `validation/geometry.ts`, the same arithmetic the
// validators hold the build to — against every rock flown forward the same way,
// and the facing whose round lands is the one the ship turns to. A shot that has
// to curve around the star to reach its rock is found by that search exactly as
// a straight one is, which is why the clip shows both.
//
// HOW IT FIRES. Not on an angle it decided earlier: on every frame the gun's
// gate is open, the round the ship would fire RIGHT NOW is flown forward, and
// the trigger is pulled only if that round lands. Steering and firing are
// therefore decided against the same live world, and the ship never spends a
// shot on a solution the world has since moved out from under.
//
// HOW IT FLIES. Two rules over the aim. A ship at rest is a dull ship, so the
// player holds a speed band: below `ROAM_MIN` it turns onto a chosen heading and
// thrusts until it is over `ROAM_TARGET`, which is what puts the ship on the
// drifting, wrapping courses the game is about. And a rock closing on the ship
// inside `EVADE_SECONDS` takes precedence over everything: the ship turns away
// from where that rock will be and burns clear.
//
// Run it from the reference workspace root — see `README.md` beside this file.

import { afterEach, beforeEach, it } from "vitest";
import {
  BULLET_LIFE,
  BULLET_R,
  CORE_R,
  FIELD_H,
  FIELD_W,
  MAX_BULLETS,
  MUZZLE_SPEED,
  ROCK_RADIUS,
  SAUCER_BULLET_R,
  SAUCER_GAP_MIN,
  SAUCER_R,
  SCORE_SAUCER,
  SHIP_DRAG_HALFLIFE,
  SHIP_R,
  SHIP_TURN,
  TICK_DT,
  TICK_HZ,
} from "../src/constants";
import {
  captureReplay,
  captureStill,
  clearCalls,
  createHarness,
  keysFor,
  resetTo,
  tapAction,
  type Harness,
  type ShatterSnapshot,
} from "./harness";
import {
  angleDelta,
  bearing,
  directDistance,
  gravityAt,
  STAR,
  unit,
  wrapPoint,
  wrappedDistance,
  type Vec,
} from "./geometry";

/* -------------------------------------------------------------------------- */
/* The knobs                                                                  */
/* -------------------------------------------------------------------------- */

const num = (name: string, fallback: number): number =>
  Number(process.env[name] ?? String(fallback));

/** The earliest the clip may end, in seconds of game time. */
const MIN_SECONDS = num("TCAB_SHOWCASE_MIN_SECONDS", 26);
/** The hard ceiling, past which a take ends wherever it stands. */
const MAX_SECONDS = num("TCAB_SHOWCASE_MAX_SECONDS", 36);
/** The seeds auditioned, each crossed with every roam phase. */
const SEEDS = (process.env.TCAB_SHOWCASE_SEEDS ?? "1,2,3,4,5,6,7,8")
  .split(",")
  .map((entry) => Number(entry.trim()));
/** The roam phases auditioned. */
const PHASES = (process.env.TCAB_SHOWCASE_PHASES ?? "0,1,2")
  .split(",")
  .map((entry) => Number(entry.trim()));
/** `<seed>:<phase>` records that take and auditions nothing. */
const FORCED = process.env.TCAB_SHOWCASE_TAKE;

/* -------------------------------------------------------------------------- */
/* Flying the world forward, under the specification's own rules              */
/* -------------------------------------------------------------------------- */

/** A body with a place and a course, in the field's logical units. */
interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * One tick of a BALLISTIC body — a bullet, a rock, a saucer bullet — exactly as
 * specs/simulation.md orders it: the well's acceleration, then the velocity, then
 * the position, then the wrap.
 */
function stepBallistic(body: Body): Body {
  const a = gravityAt(body);
  const vx = body.vx + a.x * TICK_DT;
  const vy = body.vy + a.y * TICK_DT;
  const p = wrapPoint({ x: body.x + vx * TICK_DT, y: body.y + vy * TICK_DT });
  return { x: p.x, y: p.y, vx, vy };
}

/** One tick of the SHIP under no thrust: drag, then the position, then the wrap. */
function stepCoastingShip(body: Body): Body {
  const decay = Math.pow(0.5, TICK_DT / SHIP_DRAG_HALFLIFE);
  const vx = body.vx * decay;
  const vy = body.vy * decay;
  const p = wrapPoint({ x: body.x + vx * TICK_DT, y: body.y + vy * TICK_DT });
  return { x: p.x, y: p.y, vx, vy };
}

/** Where a ballistic body stands at each of the next `steps` ticks. */
function ballisticPath(body: Body, steps: number): Vec[] {
  const path: Vec[] = [];
  let at = body;
  for (let i = 0; i < steps; i += 1) {
    at = stepBallistic(at);
    path.push({ x: at.x, y: at.y });
  }
  return path;
}

/** Where the coasting ship stands at each of the next `steps` ticks. */
function shipPath(body: Body, steps: number): Vec[] {
  const path: Vec[] = [];
  let at = body;
  for (let i = 0; i < steps; i += 1) {
    at = stepCoastingShip(at);
    path.push({ x: at.x, y: at.y });
  }
  return path;
}

/* -------------------------------------------------------------------------- */
/* What the player is shooting at                                             */
/* -------------------------------------------------------------------------- */

/** How far ahead a planned round is flown: the whole of its life. */
const SHOT_TICKS = Math.round(BULLET_LIFE * TICK_HZ);
/** How far ahead the player looks for something about to hit it. */
const EVADE_SECONDS = 0.95;
const THREAT_TICKS = Math.round(EVADE_SECONDS * TICK_HZ);

/** A body the round is being flown against, with its own course laid out. */
interface Mark {
  path: Vec[];
  radius: number;
  /** What landing on it is worth to the player, as a tiebreak alone. */
  worth: number;
}

/**
 * Every rock a round can be spent on, each flown forward under the well.
 *
 * A rock is ballistic (specs/gravity.md), so where it will be in a second and a
 * half is something the specification's own law answers exactly.
 */
function marks(snapshot: ShatterSnapshot, ticks: number): Mark[] {
  const out: Mark[] = [];
  for (const rock of snapshot.rocks) {
    out.push({
      path: ballisticPath(rock, ticks),
      radius: ROCK_RADIUS[rock.size],
      // A Small is worth the most (specs/scoring.md) and is the only kill that
      // takes a rock off the field, so it clears a wave as well as paying best.
      worth: rock.size === "small" ? 3 : rock.size === "medium" ? 2 : 1,
    });
  }
  // THE SAUCER IS NOT AIMED AT. It is a bystander to the player's gun here, for
  // two reasons. A visit that plays out whole shows the hunt — the arrival, the
  // weave, the aimed shots the ship has to fly out of — which is the mechanic the
  // clip is for, where a saucer shot two seconds after it arrives shows none of
  // it. And it is a powered craft that weaves and steers around the core, so
  // there is no honest way to fly it forward far enough to plan a round onto it.
  return out;
}

/** What a planned round did: nothing, the core, or a body at a moment. */
interface Shot {
  /** Ticks from now until it lands. */
  tick: number;
  worth: number;
  /** How close the round passed to the star — a curved shot reads low here. */
  closest: number;
}

/**
 * Fly the round the ship would fire along `facing` and answer what it lands on.
 *
 * The round leaves the nose carrying the ship's own velocity (specs/weapons.md),
 * is pulled by the well, wraps, and dies at `BULLET_LIFE` or on the core. `stride`
 * is how many ticks separate two contact tests: a round covers under five units
 * a tick and the smallest rock is fourteen across, so testing every other tick
 * cannot step over one.
 */
function flyRound(
  ship: ShatterSnapshot["ship"],
  facing: number,
  marksAt: readonly Mark[],
  ticks: number,
  stride: number,
): Shot | null {
  const nose = unit(facing);
  let at: Body = {
    x: ship.x + nose.x * MUZZLE_OFFSET,
    y: ship.y + nose.y * MUZZLE_OFFSET,
    vx: ship.vx + nose.x * MUZZLE_SPEED,
    vy: ship.vy + nose.y * MUZZLE_SPEED,
  };
  let closest = Infinity;
  for (let i = 0; i < ticks; i += 1) {
    at = stepBallistic(at);
    const toStar = directDistance(at, STAR);
    closest = Math.min(closest, toStar);
    // Absorbed by the core: the round is spent and nothing is hit
    // (specs/collision.md).
    if (toStar <= CORE_ABSORB) return null;
    if (i % stride !== 0) continue;
    for (const mark of marksAt) {
      const where = mark.path[i];
      if (where === undefined) continue;
      if (wrappedDistance(at, where) <= mark.radius + BULLET_R) {
        return { tick: i + 1, worth: mark.worth, closest };
      }
    }
  }
  return null;
}

/** The distance at which the core takes a round (specs/collision.md). */
const CORE_ABSORB = CORE_R + BULLET_R;

/**
 * Where the round leaves the ship: ahead of its centre along the facing, no
 * further from it than `SHIP_R` (specs/weapons.md). The reference draws its nose
 * a little inside that bound, and the planner uses the same offset so a planned
 * round starts where the fired one does.
 */
const MUZZLE_OFFSET = SHIP_R * 0.55;

/** How a candidate facing is ranked: soonest impact, then what it lands on. */
function rate(shot: Shot, turn: number): number {
  return (
    -shot.tick * 0.5 +
    shot.worth * 12 -
    Math.abs(turn) * 40 +
    // A shot that passed close to the star is one the well visibly bent. Worth a
    // nudge, never a decision.
    (shot.closest < 260 ? 8 : 0)
  );
}

/* -------------------------------------------------------------------------- */
/* The scripted player                                                        */
/* -------------------------------------------------------------------------- */

/** Below this speed the ship burns onto a fresh heading; above, it coasts. */
const ROAM_MIN = 95;
const ROAM_TARGET = 245;
/** The headings a roam burst chooses between, in degrees. */
const ROAM_HEADINGS = [-90, -30, 25, 80, 135, 180, -140, -55];

const LEFT = keysFor("left")[0];
const RIGHT = keysFor("right")[0];
const THRUST = keysFor("up")[0];
const FIRE = keysFor("a")[0];

/** How far off a facing may be before a turn key is held, in radians. */
const AIM_DEADZONE = (SHIP_TURN * TICK_DT) / 2;

class Pilot {
  private held = new Set<string>();
  private aim: number | null = null;
  private frame = 0;
  private roaming = false;
  private burst = 0;

  constructor(
    private readonly h: Harness,
    private readonly phase: number,
  ) {}

  /** Every key the pilot is holding, released. */
  hands(): void {
    for (const code of this.held) this.h.release(code);
    this.held.clear();
  }

  private want(codes: readonly string[]): void {
    const wanted = new Set(codes);
    for (const code of this.held) {
      if (!wanted.has(code)) {
        this.h.release(code);
        this.held.delete(code);
      }
    }
    for (const code of wanted) {
      if (!this.held.has(code)) {
        this.h.hold(code);
        this.held.add(code);
      }
    }
  }

  /** Turn keys for a facing error, or none once it is inside the deadzone. */
  private turnKeys(error: number): string[] {
    if (error > AIM_DEADZONE) return [RIGHT];
    if (error < -AIM_DEADZONE) return [LEFT];
    return [];
  }

  /**
   * The rock (or saucer, or saucer bullet) about to reach the ship, if one is:
   * both bodies flown forward and their surfaces watched for contact.
   */
  private threat(
    snapshot: ShatterSnapshot,
  ): { where: Vec; tick: number } | null {
    const mine = shipPath(snapshot.ship, THREAT_TICKS);
    const incoming: Array<{ body: Body; radius: number; clearance: number }> =
      [];
    for (const rock of snapshot.rocks) {
      incoming.push({
        body: rock,
        radius: ROCK_RADIUS[rock.size],
        clearance: 26,
      });
    }
    for (const shot of snapshot.enemyBullets) {
      incoming.push({ body: shot, radius: SAUCER_BULLET_R, clearance: 18 });
    }
    if (snapshot.saucer !== null) {
      incoming.push({ body: snapshot.saucer, radius: SAUCER_R, clearance: 30 });
    }

    let soonestTick = THREAT_TICKS;
    let soonestWhere: Vec | null = null;
    for (const one of incoming) {
      const theirs = ballisticPath(one.body, soonestTick);
      const reach = one.radius + SHIP_R + one.clearance;
      for (let i = 0; i < soonestTick; i += 2) {
        if (wrappedDistance(mine[i], theirs[i]) <= reach) {
          soonestTick = i;
          soonestWhere = theirs[i];
          break;
        }
      }
    }
    return soonestWhere === null
      ? null
      : { where: soonestWhere, tick: soonestTick };
  }

  /** A heading for the next burst that does not fly straight into something. */
  private roamHeading(snapshot: ShatterSnapshot): number {
    let best = 0;
    let bestClear = -Infinity;
    for (let i = 0; i < ROAM_HEADINGS.length; i += 1) {
      const degrees =
        ROAM_HEADINGS[(i + this.burst + this.phase) % ROAM_HEADINGS.length];
      const heading = (degrees * Math.PI) / 180;
      const step = unit(heading);
      let clear = Infinity;
      for (let ahead = 60; ahead <= 320; ahead += 40) {
        const point = wrapPoint({
          x: snapshot.ship.x + step.x * ahead,
          y: snapshot.ship.y + step.y * ahead,
        });
        for (const rock of snapshot.rocks) {
          clear = Math.min(
            clear,
            wrappedDistance(point, rock) - ROCK_RADIUS[rock.size],
          );
        }
        clear = Math.min(clear, directDistance(point, STAR) - 40);
      }
      if (clear > 140) return heading;
      if (clear > bestClear) {
        bestClear = clear;
        best = heading;
      }
    }
    return best;
  }

  /** Decide this frame's keys. Call once, immediately before advancing a frame. */
  step(): void {
    const h = this.h;
    const snapshot = h.snapshot();
    this.frame += 1;
    if (snapshot.screen !== "playing") {
      this.want([]);
      return;
    }

    const ship = snapshot.ship;
    const speed = Math.hypot(ship.vx, ship.vy);

    // 1. Something is about to hit the ship: turn away from where it will be and
    //    burn. This outranks the aim.
    const danger = this.threat(snapshot);
    if (danger !== null) {
      const away = bearing(danger.where, ship);
      const error = angleDelta(ship.angle, away);
      const keys = this.turnKeys(error);
      if (Math.abs(error) < 0.9) keys.push(THRUST);
      this.want(keys);
      this.roaming = false;
      this.aim = null;
      return;
    }

    // 2. The speed band: a ship at rest turns onto a heading and burns until it
    //    is moving again. This is what keeps the ship drifting across the field.
    if (!this.roaming && speed < ROAM_MIN) {
      this.roaming = true;
      this.burst += 1;
      this.aim = this.roamHeading(snapshot);
    }
    if (this.roaming && speed >= ROAM_TARGET) {
      this.roaming = false;
      this.aim = null;
    }

    // 3. The aim. Re-planned every few frames from the live world, so the facing
    //    the ship is turning to tracks where the rocks have got to.
    const reach = marks(snapshot, SHOT_TICKS);
    if (!this.roaming && (this.aim === null || this.frame % 8 === 0)) {
      this.aim = this.plan(snapshot, reach) ?? this.aim;
    }

    const keys: string[] = [];
    if (this.aim !== null) {
      const error = angleDelta(ship.angle, this.aim);
      keys.push(...this.turnKeys(error));
      if (this.roaming && Math.abs(error) < 0.35) keys.push(THRUST);
    }

    // 4. The trigger. The round the ship would fire from where it stands, right
    //    now, is flown forward; it is fired only if it lands on something. When
    //    it does, the turn keys are dropped for the frame so the shot leaves
    //    along exactly the facing it was planned from.
    const gateOpen =
      ship.fireCooldown === 0 && snapshot.bullets.length < MAX_BULLETS;
    if (gateOpen && flyRound(ship, ship.angle, reach, SHOT_TICKS, 1) !== null) {
      this.want([FIRE]);
      return;
    }
    this.want(keys);
  }

  /** The facing whose round lands best, searched coarsely then refined. */
  private plan(
    snapshot: ShatterSnapshot,
    reach: readonly Mark[],
  ): number | null {
    if (reach.length === 0) return null;
    const ship = snapshot.ship;
    let best: { angle: number; rating: number } | null = null;
    const consider = (angle: number, stride: number): void => {
      const shot = flyRound(ship, angle, reach, SHOT_TICKS, stride);
      if (shot === null) return;
      const rating = rate(shot, angleDelta(ship.angle, angle));
      if (best === null || rating > best.rating) best = { angle, rating };
    };
    const coarse = (4 * Math.PI) / 180;
    for (let i = 0; i < 90; i += 1) consider(ship.angle + i * coarse, 2);
    if (best === null) return null;
    const around = (best as { angle: number }).angle;
    const fine = (0.6 * Math.PI) / 180;
    for (let i = -4; i <= 4; i += 1) consider(around + i * fine, 1);
    return (best as { angle: number }).angle;
  }
}

/* -------------------------------------------------------------------------- */
/* One take                                                                   */
/* -------------------------------------------------------------------------- */

/** What a take turned out to be, which is what an audition judges it on. */
interface Take {
  frames: number;
  score: number;
  wave: number;
  destroyed: number;
  livesLost: number;
  saucerSeen: boolean;
  saucerKilled: boolean;
  /** A saucer arrived less than `SAUCER_GAP_MIN` after the last one left. */
  backToBack: boolean;
  /** The longest stretch with no rock breaking, in seconds. */
  lull: number;
  endedOnBeat: boolean;
  gameOver: boolean;
}

const FRAMES_MIN = Math.round(MIN_SECONDS * TICK_HZ);
const FRAMES_MAX = Math.round(MAX_SECONDS * TICK_HZ);

async function runTake(
  h: Harness,
  seed: number,
  phase: number,
  record: boolean,
): Promise<Take> {
  const pilot = new Pilot(h, phase);
  // A previous take can end mid-press; a key still down would leak into this one
  // and break the same-seed reproducibility the audition rests on.
  pilot.hands();
  h.cues.length = 0;
  h.loops.length = 0;

  // The title, held for a beat, then `PLAY` taken with a real key edge. Recorded
  // from here, so the clip opens where a player opens the game.
  resetTo(h, seed);
  await h.advance(45);
  await tapAction(h, "confirm");

  let frames = 0;
  let destroyed = 0;
  let saucerSeen = false;
  let saucerKilled = false;
  let backToBack = false;
  let leftAt = -1;
  let livesLost = 0;
  const opening = h.snapshot();
  let lives = opening.lives;
  let score = opening.score;
  let live = new Set(opening.rocks.map((rock) => rock.id));
  let saucerId = opening.saucer?.id ?? null;
  let lastKill = 0;
  let lull = 0;
  let endedOnBeat = false;
  let gameOver = false;
  let bestMid = -Infinity;
  let bestSaucer = -Infinity;

  while (frames < FRAMES_MAX) {
    pilot.step();
    await h.advance(1);
    frames += 1;
    // The draw calls the harness records for the presentation checks are of no
    // use here, and half a minute of them runs to a great many megabytes.
    clearCalls(h);
    h.cues.length = 0;
    h.loops.length = 0;

    const snapshot = h.snapshot();

    // A ROCK DESTROYED, counted off the roster rather than off the `shatter`
    // cue: specs/audio.md plays that cue at most once on a tick, so a tick that
    // broke two rocks would be counted as one. A destroyed rock's id leaves the
    // roster; a rock the star recycled keeps its id and its place, so what is
    // counted here is destruction alone.
    const now = new Set(snapshot.rocks.map((rock) => rock.id));
    for (const id of live) {
      if (!now.has(id)) {
        destroyed += 1;
        lastKill = frames;
      }
    }
    live = now;
    lull = Math.max(lull, (frames - lastKill) / TICK_HZ);

    if (snapshot.lives < lives) livesLost += lives - snapshot.lives;
    lives = snapshot.lives;

    // THE SAUCER. A visit ends either way; the 200 points on the tick its id
    // left the field are what say it was shot down (specs/scoring.md).
    const nowSaucer = snapshot.saucer?.id ?? null;
    if (nowSaucer !== null) saucerSeen = true;
    if (saucerId !== null && nowSaucer !== saucerId) {
      const paid = snapshot.score - score;
      if (paid >= SCORE_SAUCER) saucerKilled = true;
      leftAt = frames;
      if (record) {
        console.log(
          `saucer ${saucerId} left at ${(frames / TICK_HZ).toFixed(1)}s, ` +
            `${paid} points on the tick`,
        );
      }
    }
    if (nowSaucer !== null && nowSaucer !== saucerId) {
      // ONE VISIT TREADING ON THE LAST. specs/saucer.md puts 25 to 35 seconds
      // between one saucer leaving and the next arriving, so an arrival inside
      // that gap is not a beat the showcase should be showing: a take with one
      // is passed over in favour of a take without.
      if (leftAt >= 0 && frames - leftAt < SAUCER_GAP_MIN * TICK_HZ) {
        backToBack = true;
      }
      if (record) {
        console.log(
          `saucer ${nowSaucer} arrived at ${(frames / TICK_HZ).toFixed(1)}s`,
        );
      }
    }
    saucerId = nowSaucer;
    score = snapshot.score;

    if (snapshot.screen === "gameover") {
      gameOver = true;
      break;
    }

    if (record) {
      // THE STILLS COME FROM THIS VERY TAKE, and each is the BEST frame the take
      // offered for what it is named for rather than the first acceptable one:
      // the file is simply rewritten whenever a better frame comes along, so what
      // is left on disk at the end is the take's high-water mark.
      const midScore =
        Math.min(snapshot.rocks.length, 12) * 2 +
        snapshot.bullets.length * 5 +
        (snapshot.rocks.some((rock) => rock.size !== "large") ? 5 : 0) +
        (snapshot.ship.y > 150 ? 3 : 0);
      if (frames > FRAMES_MIN * 0.3 && midScore > bestMid) {
        bestMid = midScore;
        captureStill(h, "mid-wave");
      }
      const saucer = snapshot.saucer;
      if (
        saucer !== null &&
        saucer.x > 180 &&
        saucer.x < FIELD_W - 180 &&
        saucer.y > 80 &&
        saucer.y < FIELD_H - 80
      ) {
        let clear = Infinity;
        for (const rock of snapshot.rocks) {
          clear = Math.min(
            clear,
            wrappedDistance(saucer, rock) - ROCK_RADIUS[rock.size] - SAUCER_R,
          );
        }
        const saucerScore =
          Math.min(clear, 160) +
          Math.min(snapshot.rocks.length, 12) * 4 +
          snapshot.bullets.length * 8 +
          snapshot.enemyBullets.length * 10;
        if (clear > 40 && saucerScore > bestSaucer) {
          bestSaucer = saucerScore;
          captureStill(h, "the-saucer");
        }
      }
      if (
        process.env.TCAB_SHOWCASE_QA_STILLS === "1" &&
        frames % (TICK_HZ * 3) === 0
      ) {
        captureStill(
          h,
          `qa-${String(frames / (TICK_HZ * 3)).padStart(2, "0")}`,
        );
      }
    }

    if (frames < FRAMES_MIN) continue;
    // End on a settled beat. The best one this game has is the WAVE N banner:
    // the field is clear, the ship is still flying, and the next wave is
    // announced over it.
    if (snapshot.waveBanner > 0 && snapshot.waveBanner <= 0.65) {
      endedOnBeat = true;
      break;
    }
    // Failing that, exactly a breath after a rock came apart — so the clip
    // closes on the fragments settling rather than wherever the clock ran out.
    if (frames - lastKill === Math.round(TICK_HZ * 0.8)) {
      endedOnBeat = true;
      break;
    }
  }

  pilot.hands();
  const snapshot = h.snapshot();
  return {
    frames,
    score: snapshot.score,
    wave: snapshot.wave,
    destroyed,
    livesLost,
    saucerSeen,
    saucerKilled,
    backToBack,
    lull,
    endedOnBeat,
    gameOver,
  };
}

/** What makes a watchable half-minute of Shatter. */
function judge(take: Take): number {
  return (
    take.destroyed * 2 +
    (take.wave - 1) * 30 +
    (take.saucerSeen ? 12 : 0) +
    (take.backToBack ? -80 : 0) -
    take.livesLost * 14 -
    take.lull * 6 +
    (take.endedOnBeat ? 15 : -15) +
    (take.gameOver ? -60 : 0)
  );
}

const describe = (take: Take): string =>
  `${(take.frames / TICK_HZ).toFixed(1)}s, wave ${take.wave}, ` +
  `${take.destroyed} rocks, ${take.score} points, ` +
  `${take.livesLost} lives lost, lull ${take.lull.toFixed(1)}s, ` +
  `saucer ${take.saucerSeen ? (take.saucerKilled ? "shot down" : "seen") : "none"}` +
  `${take.backToBack ? " (visits inside the gap)" : ""}, ` +
  `${take.gameOver ? "game over" : take.endedOnBeat ? "clean end" : "ran out"}`;

/* -------------------------------------------------------------------------- */

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("records a gameplay clip", async () => {
  const h = harness;

  let chosen: { seed: number; phase: number } | null = null;
  if (FORCED !== undefined && FORCED !== "") {
    const [seed, phase] = FORCED.split(":").map(Number);
    chosen = { seed, phase };
    console.log(`forced take seed=${seed} phase=${phase}`);
  } else {
    let best = -Infinity;
    for (const seed of SEEDS) {
      for (const phase of PHASES) {
        const take = await runTake(h, seed, phase, false);
        const rating = judge(take);
        console.log(
          `take seed=${seed} phase=${phase}: ${describe(take)} -> ${rating.toFixed(0)}`,
        );
        if (rating > best) {
          best = rating;
          chosen = { seed, phase };
        }
      }
    }
  }

  console.log(`recording take seed=${chosen!.seed} phase=${chosen!.phase}`);
  const final = await captureReplay(h, "gameplay", () =>
    runTake(h, chosen!.seed, chosen!.phase, true),
  );
  console.log(
    `recorded seed=${chosen!.seed} phase=${chosen!.phase}: ${describe(final)}`,
  );
}, 3_600_000);
