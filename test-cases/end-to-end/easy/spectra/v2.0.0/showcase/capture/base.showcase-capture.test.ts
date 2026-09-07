// showcase-capture — record REAL GAMEPLAY media for the base showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/base/`'s clip and its stills from the ENGINELESS
// reference implementation. It opens a run from the title the way a player
// does, then flies the resonator-fighter with scripted keyboard input, in
// Chromium, against the game's own rules — nothing is posed once play has
// begun — and records the whole stretch with the recorder the harness injects.
//
// WHY `references/none`. All three references play the same game, but only the
// engineless project runs in a real browser, where a sprite is a real
// `ImageBitmap` the recorder captures into the recording's image table. The two
// engine-backed projects render headless over `@napi-rs/canvas`, whose decoded
// images the recorder cannot carry, so their recordings name every `drawImage`
// source as an opaque handle and come back with an EMPTY image table: fine for
// a validator's evidence, which is read beside a baseline drawn exactly the
// same way, and wrong for a showcase, whose whole job is to show a visitor the
// field as a player sees it. Spectra draws its ship and all three drones from
// the seeded sprite art, so under an engine-backed capture the clip would be a
// starfield with the ship and the swarm missing. The clip is therefore taken
// here.
//
// The pilot has two layers. EXECUTION is bang-bang key input — hold
// ArrowLeft/ArrowRight along the lane, hold Space to fire, tap KeyF to flip,
// tap KeyX to discharge — through Chromium's own input pipeline, so the ship's
// speed, the fire cadence, the three-bullet cap and the flip lockout behave
// exactly as they do under a human. PLANNING reads the field the way a player
// reads it: which drone the band it is holding can actually destroy, where that
// drone will be when a bullet gets there, and which of the bullets coming down
// its lane its own band would absorb rather than die to. Where the pilot needs
// to be good it plans through the game's own stated rules — the effective-band
// rule of specs/bands.md, the bullet speeds of specs/ship.md and
// specs/swarm.md — so every kill it lands is one the game itself paid out.
//
// Run from the reference workspace root, with the two frame caps lifted (see
// showcase/capture/README.md):
//
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=2400 \
//     npx vitest run --config validation/vitest.config.ts \
//     validation/showcase-capture.test.ts

import { readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_HALF,
  FIELD_BOTTOM,
  PLAYER_BULLET_SPEED,
  RESONANCE_MAX,
  SHIP_HALF,
  SHIP_H,
  SHIP_SPEED,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SHIP_Y,
  type Band,
} from "./constants";
import {
  captureReplay,
  captureStill,
  ConstantClock,
  createHarness,
  startRunFromTitle,
  type BulletView,
  type DroneView,
  type Harness,
  type SpectraSnapshot,
} from "./harness";

/**
 * The clip's clock: every frame a sixtieth of a second, which is the frame a
 * display gives and therefore the rate the recording should be watched back at.
 * It is not the suite's 100 Hz default, because a replay is thinned to a frame
 * cap and a 60 Hz capture of half a minute lands under a lifted cap whole.
 */
const CLIP_HZ = 60;

/**
 * How many frames pass between two decisions.
 *
 * A pilot does not re-read the field every sixtieth of a second, and each read
 * here crosses into the page, so deciding every other frame is both the more
 * honest cadence and the one that keeps a take to a few minutes of wall clock.
 * The ship covers `SHIP_SPEED * PLAN_EVERY / CLIP_HZ` units between two
 * decisions, which is what {@link DEADZONE} is derived from.
 */
const PLAN_EVERY = 2;

/** How close to a wanted `x` counts as arrived: half a decision's travel. */
const DEADZONE = (SHIP_SPEED * PLAN_EVERY) / CLIP_HZ / 2;

/** The `y` a shot leaves from, so a flight time is measured from the nose. */
const NOSE_Y = SHIP_Y - SHIP_H / 2;

