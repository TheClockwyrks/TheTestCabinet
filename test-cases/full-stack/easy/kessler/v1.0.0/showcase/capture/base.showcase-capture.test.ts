// showcase-capture — record a REAL RUN of Kessler for the case showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/base/`'s gameplay replay and its stills from the
// `structured-2d` reference implementation. It opens on the title, confirms
// START with a key, and then plays the orbital demolition run the way a
// player plays it — riding the deflector round the track on held `left` and
// `right`, serving with `launch`, steering each bounce into the rings, and
// chasing the salvage pods the wreckage sheds.
//
// THE TAKE, BEAT BY BEAT.
//
//   1. The title stands for a beat and START is confirmed with `Enter`. The
//      run opens on wave 1: three full rings, the deflector at angle 90, a
//      ball parked on it.
//   2. The deflector rides round to a column of derelicts standing one behind
//      the other, holds, and `Space` serves the ball straight out through all
//      three rings. The first breaks land inside the first second.
//   3. From there it is a rally. Every tick the driver plays the ball forward
//      through the build's OWN rules to find where it will next fall through
//      the deflector's contact radius, and rides the track to meet it — early
//      enough to be waiting, offset to one side so the english on the bounce
//      throws the return where the derelicts still stand.
//   4. Breaks shed salvage pods, which fall radially at a constant speed, so
//      each is an appointment: an angle, and the tick it reaches the catch
//      radius. The driver takes a pod whenever the detour still leaves the
//      track it needs to be back under the ball — and leaves the `narrow`
//      pods alone, as a player would. A caught `multiball` puts several balls
//      in the sky at once; a caught `widen` stretches the deflector's span,
//      and a caught `shield` puts a ring round the planet that buys one miss
//      back.
//   5. The clip runs on past its minimum length and ends on the settled beat
//      after a break, a catch, or a cleared wave — never mid-flight.
//
// EVERY OUTCOME ON SCREEN IS THE GAME'S. Two debug operations are called and
// no others: `reset(seed)`, BEFORE the take begins, which lays the pod
// generator with the seed that makes a take auditionable at all, and
// `snapshot()`, a reading that changes nothing. No ball is placed, no target
// removed, no pod dropped, no screen set, no score written. The deflector
// turns because `ArrowLeft` or `ArrowRight` is held down, the ball leaves
// because `Space` was struck, every bounce is the specified four-step
// pipeline resolving on the game's own state, every derelict that breaks was
// hit, and every pod is one the seeded draw shed. Arranging the input is
// authoring; posing the outcome would be fabrication.
//
// PLANNING THROUGH THE GAME'S OWN RULES. The driver never relaxes the game to
// play it well. Its planner imports the build's exported motion and reflection
// — `paddleBounce`, `surfaceReflect`, the ring geometry, the wave figures —
// and replays candidate futures through them: where a ball in flight will
// meet the deflector, and, for each of the offsets the deflector could meet it
// at, what the return would break on its way back out. It picks the offset
// worth the most and then EXECUTES that plan through the keyboard alone, so
// the deflector moves at the rate the specification gives it and arrives, or
// does not, on the game's terms.
//
// AUDITIONING. A seed fixes the whole run, so a take could be played silently,
// judged, and replayed identically under the recorder. Every take is recorded
// as it is played anyway: the take that was judged is then provably the take
// that was committed, and replaying the winner is the expensive half of doing
// it the other way. Each take also gets a fresh engine, so nothing of the last
// one's frame counter, armed key edges, or canvas carries into it. The judge
// scores what makes a watchable clip of THIS game — derelicts broken, pods
// shed and caught, the variety of effects seen, balls in the sky at once,
// score, waves cleared — against what makes a dull or ugly one: lives thrown
// away, a long stretch with nothing happening, an ending mid-flight.
//
// Run from the staged reference workspace root:
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1000 \
//     TCAB_SHOWCASE_TAKES=20 \
//     npx vitest run --config validation/vitest.config.ts \
//     validation/base.showcase-capture.test.ts

import { it } from "vitest";

import {
  BINDINGS,
  BURNUP_RADIUS,
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_POD_CATCH_RADIUS,
  DEFLECTOR_TURN_DEG_PER_SEC,
  FIELD_CONTACT_RADIUS,
  POD_FALL_SPEED,
  RINGS,
  START_LIVES,
  TICK_DT,
  TICK_HZ,
} from "../src/constants";
import { ballSpeedForWave } from "../src/figures";
import {
  angularOffsetDeg,
  dot,
  normalizeDeg,
  polarOf,
  radialAt,
  tangentialOf,
  type Vec,
} from "../src/polar";
import { paddleBounce, surfaceReflect } from "../src/reflect";
import { liveTargetAtRel, withinArcRel, type RingState } from "../src/rings";