/**
 * How far off a lane a bullet may still be counted as coming down it.
 *
 * The ship's own contact half-extent plus the bullet's, plus a little, because
 * the ship is deciding a third of a second before the bullet arrives and both
 * of them are still moving.
 */
const LANE = SHIP_HALF + ENEMY_BULLET_HALF + 8;

/** How near a shot has to be lined up before the pilot holds the fire key. */
const AIM_TOLERANCE = 9;

/* -------------------------------------------------------------------------- */
/* Reading the field the way a player reads it                                */
/* -------------------------------------------------------------------------- */

/** The opposite band, which is the whole of what a flip does. */
const other = (band: Band): Band => (band === "cyan" ? "magenta" : "cyan");

/**
 * Whether a shot fired NOW, holding `band`, would destroy `drone`.
 *
 * `specs/bands.md` decides a shot by the two EFFECTIVE bands and nothing else,
 * and the snapshot reports a drone's effective band already composed — a broken
 * Prism reads as its core, an active inversion reads as the swap. A player
 * bullet is never swapped, so the ship's own band is the bullet's effective
 * band. The one case the bands cannot settle is a shimmering Flux, which
 * `specs/drones.md` puts beyond either band for the length of its shimmer.
 */
function killable(drone: DroneView, band: Band): boolean {
  return !drone.shimmer && drone.effectiveBand === band;
}

/** Seconds a shot fired now would take to climb to `drone`. */
function flightTime(drone: DroneView): number {
  return Math.max(0, (NOSE_Y - drone.y) / PLAYER_BULLET_SPEED);
}

/**
 * How much the pilot wants each drone dead, before the travel to line it up is
 * charged for.
 *
 * The weights are the game's own payoffs read as a player reads them, not the
 * scoring table: a diver is worth more than a slot-sitter because it is the one
 * about to kill you, a Prism is worth breaking because a Prism that reaches the
 * bottom inverts the whole field, and a drone low on the screen is worth more
 * than one at the top because the shot reaches it sooner and misses less.
 */
function valueOf(drone: DroneView): number {
  let value: number;
  switch (drone.kind) {
    case "prism":
      value = drone.shellAlive ? 46 : 72;
      break;
    case "flux":
      value = 34;
      break;
    default:
      value = 26;
      break;
  }
  if (drone.phase === "diving") value += 40;
  else if (drone.phase === "returning") value += 8;
  // A drone lower on the field is a shorter, surer shot.
  value += Math.max(0, (drone.y - 120) / 12);
  return value;
}

/** An enemy bullet on its way down, with the lane and the moment it arrives. */
interface Incoming {
  bullet: BulletView;
  /** Seconds until its centre reaches the ship's lane. */
  t: number;
}

/** Every enemy bullet that will cross the ship's lane, soonest first. */
function incoming(snapshot: SpectraSnapshot): Incoming[] {
  const found: Incoming[] = [];
  for (const bullet of snapshot.bullets) {
    if (bullet.friendly) continue;
    if (bullet.vy <= 0) continue;
    const t = (SHIP_Y - bullet.y) / bullet.vy;
    if (t < 0 || t > 1.6) continue;
    found.push({ bullet, t });
  }
  found.sort((a, b) => a.t - b.t);
  return found;
}

/** Whether `hit` would land on a ship standing at `x`. */
function inLane(hit: Incoming, x: number): boolean {
  return Math.abs(hit.bullet.x - x) <= LANE;
}

/**
 * The drone body about to reach the ship, if one is.
 *
 * A body costs a life whatever band it carries (`specs/bands.md`), so this is
 * the one threat the shield cannot answer and the pilot simply moves out from
 * under. The window is deliberately tight: a dive crosses `DIVE_FIRE_Y` most of
 * a second before it is anywhere near the lane, and a pilot that fled every
 * diver from there would spend the wave running away from the bullets it should
 * be absorbing. A challenge stage's flyover costs nothing, and is ignored.
 */
function bodyThreat(snapshot: SpectraSnapshot): DroneView | null {
  if (snapshot.isChallenge) return null;
  let nearest: DroneView | null = null;
  for (const drone of snapshot.drones) {
    if (drone.phase !== "diving" && drone.phase !== "returning") continue;
    if (drone.y < SHIP_Y - 150 || drone.y > FIELD_BOTTOM + 40) continue;
    if (Math.abs(drone.x - snapshot.ship.x) > 74) continue;
    if (nearest === null || drone.y > nearest.y) nearest = drone;
  }
  return nearest;
}

/* -------------------------------------------------------------------------- */
/* The pilot                                                                  */
/* -------------------------------------------------------------------------- */

/** What the pilot decided to do about the field this decision. */
type Intent = "hunt" | "absorb" | "shield" | "dodge";

/** An incoming bullet the pilot has settled on doing something about. */
interface Answer {
  hit: Incoming;
  /** The band the hull has to be holding when it arrives. */
  band: Band;
}

/**
 * The resonator-fighter, flown. Each decision reads the field, settles on a
 * band, picks the `x` to stand at and whether the cannon is worth holding open,
 * and dispatches real key edges into the page.
 */
class Pilot {
  private movement: "ArrowLeft" | "ArrowRight" | null = null;
  private firing = false;
  private aim: number | null = null;
  private held = 0;
  private sinceFlip = 0;
  private sinceReady = 0;

  /** Where each drone was at the last decision, for a lead on a moving target. */
  private lastSeen = new Map<number, { x: number; y: number }>();

  /** How long an aim is kept before the field is read for a better one. */
  private readonly commit: number;

  /**
   * How much better the other band's best target has to be before the pilot
   * spends a flip, and the beat of the cannon it costs, on tuning to it.
   */
  private readonly switchCost: number;

  /** What the last decision came to, for the take's own report. */
  intent: Intent = "hunt";

  /**
   * `phase` varies a take beyond what the game's own draws do: how patient the
   * aim is and how readily the pilot re-tunes to hunt the other band.
   */
  constructor(
    private readonly h: Harness,
    phase = 0,
  ) {
    this.commit = [0.2, 0.3, 0.42][phase % 3];
    this.switchCost = [18, 30, 10][phase % 3];
  }

  private async move(code: "ArrowLeft" | "ArrowRight" | null): Promise<void> {
    if (code === this.movement) return;
    if (this.movement !== null) await this.h.release(this.movement);
    if (code !== null) await this.h.hold(code);
    this.movement = code;
  }

  private async fire(wanted: boolean): Promise<void> {
    if (wanted === this.firing) return;
    if (wanted) await this.h.hold("Space");
    else await this.h.release("Space");
    this.firing = wanted;
  }

  /** Let every key up — between takes, so nothing leaks into the next one. */
  async releaseAll(): Promise<void> {
    await this.move(null);
    await this.fire(false);
    this.aim = null;
    this.held = 0;
    this.sinceFlip = 0;
    this.sinceReady = 0;
    this.lastSeen.clear();
  }

  /** Where a drone will be when a shot fired now gets to it. */
  private leadOf(drone: DroneView): number {
    const seen = this.lastSeen.get(drone.id);
    const step = PLAN_EVERY / CLIP_HZ;
    const vx = seen === undefined ? 0 : (drone.x - seen.x) / step;
    // A dive curves, so a full second of extrapolation is a fiction. Half of the
    // flight is the part of the lead worth trusting.
    return (
      drone.x + Math.max(-260, Math.min(260, vx)) * flightTime(drone) * 0.5
    );
  }

  private remember(snapshot: SpectraSnapshot): void {
    const fresh = new Map<number, { x: number; y: number }>();
    for (const drone of snapshot.drones) {
      fresh.set(drone.id, { x: drone.x, y: drone.y });
    }
    this.lastSeen = fresh;
  }