import {
  captureReplay,
  captureStill,
  openHarness,
  type Harness,
  type KesslerSnapshot,
} from "./harness";

/* -------------------------------------------------------------------------- */
/* The clip's shape                                                           */
/* -------------------------------------------------------------------------- */

/** Frames covering `s` seconds. One frame is one tick (`specs/overview.md`). */
const seconds = (s: number): number => Math.round(s * TICK_HZ);

/** Bounds on the recorded take, in frames. */
const MIN_FRAMES = seconds(
  Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "23"),
);
const MAX_FRAMES = seconds(
  Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "29"),
);

/** How long the title stands before START is confirmed. */
const TITLE_HOLD = seconds(1.3);

/** How long the fresh field is watched before the serve is set up. */
const SERVE_PAUSE = seconds(0.55);

/** How long the run is watched on after the beat the clip ends on. */
const SETTLE = seconds(1.1);

/** Degrees the deflector covers in one tick while a rotation key is held. */
const DEG_PER_TICK = DEFLECTOR_TURN_DEG_PER_SEC * TICK_DT;

/** How near the wanted angle the deflector is left alone, in degrees. */
const DEADBAND_DEG = DEG_PER_TICK / 2;

/** How far ahead a ball is played to find where it meets the deflector. */
const CHASE_HORIZON = seconds(4);

/** How far a candidate return is played out to see what it would break. */
const AIM_HORIZON = seconds(2.8);

/** How often the bounce plan is recomputed while the ball is still far off. */
const AIM_REFRESH = 4;

/** Inside this many ticks of the contact the plan is left to settle. */
const AIM_LOCK = 10;

/** Degrees between the candidate contact offsets the planner tries. */
const AIM_STEP_DEG = 3;

/** Slots across the three rings: what a full wave holds, for the still ranks. */
const FULL_WAVE_TARGETS = RINGS.reduce((sum, spec) => sum + spec.slots, 0);

/** The keys, exactly as `specs/controls.md` binds the actions. */
const LEFT_KEY = BINDINGS.left[0];
const RIGHT_KEY = BINDINGS.right[0];
const CONFIRM_KEY = BINDINGS.confirm[1];
const LAUNCH_KEY = BINDINGS.launch[0];

/** The cues that count as something happening, for the lull measurement. */
const LIVELY = new Set([
  "paddle-bounce",
  "field-bounce",
  "target-hit",
  "target-break",
  "shield-reflect",
  "pod-catch",
  "pod-catch-narrow",
  "wave-clear",
]);

/** The cues a clip is allowed to end on: something just landed. */
const BEATS = new Set([
  "target-break",
  "pod-catch",
  "pod-catch-narrow",
  "wave-clear",
]);

/* -------------------------------------------------------------------------- */
/* Playing the game forward through its own rules                             */
/* -------------------------------------------------------------------------- */
//
// The planner's whole model of the future. It is the build's own motion and
// reflection — the ball travels in a straight line between contacts, the rings
// turn at their own speeds, a target contact resolves through `surfaceReflect`
// with the ring kick, the containment field reflects as a face — run over a
// COPY of the state read off `snapshot()`. Nothing here touches the game; it
// only decides which key to hold.