  /** The best drone this band could destroy, and what it is worth standing for. */
  private hunt(
    snapshot: SpectraSnapshot,
    band: Band,
  ): { x: number; rating: number } | null {
    let best: { x: number; rating: number } | null = null;
    for (const drone of snapshot.drones) {
      if (!killable(drone, band)) continue;
      const at = this.leadOf(drone);
      if (at < SHIP_X_MIN - 60 || at > SHIP_X_MAX + 60) continue;
      const travel = Math.abs(at - snapshot.ship.x) / SHIP_SPEED;
      const rating = valueOf(drone) - travel * 40;
      if (best === null || rating > best.rating) best = { x: at, rating };
    }
    return best;
  }

  /**
   * The bullet the pilot is going to meet, and the band it has to meet it on.
   *
   * `specs/bands.md` makes the ship's own band its shield: a bullet of that band
   * is absorbed and pays `RESONANCE_ABSORB` into the meter, and a bullet of the
   * other band costs a life. So a bullet coming down is not something to run
   * from — it is the meter being handed out, provided the hull is tuned to it
   * when it lands. This picks the soonest one the ship can actually reach in
   * time, at the speed `specs/ship.md` gives it.
   */
  private answer(snapshot: SpectraSnapshot, hits: Incoming[]): Answer | null {
    const ship = snapshot.ship;
    for (const hit of hits) {
      if (hit.t < 0.06) continue;
      const reach = SHIP_SPEED * Math.max(0, hit.t - 0.05);
      if (Math.abs(hit.bullet.x - ship.x) > reach) continue;
      return { hit, band: hit.bullet.effectiveBand };
    }
    return null;
  }