/** A ball being played forward: position, velocity, and whether it pierces. */
interface Flight {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Where and when a ball falls through the deflector's contact radius. */
interface Arrival {
  /** Ticks from now until the crossing. */
  ticks: number;
  /** The ball's center angle at the crossing, in `[0, 360)`. */
  angleDeg: number;
  /** The position and velocity it crosses with. */
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** What playing a ball forward found. */
interface Pass {
  /** The deflector contact it reached, or `null` if it reached none. */
  arrival: Arrival | null;
  /** Whether it burned up against the planet inside the horizon. */
  burned: boolean;
  /** Derelicts destroyed on the way, and the points the pass was worth. */
  destroyed: number;
  worth: number;
}

/** The rings of a snapshot, as the shape the build's own queries read. */
function ringsOf(snapshot: KesslerSnapshot): RingState[] {
  return snapshot.rings.map((ring, index) => {
    const targets: (number | null)[] = Array.from(
      { length: RINGS[index].slots },
      () => null,
    );
    for (const target of ring.targets) targets[target.slot] = target.hp;
    return {
      angleDeg: ring.angleDeg,
      speedDegPerSec: ring.speedDegPerSec,
      targets,
    };
  });
}

/** A private copy of the rings, so a candidate future breaks nothing real. */
function copyRings(rings: readonly RingState[]): RingState[] {
  return rings.map((ring) => ({ ...ring, targets: [...ring.targets] }));
}

/** The moving ring's surface velocity at the ball, or `null` where none is. */
function ringSurfaceVelocity(
  speedDegPerSec: number,
  angleDeg: number,
  r: number,
): Vec | null {
  if (speedDegPerSec === 0) return null;
  const omega = (speedDegPerSec * Math.PI) / 180;
  const t = tangentialOf(radialAt(angleDeg));
  return { x: omega * r * t.x, y: omega * r * t.y };
}

/** What a target contact inside a candidate future cost the ring. */
interface Contact {
  destroyed: boolean;
  worth: number;
}

/**
 * One tick's target contacts, mirroring `specs/rings.md`: a face crossing of
 * either contact radius toward the ring, else an edge crossing into a live
 * target's arc, decided relative to the ring so its own rotation counts.
 */
function contactAhead(
  ball: Flight,
  rings: RingState[],
  prev: { r: number; angleDeg: number },
  cur: { r: number; angleDeg: number },
  prevAngles: readonly number[],
  piercing: boolean,
): Contact | null {
  for (let index = 0; index < RINGS.length; index += 1) {
    const spec = RINGS[index];
    const ring = rings[index];
    const curRel = cur.angleDeg - ring.angleDeg;

    let slot: number | null = null;
    let kind: "face" | "edge" = "face";
    const crossedOuter =
      prev.r > spec.outerContactRadius && cur.r <= spec.outerContactRadius;
    const crossedInner =
      prev.r < spec.innerContactRadius && cur.r >= spec.innerContactRadius;
    if (crossedOuter || crossedInner) {
      slot = liveTargetAtRel(spec, ring, curRel);
      if (slot === null) continue;
    } else if (
      cur.r >= spec.innerContactRadius &&
      cur.r <= spec.outerContactRadius
    ) {
      const prevRel = prev.angleDeg - prevAngles[index];
      for (let at = 0; at < spec.slots; at += 1) {
        if (ring.targets[at] === null) continue;
        if (
          withinArcRel(spec, curRel, at) &&
          !withinArcRel(spec, prevRel, at)
        ) {
          slot = at;
          kind = "edge";
          break;
        }
      }
      if (slot === null) continue;
    } else {
      continue;
    }

    if (piercing) {
      ring.targets[slot] = null;
      return { destroyed: true, worth: spec.destroyScore };
    }
    const remaining = (ring.targets[slot] ?? 0) - 1;
    const destroyed = remaining <= 0;
    ring.targets[slot] = destroyed ? null : remaining;
    const n = radialAt(cur.angleDeg);
    const out = surfaceReflect(
      { x: ball.vx, y: ball.vy },
      kind,
      n,
      ringSurfaceVelocity(ring.speedDegPerSec, cur.angleDeg, cur.r),
    );
    ball.vx = out.x;
    ball.vy = out.y;
    return { destroyed, worth: destroyed ? spec.destroyScore : 50 };
  }
  return null;
}

/**
 * Play one ball forward over a copy of the rings until it falls through the
 * deflector's contact radius, burns up, or the horizon runs out.
 *
 * The tick order is the game's (`specs/field.md`): the rings turn, then the
 * ball advances and resolves its contacts — the burn-up, the deflector
 * crossing, the target contacts, and the containment field, in that order.
 * The deflector itself is absent from the model on purpose: what the planner
 * wants to know is exactly WHERE the ball will fall through, so that the
 * deflector can be there.
 */
function playForward(
  start: Flight,
  rings: readonly RingState[],
  horizon: number,
  pierceTicks: number,
): Pass {
  const ball: Flight = { ...start };
  const board = copyRings(rings);
  let pierce = pierceTicks;
  let destroyed = 0;
  let worth = 0;

  for (let tick = 1; tick <= horizon; tick += 1) {
    const prevAngles = board.map((ring) => ring.angleDeg);
    for (const ring of board) {
      ring.angleDeg = normalizeDeg(
        ring.angleDeg + ring.speedDegPerSec * TICK_DT,
      );
    }
    if (pierce > 0) pierce -= 1;

    const prev = polarOf(ball.x, ball.y);
    ball.x += ball.vx * TICK_DT;
    ball.y += ball.vy * TICK_DT;
    const cur = polarOf(ball.x, ball.y);

    if (cur.r <= BURNUP_RADIUS) {
      return { arrival: null, burned: true, destroyed, worth };
    }

    const n = radialAt(cur.angleDeg);
    const velocity = { x: ball.vx, y: ball.vy };
    if (
      prev.r > DEFLECTOR_BALL_CONTACT_RADIUS &&
      cur.r <= DEFLECTOR_BALL_CONTACT_RADIUS &&
      dot(velocity, n) < 0
    ) {
      return {
        arrival: {
          ticks: tick,
          angleDeg: cur.angleDeg,
          x: ball.x,
          y: ball.y,
          vx: ball.vx,
          vy: ball.vy,
        },
        burned: false,
        destroyed,
        worth,
      };
    }

    const contact = contactAhead(
      ball,
      board,
      prev,
      cur,
      prevAngles,
      pierce > 0,
    );
    if (contact !== null) {
      if (contact.destroyed) destroyed += 1;
      worth += contact.worth;
      continue;
    }

    if (
      prev.r < FIELD_CONTACT_RADIUS &&
      cur.r >= FIELD_CONTACT_RADIUS &&
      dot(velocity, n) > 0
    ) {
      const out = surfaceReflect(velocity, "face", n, null);
      ball.vx = out.x;
      ball.vy = out.y;
    }
  }
  return { arrival: null, burned: false, destroyed, worth };
}

/* -------------------------------------------------------------------------- */
/* What the player decides                                                    */
/* -------------------------------------------------------------------------- */

/** The soonest deflector contact any ball in flight is heading for. */
function nextArrival(
  snapshot: KesslerSnapshot,
  rings: readonly RingState[],
): Arrival | null {
  let best: Arrival | null = null;
  for (const ball of snapshot.balls) {
    if (ball.parked) continue;
    const pass = playForward(
      { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy },
      rings,
      CHASE_HORIZON,
      snapshot.effects.pierceTicks,
    );
    if (pass.arrival === null) continue;
    if (best === null || pass.arrival.ticks < best.ticks) best = pass.arrival;
  }
  return best;
}

/** A falling pod's appointment: the angle it falls down, and when it lands. */
interface PodAppointment {
  ticks: number;
  angleDeg: number;
  kind: string;
}

/** Every pod still above the catch radius, soonest first. */
function podAppointments(snapshot: KesslerSnapshot): PodAppointment[] {
  const perTick = POD_FALL_SPEED * TICK_DT;
  const found: PodAppointment[] = [];
  for (const pod of snapshot.pods) {
    const { r, angleDeg } = polarOf(pod.x, pod.y);
    if (r <= DEFLECTOR_POD_CATCH_RADIUS) continue;
    found.push({
      ticks: Math.ceil((r - DEFLECTOR_POD_CATCH_RADIUS) / perTick),
      angleDeg,
      kind: pod.kind,
    });
  }
  return found.sort((a, b) => a.ticks - b.ticks);
}

/** Ticks of held rotation to bring the deflector's center round to `angle`. */
function travelTicks(fromDeg: number, toDeg: number): number {
  return Math.abs(angularOffsetDeg(toDeg, fromDeg)) / DEG_PER_TICK;
}

/**
 * The angle to serve down: the line through the most derelicts, discounted by
 * how far round the track the deflector has to ride to reach it.
 *
 * Ordinary play reasoning over what the player can see — which slots still
 * hold a derelict, and where the deflector is standing — read off `snapshot()`
 * through the build's own arc geometry.
 */
function serveAngle(
  snapshot: KesslerSnapshot,
  rings: readonly RingState[],
): number {
  let best = snapshot.paddle.angleDeg;
  let bestWorth = -Infinity;
  for (let angle = 0; angle < 360; angle += 2) {
    let worth = 0;
    for (let index = 0; index < RINGS.length; index += 1) {
      const spec = RINGS[index];
      const ring = rings[index];
      if (liveTargetAtRel(spec, ring, angle - ring.angleDeg) !== null) {
        worth += spec.destroyScore / 100;
      }
    }
    if (worth === 0) continue;
    worth -= travelTicks(snapshot.paddle.angleDeg, angle) * 0.02;
    if (worth > bestWorth) {
      bestWorth = worth;
      best = angle;
    }
  }
  return best;
}

/** A bounce the deflector could make, and what the return would be worth. */
interface Plan {
  /** Where the deflector's center has to stand for it. */
  centerDeg: number;
  /** Where the ball will cross, so the plan can be seen to have gone stale. */
  arrivalAngleDeg: number;
  /** The tick the plan was made on. */
  madeAt: number;
}

/**
 * Choose the contact offset to take the bounce at.
 *
 * The bounce's english turns the ball by `1.2` degrees per degree of offset
 * (`specs/deflector-and-ball.md`), so WHERE on the deflector the ball lands
 * decides where the return goes — the case's own headline mechanic. Each
 * reachable offset is put through the build's `paddleBounce` and the return
 * is played forward through the same rules, and the offset whose return breaks
 * the most is taken. An offset the deflector cannot ride to in time is not a
 * choice at all, so those are dropped first; if none survives, the deflector
 * rides as far toward the crossing as the track allows and takes what it gets.
 */
function planBounce(
  snapshot: KesslerSnapshot,
  arrival: Arrival,
  rings: readonly RingState[],
): number {
  const halfSpan = snapshot.paddle.spanDeg / 2;
  const reach = Math.max(0, (arrival.ticks - 2) * DEG_PER_TICK);
  const here = snapshot.paddle.angleDeg;
  const speed = ballSpeedForWave(snapshot.wave);
  const n = radialAt(arrival.angleDeg);
  const incoming = { x: arrival.vx, y: arrival.vy };

  let bestCenter: number | null = null;
  let bestWorth = -Infinity;
  const edge = Math.max(1, halfSpan - 3);
  for (let offset = -edge; offset <= edge + 1e-9; offset += AIM_STEP_DEG) {
    const center = normalizeDeg(arrival.angleDeg - offset);
    if (travelTicks(here, center) * DEG_PER_TICK > reach) continue;
    const out = paddleBounce(incoming, n, offset, speed);
    const pass = playForward(
      { x: arrival.x, y: arrival.y, vx: out.x, vy: out.y },
      rings,
      AIM_HORIZON,
      snapshot.effects.pierceTicks,
    );
    // What the return is worth: the derelicts it breaks, the points it takes,
    // and a preference for one that comes back to the deflector rather than
    // one left wandering the field for the rest of the horizon.
    const worth =
      pass.destroyed * 60 +
      pass.worth * 0.4 +
      (pass.arrival === null ? -20 : 20) +
      (pass.burned ? -400 : 0);
    if (worth > bestWorth) {
      bestWorth = worth;
      bestCenter = center;
    }
  }

  if (bestCenter !== null) return bestCenter;
  // Nothing reachable: ride as far toward the crossing as the track allows.
  const wanted = angularOffsetDeg(arrival.angleDeg, here);
  return normalizeDeg(
    here + Math.sign(wanted) * Math.min(reach, Math.abs(wanted)),
  );
}

/* -------------------------------------------------------------------------- */
/* The take                                                                   */
/* -------------------------------------------------------------------------- */

/** What a take left behind, and what the judge reads it by. */
interface Take {
  seed: number;
  frames: number;
  served: number;
  bounces: number;
  hits: number;
  destroyed: number;
  podsShed: number;
  podsCaught: number;
  podsBurned: number;
  kinds: string[];
  mostBalls: number;
  ballsLost: number;
  wavesCleared: number;
  score: number;
  wave: number;
  lives: number;
  longestLullFrames: number;
  died: boolean;
  endedOnBeat: boolean;
}

/** One played take of a run, driven entirely through the keyboard. */
class Session {
  private spent = 0;
  private served = 0;
  private mostBalls = 0;
  private died = false;
  private endedOnBeat = false;
  /** The pod kinds this take actually CAUGHT, for the variety the judge wants. */
  private readonly caught = new Set<string>();
  /** Last frame's pods, so a pod that vanished can be read as caught or burned. */
  private lastPods: { kind: string; angleDeg: number; r: number }[] = [];
  /** The rotation key currently held down, exactly as a player holds one. */
  private holding: string | null = null;
  private plan: Plan | null = null;
  /** How good the best frame kept as each still was; see {@link offer}. */
  private worthOf = new Map<string, number>();

  constructor(
    private readonly h: Harness,
    /** What this take's stills are written under. */
    private readonly stills: string,
  ) {}

  /** Hold the rotation key that turns the deflector toward `wanted`. */
  private steer(snapshot: KesslerSnapshot, wanted: number | null): void {
    let key: string | null = null;
    if (wanted !== null) {
      const diff = angularOffsetDeg(wanted, snapshot.paddle.angleDeg);
      if (Math.abs(diff) > DEADBAND_DEG) key = diff > 0 ? RIGHT_KEY : LEFT_KEY;
    }
    if (key === this.holding) return;
    if (this.holding !== null) this.h.releaseKey(this.holding);
    if (key !== null) this.h.holdKey(key);
    this.holding = key;
  }

  /** Advance one frame of the take's own clock, counting it. */
  private async step(): Promise<void> {
    await this.h.advance(1);
    this.spent += 1;
  }

  /** Advance `n` frames. */
  private async run(n: number): Promise<void> {
    for (let at = 0; at < n; at += 1) await this.step();
  }

  /** Strike a key for one frame, as a press edge, and release it. */
  private async press(code: string): Promise<void> {
    this.h.holdKey(code);
    await this.step();
    this.h.releaseKey(code);
  }

  /** Keep this frame as still `name` if it beats the frame held under it. */
  private offer(name: string, worth: number): void {
    if (worth <= (this.worthOf.get(name) ?? -Infinity)) return;
    this.worthOf.set(name, worth);
    captureStill(this.h, `${this.stills}-${name}`);
  }