  /** One decision, taken against `snapshot` and dispatched as key edges. */
  async decide(snapshot: SpectraSnapshot): Promise<void> {
    this.sinceFlip += PLAN_EVERY / CLIP_HZ;
    if (snapshot.screen !== "inWave" || snapshot.phase !== "live") {
      await this.move(null);
      await this.fire(false);
      this.remember(snapshot);
      return;
    }

    const ship = snapshot.ship;
    const band = ship.band;
    const hits = incoming(snapshot);

    let wantX = ship.x;
    let wantBand = band;
    let intent: Intent = "hunt";

    /* -- The body ---------------------------------------------------------- */
    //
    // A drone's body costs a life whatever band it carries (`specs/bands.md`),
    // so it is the one threat the shield cannot answer and the pilot simply
    // moves out from under it. It outranks everything else.
    const body = bodyThreat(snapshot);

    /* -- The shield -------------------------------------------------------- */
    const answer = this.answer(snapshot, hits);

    if (body !== null) {
      wantX = ship.x + (body.x > ship.x ? -190 : 190);
      intent = "dodge";
      this.aim = null;
      // Still tune to whatever is about to land while stepping aside: a dodge
      // that runs into a bullet of the wrong band costs the life anyway.
      const landing = hits.find((hit) => inLane(hit, ship.x) && hit.t < 0.5);
      if (landing !== undefined) wantBand = landing.bullet.effectiveBand;
    } else if (answer !== null) {
      wantX = answer.hit.bullet.x;
      wantBand = answer.band;
      intent = answer.band === band ? "absorb" : "shield";
      this.aim = null;
      // Absorbing is worth a detour, but not one that gives up a shot already
      // lined up on a diver about to reach the ship.
      const urgent = this.hunt(snapshot, band);
      if (
        snapshot.resonance >= RESONANCE_MAX &&
        urgent !== null &&
        answer.band === band
      ) {
        wantX = urgent.x;
        intent = "hunt";
      }
    } else {
      /* -- The hunt -------------------------------------------------------- */
      //
      // Nothing is about to land, so the band is chosen for what it can kill.
      // A flip costs `FLIP_LOCKOUT` of the cannon (`specs/bands.md`), so it is
      // only spent when the other band's field is clearly the better one.
      const here = this.hunt(snapshot, band);
      const there = this.hunt(snapshot, other(band));
      const wants =
        there !== null &&
        (here === null || there.rating > here.rating + this.switchCost) &&
        this.sinceFlip > 0.45;
      const chosen = wants ? there : here;
      if (wants) wantBand = other(band);
      if (chosen !== null) {
        this.held -= PLAN_EVERY / CLIP_HZ;
        if (this.aim === null || this.held <= 0) this.held = this.commit;
        this.aim = chosen.x;
        wantX = chosen.x;
      }
    }

    /* -- The lane ---------------------------------------------------------- */
    wantX = Math.min(SHIP_X_MAX, Math.max(SHIP_X_MIN, wantX));
    const error = wantX - ship.x;
    if (error > DEADZONE) await this.move("ArrowRight");
    else if (error < -DEADZONE) await this.move("ArrowLeft");
    else await this.move(null);

    /* -- The cannon -------------------------------------------------------- */
    //
    // Judged where the ship ACTUALLY is rather than where it is headed, and
    // against the band it will be holding: a shot only pays when it matches, so
    // under this mode the pilot holds fire rather than spending a bullet on a
    // drone its band cannot touch (`specs/mode.md` — a mismatched shot here is
    // simply wasted).
    const lined = snapshot.drones.some(
      (drone) =>
        killable(drone, wantBand) &&
        Math.abs(this.leadOf(drone) - ship.x) < AIM_TOLERANCE,
    );
    await this.fire(lined && intent !== "dodge");

    // The flip is a press edge and it locks the cannon out for a beat, so it
    // goes last: the frame that carries it is the frame the shield changes on.
    if (wantBand !== band) {
      await this.h.tap("KeyF");
      this.sinceFlip = 0;
    }

    // The discharge is spent on the next busy moment. `specs/resonance.md` makes
    // it band-blind and spares the formation, so what it is worth is measured in
    // what is in the AIR: divers, the drones looping back, and enemy fire. A
    // meter that has stood full for a few seconds is spent on whatever there is,
    // because a meter at the ceiling takes nothing more in.
    if (snapshot.dischargeReady && !snapshot.discharge.active) {
      this.sinceReady += PLAN_EVERY / CLIP_HZ;
      const inAir =
        snapshot.drones.filter(
          (drone) => drone.phase === "diving" || drone.phase === "returning",
        ).length + snapshot.bullets.filter((bullet) => !bullet.friendly).length;
      if (inAir >= 3 || (this.sinceReady > 3.5 && inAir >= 1)) {
        await this.h.tap("KeyX");
        this.sinceReady = 0;
      }
    } else {
      this.sinceReady = 0;
    }

    this.intent = intent;
    this.remember(snapshot);
  }
}

/* -------------------------------------------------------------------------- */
/* Takes                                                                      */
/* -------------------------------------------------------------------------- */

/** What one take turned out to be, which is what a take is judged on. */
interface Take {
  frames: number;
  seconds: number;
  /** Drones destroyed, and the score the run finished on. */
  kills: number;
  score: number;
  /** Enemy bullets the hull absorbed, and flips the pilot spent. */
  absorbs: number;
  flips: number;
  /** Dives launched at the ship over the take. */
  dives: number;
  /** Prism shells broken, cores destroyed, and inversions the field suffered. */
  shells: number;
  cores: number;
  inversions: number;
  /** Discharges spent, and the most the widest one took off the field at once. */
  discharges: number;
  swept: number;
  /** The highest the resonance meter ever read over the take. */
  peakResonance: number;
  deaths: number;
  stagesCleared: number;
  /** The longest stretch, in seconds, in which nothing on the field happened. */
  maxLull: number;
  endedOnBeat: boolean;
}

/**
 * Keep the winning take's files under the committed names, and drop the rest.
 *
 * The harness writes each output under `$TCAB_VALIDATION_MEDIA_DIR`, in a
 * directory named for this test file, so the take files are found by name under
 * that root. Outside a run nothing was written and there is nothing to keep.
 */