  /**
   * Rank the frame just drawn as each of the three stills.
   *
   * What is ranked is what a visitor reads off the picture rather than what
   * the game was doing at the time.
   *
   * - `field`: the whole board early on, while the three rings still stand
   *   nearly whole and the ball is far enough out that the planet, the track,
   *   the rings and the containment all read at once.
   * - `salvage`: a pod on the last of its fall, inside the deflector's span,
   *   with the catch about to land — the mechanic in one frame.
   * - `breakout`: the frame a derelict shattered on, ranked by the wreckage
   *   already around it and how many balls were in the sky.
   */
  private rankStills(
    snapshot: KesslerSnapshot,
    fresh: readonly string[],
  ): void {
    if (snapshot.screen !== "playing") return;
    const live = snapshot.balls.filter((ball) => !ball.parked);
    const targets = snapshot.rings.reduce(
      (sum, ring) => sum + ring.targets.length,
      0,
    );

    if (this.spent < seconds(9) && live.length > 0) {
      const out = Math.max(...live.map((ball) => polarOf(ball.x, ball.y).r));
      // Out among the rings, not still on the deflector: the picture is of the
      // whole board, and the earliest frame that has it is the fullest one.
      if (out > 260) this.offer("field", targets * 100 + out);
    }

    const halfSpan = snapshot.paddle.spanDeg / 2;
    for (const pod of snapshot.pods) {
      const { r, angleDeg } = polarOf(pod.x, pod.y);
      if (r > 320 || r < DEFLECTOR_POD_CATCH_RADIUS) continue;
      const off = Math.abs(
        angularOffsetDeg(angleDeg, snapshot.paddle.angleDeg),
      );
      if (off > halfSpan) continue;
      this.offer("salvage", 1000 - r - off * 2 + live.length * 20);
    }

    if (fresh.includes("target-break")) {
      this.offer(
        "breakout",
        live.length * 1000 +
          snapshot.pods.length * 200 +
          (FULL_WAVE_TARGETS - targets) * 10,
      );
    }
  }

  /** Play the run out, and report what it produced. */
  async play(seed: number): Promise<Take> {
    // Choosing the seed is choosing the run; nothing else here touches the
    // surface but `snapshot()`.
    this.h.reset(seed);
    await this.run(TITLE_HOLD);
    await this.press(CONFIRM_KEY);

    const cueAt = this.h.cues.length;
    let seenCues = this.h.cues.length;
    let endAt: number | null = null;
    let sinceServe = 0;

    while (this.spent < MAX_FRAMES) {
      const snapshot = this.h.snapshot();
      if (snapshot.screen === "gameover") {
        this.died = true;
        break;
      }
      if (endAt !== null && this.spent >= endAt) break;

      if (snapshot.screen === "playing") {
        const live = snapshot.balls.filter((ball) => !ball.parked);
        if (live.length > this.mostBalls) this.mostBalls = live.length;
        const rings = ringsOf(snapshot);
        const parked = snapshot.balls.find((ball) => ball.parked);

        if (parked !== undefined) {
          // The serve: ride round to the column of derelicts worth the most,
          // hold there for a beat, and strike `Space`.
          const wanted = serveAngle(snapshot, rings);
          this.steer(snapshot, wanted);
          sinceServe += 1;
          if (
            sinceServe >= SERVE_PAUSE &&
            Math.abs(angularOffsetDeg(wanted, snapshot.paddle.angleDeg)) <=
              DEADBAND_DEG
          ) {
            this.steer(snapshot, null);
            await this.press(LAUNCH_KEY);
            this.served += 1;
            sinceServe = 0;
            const after = this.h.snapshot();
            this.rankStills(after, this.freshCues(seenCues));
            this.notePods(after);
            seenCues = this.h.cues.length;
            continue;
          }
        } else {
          sinceServe = 0;
          this.steer(snapshot, this.wanted(snapshot, rings));
        }
      } else {
        // `waveclear` reads no input; the interstitial runs on its own timer.
        this.steer(snapshot, null);
        this.plan = null;
      }

      await this.step();
      const fresh = this.freshCues(seenCues);
      seenCues = this.h.cues.length;
      const after = this.h.snapshot();
      this.rankStills(after, fresh);
      this.notePods(after);
      if (endAt === null && this.spent >= MIN_FRAMES) {
        if (fresh.some((name) => BEATS.has(name))) {
          endAt = this.spent + SETTLE;
          this.endedOnBeat = true;
        }
      }
    }

    this.steer(this.h.snapshot(), null);
    return this.report(seed, cueAt);
  }