function keepTake(winner: number): void {
  const root = process.env.TCAB_VALIDATION_MEDIA_DIR;
  if (root === undefined || root === "") return;
  for (const entry of readdirSync(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const match = /^take-(\d+)(-.+)?\.(json\.gz|png)$/.exec(entry.name);
    if (match === null) continue;
    const path = join(entry.parentPath, entry.name);
    if (Number(match[1]) !== winner) {
      rmSync(path);
      continue;
    }
    const kept = match[2] === undefined ? "gameplay" : match[2].slice(1);
    renameSync(path, join(entry.parentPath, `${kept}.${match[3]}`));
  }
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness({ clock: new ConstantClock(1000 / CLIP_HZ) });
});

afterEach(async () => {
  await harness?.dispose();
});

it("records a gameplay clip", async () => {
  const h = harness;

  /**
   * One take: reset, open a run from the title, and fly it.
   *
   * The game draws its own dives and lays out its own wave, so no two takes play
   * the same run and none can be played again: every take is recorded as it is
   * auditioned, and the winner's files are the ones kept.
   */
  const runTake = async (slot: number, phase: number): Promise<Take> => {
    const pilot = new Pilot(h, phase);
    await pilot.releaseAll();
    await startRunFromTitle(h);

    const minFrames = Math.round(
      Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "26") * CLIP_HZ,
    );
    const maxFrames = Math.round(
      Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "36") * CLIP_HZ,
    );

    let frames = 0;
    let kills = 0;
    let absorbs = 0;
    let flips = 0;
    let dives = 0;
    let shells = 0;
    let cores = 0;
    let inversions = 0;
    let discharges = 0;
    let swept = 0;
    let peakResonance = 0;
    let deaths = 0;
    let stagesCleared = 0;
    let lastAction = 0;
    let maxLull = 0;
    let endedOnBeat = false;
    /** The most slotted drones any frame the still has been written from held. */
    let stillAt = 0;

    // One crossing into the page per decision: the reading that closes a
    // decision is the reading the next one is taken against.
    let after = await h.snapshot();
    let lives = after.lives;
    let stage = after.stage;
    let score = after.score;
    let band = after.ship.band;
    let resonance = after.resonance;
    let inverted = after.inversionActive;
    let discharging = after.discharge.active;
    let airborne = new Set<number>();
    let intact = new Set<number>();
    let alive = new Set(after.drones.map((drone) => drone.id));

    const diving = (s: SpectraSnapshot): Set<number> =>
      new Set(
        s.drones
          .filter((drone) => drone.phase === "diving")
          .map((drone) => drone.id),
      );
    const shelled = (s: SpectraSnapshot): Set<number> =>
      new Set(
        s.drones
          .filter((drone) => drone.kind === "prism" && drone.shellAlive)
          .map((drone) => drone.id),
      );

    while (frames < maxFrames) {
      await pilot.decide(after);
      await h.advance(PLAN_EVERY);
      frames += PLAN_EVERY;
      const before = after;
      after = await h.snapshot();

      // A drone that was on the field and is not any more was destroyed, unless
      // the stage changed under it and took the whole roster with it.
      if (after.stage === before.stage && after.screen === "inWave") {
        const nowAlive = new Set(after.drones.map((drone) => drone.id));
        let gone = 0;
        for (const id of alive) if (!nowAlive.has(id)) gone += 1;
        if (gone > 0) {
          kills += gone;
          lastAction = frames;
          if (discharging) swept = Math.max(swept, gone);
        }
        alive = nowAlive;

        // A Prism whose shell stood and does not any more was broken open; one
        // that left the roster with its shell already gone lost its core.
        const nowShelled = shelled(after);
        for (const id of intact) {
          if (!nowShelled.has(id) && nowAlive.has(id)) {
            shells += 1;
            lastAction = frames;
          }
        }
        intact = nowShelled;
        for (const drone of before.drones) {
          if (
            drone.kind === "prism" &&
            !drone.shellAlive &&
            !nowAlive.has(drone.id)
          ) {
            cores += 1;
          }
        }
      } else {
        alive = new Set(after.drones.map((drone) => drone.id));
        intact = shelled(after);
      }

      // A dive is a drone entering phase `diving`, counted once.
      const nowDiving = diving(after);
      for (const id of nowDiving) if (!airborne.has(id)) dives += 1;
      if (nowDiving.size !== airborne.size) lastAction = frames;
      airborne = nowDiving;

      // The meter moves for exactly two reasons, and an absorb is the larger of
      // them; a drop to zero is the discharge being spent.
      const gained = after.resonance - resonance;
      if (gained >= 6) {
        absorbs += 1;
        lastAction = frames;
      }
      if (after.resonance === 0 && resonance > 0) discharges += 1;
      resonance = after.resonance;
      peakResonance = Math.max(peakResonance, resonance);

      if (after.ship.band !== band) {
        flips += 1;
        lastAction = frames;
      }
      band = after.ship.band;

      if (after.inversionActive && !inverted) {
        inversions += 1;
        lastAction = frames;
      }
      inverted = after.inversionActive;
      if (after.discharge.active && !discharging) lastAction = frames;
      discharging = after.discharge.active;

      if (after.score !== score) lastAction = frames;
      score = after.score;
      if (after.lives < lives) {
        deaths += 1;
        lastAction = frames;
      }
      lives = after.lives;
      if (after.stage > stage) {
        stagesCleared += 1;
        lastAction = frames;
      }
      stage = after.stage;

      // A lull is the FIELD standing still, so it is measured only while the
      // field is being played: the stage intro and the cleared interstitial are
      // beats of the game rather than stretches of nothing happening.
      if (after.screen !== "inWave" || after.phase !== "live") {
        lastAction = frames;
      }
      maxLull = Math.max(maxLull, (frames - lastAction) / CLIP_HZ);

      // The still: the field at its most telling — the block assembled and
      // swaying with both bands standing in it, and a drone peeling off it at
      // the ship. The FULLEST such frame of the take is the one kept, so the
      // still is written more than once and each better frame overwrites the
      // last: a block is at its most legible before the shooting has eaten it,
      // and which frame that is cannot be known until the take is over.
      const slotted = after.drones.filter(
        (drone) => drone.phase === "formation",
      );
      if (
        slotted.length > stillAt &&
        after.screen === "inWave" &&
        after.phase === "live" &&
        slotted.some((drone) => drone.effectiveBand === "cyan") &&
        slotted.some((drone) => drone.effectiveBand === "magenta") &&
        after.drones.some((drone) => drone.phase === "diving")
      ) {
        await captureStill(h, `take-${String(slot)}-mid-wave`);
        stillAt = slotted.length;
      }
      if (
        process.env.TCAB_SHOWCASE_QA_STILLS === "1" &&
        frames % (CLIP_HZ * 3) < PLAN_EVERY
      ) {
        const at = Math.round(frames / (CLIP_HZ * 3));
        await captureStill(
          h,
          `take-${String(slot)}-qa-${String(at).padStart(2, "0")}`,
        );
      }

      // End on a settled beat: the field standing again after the shooting,
      // never mid-flight. A stage that clears past the minimum is the cleanest
      // of them and ends the take on its interstitial.
      if (frames >= minFrames) {
        if (after.screen === "stageCleared") {
          endedOnBeat = true;
          break;
        }
        const settled =
          after.screen === "inWave" &&
          after.phase === "live" &&
          !after.discharge.active &&
          !after.bullets.some((bullet) => !bullet.friendly) &&
          !after.drones.some((drone) => drone.phase === "diving") &&
          frames - lastAction >= CLIP_HZ * 0.6;
        if (settled) {
          endedOnBeat = true;
          break;
        }
      }
    }
    await pilot.releaseAll();

    return {
      frames,
      seconds: frames / CLIP_HZ,
      kills,
      score: after.score,
      absorbs,
      flips,
      dives,
      shells,
      cores,
      inversions,
      discharges,
      swept,
      peakResonance,
      deaths,
      stagesCleared,
      maxLull,
      endedOnBeat,
    };
  };

  // A take is judged on what makes a watchable clip rather than on anything the
  // validators care about: the band system visibly being played — flips, absorbs
  // and matched kills — a Prism opened, a discharge landing on a busy field, no
  // long stretch where the field just sits, a clean ending, and the run
  // surviving.
  //
  // The payoff is a RATE rather than a total, restated over a thirty-second
  // clip. A total rewards a take for running long, which is exactly backwards
  // here: the replay's weight is set by the frames it keeps, so of two takes
  // carrying the same play the shorter one is the better clip — it holds the
  // same action at a higher frame rate for the same number of bytes.
  const judge = (t: Take): number =>
    ((t.kills * 3 +
      t.absorbs * 5 +
      Math.min(t.flips, 24) * 2 +
      t.dives * 3 +
      t.shells * 10 +
      t.cores * 14 +
      t.inversions * 6 +
      t.discharges * 26 +
      t.swept * 5 +
      t.stagesCleared * 20) *
      30) /
      Math.max(1, t.seconds) -
    t.deaths * 18 -
    t.maxLull * 8 +
    (t.endedOnBeat ? 14 : -14);

  // Every take is recorded as it is played, because no take can be played
  // again: the game draws its own dives and lays out its own wave, so a take
  // auditioned with the recorder off would be a different run from the one the
  // recorder then saw. Each take is written under its own name, the winner's
  // files are then kept under the committed names, and the rest are removed.
  const takesPerPhase = Number(process.env.TCAB_SHOWCASE_TAKES ?? "8");
  const phases = (process.env.TCAB_SHOWCASE_PHASES ?? "0,1,2")
    .split(",")
    .map(Number);
  let best: { slot: number; phase: number; rating: number; take: Take } | null =
    null;
  let slot = 0;
  for (const phase of phases) {
    for (let n = 0; n < takesPerPhase; n += 1) {
      slot += 1;
      const played = slot;
      const take = await captureReplay(h, `take-${String(played)}`, () =>
        runTake(played, phase),
      );
      const rating = judge(take);
      console.log(
        `take ${String(played)} phase=${String(phase)}: ${take.seconds.toFixed(1)}s, ` +
          `${take.kills} kill(s), ${take.absorbs} absorb(s), ` +
          `${take.flips} flip(s), ${take.dives} dive(s), ` +
          `${take.shells} shell(s)/${take.cores} core(s), ` +
          `${take.inversions} inversion(s), ` +
          `${take.discharges} discharge(s) taking up to ${take.swept}, ` +
          `meter peaked ${take.peakResonance}, ` +
          `${take.stagesCleared} stage(s), ${take.deaths} death(s), ` +
          `${take.score} pts, lull ${take.maxLull.toFixed(1)}s, ` +
          `${take.endedOnBeat ? "clean end" : "ran out"} ` +
          `-> ${rating.toFixed(0)}`,
      );
      if (best === null || rating > best.rating)
        best = { slot: played, phase, rating, take };
    }
  }
  if (best === null) throw new Error("no take was played");

  console.log(`keeping take ${String(best.slot)} phase=${String(best.phase)}`);
  keepTake(best.slot);
  // The title screen every take opened on, as its own still: the game reset to
  // its title, one frame drawn. It is taken AFTER the recorder has closed on the
  // last take, so no clip carries it.
  await h.debug.reset();
  await h.advance(1);
  await captureStill(h, "title");

  console.log(
    JSON.stringify(
      { take: best.slot, phase: best.phase, ...best.take },
      null,
      2,
    ),
  );
}, 3_600_000);