  /**
   * Read the pods that vanished this frame as catches or burn-ups.
   *
   * A pod falls radially at a constant speed with its angle held, so a pod is
   * the same pod frame to frame by its kind and its angle. One that is gone
   * from high up was caught on the deflector's `196`; one gone from low down
   * burned up on the planet.
   */
  private notePods(snapshot: KesslerSnapshot): void {
    const now = snapshot.pods.map((pod) => {
      const { r, angleDeg } = polarOf(pod.x, pod.y);
      return { kind: pod.kind, angleDeg, r };
    });
    for (const was of this.lastPods) {
      const alive = now.some(
        (pod) =>
          pod.kind === was.kind &&
          Math.abs(angularOffsetDeg(pod.angleDeg, was.angleDeg)) < 0.5,
      );
      if (!alive && was.r > 150) this.caught.add(was.kind);
    }
    this.lastPods = now;
  }

  /** The names of the cues raised since the cursor `seen`. */
  private freshCues(seen: number): string[] {
    return this.h.cues.slice(seen).map((cue) => cue.name);
  }

  /** Where the deflector wants to be standing this tick. */
  private wanted(
    snapshot: KesslerSnapshot,
    rings: readonly RingState[],
  ): number | null {
    const arrival = nextArrival(snapshot, rings);
    if (arrival === null) {
      // Nothing is falling toward the track inside the horizon: take a pod if
      // one is coming, and otherwise hold station.
      const pods = podAppointments(snapshot).filter(
        (pod) => pod.kind !== "narrow",
      );
      return pods.length > 0 ? pods[0].angleDeg : null;
    }

    // The plan is remade every few ticks while the ball is still far out, and
    // whenever the crossing it was made against has drifted; inside the last
    // few ticks it is left alone so the deflector settles rather than jitters.
    let plan = this.plan;
    const stale =
      plan === null ||
      this.h.frame() - plan.madeAt >= AIM_REFRESH ||
      (arrival.ticks > AIM_LOCK &&
        Math.abs(angularOffsetDeg(arrival.angleDeg, plan.arrivalAngleDeg)) > 2);
    if (plan === null || stale) {
      plan = {
        centerDeg: planBounce(snapshot, arrival, rings),
        arrivalAngleDeg: arrival.angleDeg,
        madeAt: this.h.frame(),
      };
      this.plan = plan;
    }
    const center = plan.centerDeg;

    // A pod worth taking is one whose catch lands before the bounce and still
    // leaves the track needed to be back under the ball. A `narrow` pod is
    // left alone: shrinking the deflector is not a prize.
    const here = snapshot.paddle.angleDeg;
    for (const pod of podAppointments(snapshot)) {
      if (pod.kind === "narrow") continue;
      if (pod.ticks >= arrival.ticks) break;
      if (travelTicks(here, pod.angleDeg) > pod.ticks - 1) continue;
      if (travelTicks(pod.angleDeg, center) > arrival.ticks - pod.ticks - 1) {
        continue;
      }
      return pod.angleDeg;
    }
    return center;
  }

  /** Everything the judge and the log read, taken off the cues and the state. */
  private report(seed: number, cueAt: number): Take {
    const cues = this.h.cues.slice(cueAt);
    const count = (name: string): number =>
      cues.filter((cue) => cue.name === name).length;

    // The longest stretch with nothing happening, measured across the PLAY:
    // from the first lively cue to the last, and on to the frame the take
    // stopped at. The wait before the serve is the take's opening beat rather
    // than a lull, so the measurement starts where the action does.
    let lull = 0;
    let last: number | null = null;
    for (const cue of cues) {
      if (!LIVELY.has(cue.name)) continue;
      if (last !== null) lull = Math.max(lull, cue.frame - last);
      last = cue.frame;
    }
    if (last !== null) lull = Math.max(lull, this.h.frame() - last);

    const ended = this.h.snapshot();
    const caught = count("pod-catch") + count("pod-catch-narrow");
    const burned = count("pod-burn");
    return {
      seed,
      frames: this.spent,
      served: this.served,
      bounces: count("paddle-bounce"),
      hits: count("target-hit") + count("target-break"),
      destroyed: count("target-break"),
      podsShed: caught + burned + ended.pods.length,
      podsCaught: caught,
      podsBurned: burned,
      kinds: [...this.caught].sort(),
      mostBalls: this.mostBalls,
      ballsLost: count("ball-lost"),
      wavesCleared: count("wave-clear"),
      score: ended.score,
      wave: ended.wave,
      lives: ended.lives,
      longestLullFrames: lull,
      died: this.died,
      endedOnBeat: this.endedOnBeat,
    };
  }
}

/**
 * A take is judged on what makes a watchable clip of THIS game.
 *
 * Kessler reads as rhythm: the ball goes out, something breaks, salvage falls,
 * the deflector is somewhere else and has to get back. So the judge asks for
 * derelicts broken and pods CAUGHT rather than merely shed, for the effects a
 * catch grants to be visible (a second and third ball in the sky is the
 * clearest of them), and for the run to keep moving — a long stretch with
 * nothing happening is the one thing a preview cannot afford. Against that it
 * sets what makes a clip look bad: a life thrown away, a run that died, and an
 * ending taken mid-flight rather than on a settled beat.
 */
function judge(take: Take): number {
  return (
    take.destroyed * 8 +
    take.hits * 2 +
    take.bounces * 3 +
    take.podsCaught * 25 +
    take.podsShed * 4 +
    take.kinds.length * 10 +
    Math.max(0, take.mostBalls - 1) * 18 +
    take.wavesCleared * 150 +
    take.score * 0.01 +
    (take.endedOnBeat ? 30 : -30) -
    // A ball burning up while others are still in the sky is ordinary play; a
    // LIFE going is the mistake a preview should not be showing off.
    take.ballsLost * 6 -
    (START_LIVES - take.lives) * 40 -
    (take.died ? 80 : 0) -
    (take.longestLullFrames / TICK_HZ) * 10
  );
}

it("records a run for the showcase", async () => {
  // EVERY TAKE IS RECORDED, AND THE BEST ONE IS KEPT, so the take that was
  // judged is the take that was committed. Each take gets its own engine: a
  // run replayed over a world that has already run inherits its frame
  // counter, the key edges the last take left armed, and whatever the last
  // render left on the canvas.
  const takes = Number(process.env.TCAB_SHOWCASE_TAKES ?? "8");
  const firstSeed = Number(process.env.TCAB_SHOWCASE_FIRST_SEED ?? "1");

  const runTake = async (label: string, seed: number): Promise<Take> => {
    const h = await openHarness();
    try {
      await h.advance(1);
      const session = new Session(h, label);
      return await captureReplay(h, label, () => session.play(seed));
    } finally {
      h.dispose();
    }
  };

  let best: { label: string; score: number } | null = null;
  for (let at = 0; at < takes; at += 1) {
    const seed = firstSeed + at;
    const label = `take-${String(seed).padStart(2, "0")}`;
    const played = await runTake(label, seed);
    const score = judge(played);
    console.log(
      `${label}: seed ${played.seed}, ${(played.frames / TICK_HZ).toFixed(1)}s, ` +
        `${played.served} served / ${played.ballsLost} lost, ` +
        `${played.bounces} bounces, ${played.destroyed} broken (${played.hits} hits), ` +
        `${played.podsShed} pods shed / ${played.podsCaught} caught / ` +
        `${played.podsBurned} burned [${played.kinds.join(" ") || "none"}], ` +
        `up to ${played.mostBalls} balls, ` +
        `${played.score} points, wave ${played.wave}, ` +
        `${played.wavesCleared} cleared, ${played.lives} lives, ` +
        `longest lull ${(played.longestLullFrames / TICK_HZ).toFixed(1)}s, ` +
        `${played.died ? "died" : played.endedOnBeat ? "clean end" : "ran out"}` +
        ` -> ${score.toFixed(0)}`,
    );
    if (best === null || score > best.score) best = { label, score };
  }

  console.log(
    `best take: ${best!.label} (${best!.score.toFixed(0)}) — commit ` +
      `${best!.label}.json.gz as the clip and ${best!.label}-field.png, ` +
      `${best!.label}-breakout.png and ${best!.label}-salvage.png as the stills`,
  );
}, 7_200_000);
