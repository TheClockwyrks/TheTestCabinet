// sonar/pulse — the opening every sonar point shares, and the one place they
// defer. CASE-PROVIDED.
//
// Seven review items ask what a pulse does, and each of them starts identically:
// the cooldown cleared so a pulse is legal at all, `Space` pressed, and one tick
// of the real simulation run so the game has cast it. Keeping that opening here
// is what makes the seven agree on it exactly — and on what they measure elapsed
// time FROM, which several of them turn on.
//
// specs/sensing.md: "A pulse is emitted when its cooldown is `0`". So the
// cooldown is posed to `0` through `setSonarCooldown`, which
// specs/instrumentation.md documents as leaving the pulse ready, rather than by
// waiting one out — a point about what a pulse does is not also a point about
// how long the recharge takes, and `sonar/cooldown` is where that is decided.
//
// IT IS ALSO WHERE THE SONAR POINTS STAND DOWN, and it tells the two ways a press
// can come to nothing APART. Whether pressing `Space` casts a pulse at all is
// `controls/sonar-key`'s verdict: specs/movement.md binds the `a` action to
// `Space` and has the `"playing"` screen read it. Whether the pulse that press
// casts then travels as a front, rather than arriving everywhere at once and
// vanishing inside the tick, is `sonar/wavefront`'s. A press that leaves nothing
// on `pulses` could be either — so the cooldown is what separates them: a build
// that read the key ARMS it (specs/sensing.md: "emitting one sets the cooldown to
// `SONAR_COOLDOWN`"), and one that read nothing does not. Each refusal names the
// point that owns what actually went wrong, and neither is a verdict.

import { BINDINGS, BRIGHT_HOLD } from "../constants";
import { FathomSnapshot, PulseSnapshot } from "../surface";
import { poseBrightness, visibilityOf, type Harness } from "../harness";
import { fail } from "../assert";

/**
 * The key specs/movement.md binds the `a` action — "Emits a sonar pulse" — to.
 *
 * The FIRST of that action's bindings, read off the seeded constants rather than
 * spelled here, so a check presses exactly the key the build was given.
 */
export const SONAR_KEY = BINDINGS.a[0];

/** The forager's own wavefront in flight, or `undefined` when none is. */
export function foragerPulse(
  snapshot: FathomSnapshot,
): PulseSnapshot | undefined {
  return snapshot.pulses.find((pulse) => pulse.source === "forager");
}

/** Every wavefront in flight that the forager cast. */
export function foragerPulses(snapshot: FathomSnapshot): PulseSnapshot[] {
  return snapshot.pulses.filter((pulse) => pulse.source === "forager");
}

/** Every wavefront in flight that a Gloamfin cast, not the forager. */
export function gloamfinPulses(snapshot: FathomSnapshot): PulseSnapshot[] {
  return snapshot.pulses.filter((pulse) => pulse.source === "gloamfin");
}

/** What one press left behind, and the moment every timing is measured from. */
export interface Emitted {
  /**
   * The state read immediately BEFORE the key went down.
   *
   * Elapsed time is measured from this snapshot's `simTime`, so it covers the one
   * tick the press itself runs. specs/sensing.md fixes what the front does from
   * the moment of the pulse and leaves the order of casting and stepping WITHIN
   * that tick to the build, so every check here allows one tick of slack and says
   * so where it states its bound.
   */
  before: FathomSnapshot;
  /** The state one tick later. */
  after: FathomSnapshot;
  /** The pulse the forager cast, or `null` if none is listed a tick later. */
  pulse: PulseSnapshot | null;
  /** Whether the press armed the cooldown, which is what says the key was read. */
  armed: boolean;
}

/** The same, for a caller that has established the pulse is there. */
export interface LiveEmitted extends Emitted {
  pulse: PulseSnapshot;
}

/**
 * Clear the cooldown, press `Space`, and run the single tick that delivers it.
 *
 * Nothing else is touched: whatever the scenario posed is where the pulse is cast
 * from, and the only thing this does is press a key. It decides nothing about
 * what came of the press — {@link requirePress} and {@link requireLivePulse} are
 * where a scenario says what it needs.
 */
export async function castPulse(h: Harness): Promise<Emitted> {
  h.debug.setSonarCooldown(0);
  const before = h.snapshot();
  await h.tap(SONAR_KEY);
  const after = h.snapshot();
  return {
    before,
    after,
    pulse: foragerPulse(after) ?? null,
    armed: after.sonar.cooldown > 0 || !after.sonar.ready,
  };
}

/**
 * The press did something: a pulse, or a cooldown armed.
 *
 * A press that did neither is a build that did not read the key, and every point
 * that reaches its subject through a pulse has nothing to read.
 */
export function requirePress(emitted: Emitted): void {
  if (emitted.pulse !== null || emitted.armed) return;
  fail(
    `pressing ${SONAR_KEY} to put a pulse in flight or arm the sonar cooldown, ` +
      "which is the pulse this scenario is read through",
    `neither happened, with sonar.ready reported as ` +
      String(emitted.before.sonar.ready),
  );
}

/**
 * The pulse the press cast, or a refusal naming the point that owns its absence.
 *
 * A press that armed the cooldown and left nothing on `pulses` DID emit — the
 * wavefront it emitted was gone within the tick, which is a fault in how the
 * front travels, and `sonar/wavefront` is where that is decided.
 */
export function requireLivePulse(emitted: Emitted): PulseSnapshot {
  requirePress(emitted);
  if (emitted.pulse === null) {
    fail(
      `a wavefront on pulses a tick after ${SONAR_KEY} was pressed, which is ` +
        "the front this scenario follows",
      "the press armed the sonar cooldown and left nothing in flight",
    );
  }
  return emitted.pulse;
}

/** {@link castPulse}, refusing to go on without a wavefront to follow. */
export async function emitPulse(h: Harness): Promise<LiveEmitted> {
  const emitted = await castPulse(h);
  return { ...emitted, pulse: requireLivePulse(emitted) };
}

/** Simulated seconds from the tick the pulse was cast on to `snapshot`. */
export function sinceEmit(emitted: Emitted, snapshot: FathomSnapshot): number {
  return snapshot.simTime - emitted.before.simTime;
}

/* -------------------------------------------------------------------------- */
/* The memory a reveal is read out of                                         */
/* -------------------------------------------------------------------------- */

/** How long the probe below holds each brightness for, in ticks. */
const PROBE_TICKS = 4;

/**
 * Stand a check down whose build does not keep a tile it has revealed.
 *
 * WHY A REVEAL CANNOT BE READ WITHOUT IT. specs/sensing.md states two rules and
 * only one of them is the pulse's: "Three things reveal a tile: the forager's
 * passive light, a sonar pulse's front as it arrives, and a flare's bloom", and
 * then, separately, "A revealed tile is lit while its source holds it and
 * remembered from then on". A front sweeps a tile once and moves on, so what a
 * check reads afterwards is the MEMORY of that sweep. A build that reveals every
 * tile the front reaches and forgets it on the next step answers `"u"` at every
 * reading a pulse check can take, and reads exactly like one whose pulse revealed
 * nothing.
 *
 * SO THE MEMORY IS PROBED WITH THE FORAGER'S OWN LIGHT, which is a different
 * source and settles the question on its own: the light is widened for a moment,
 * then taken back to the dark it opened in, and a tile the wide pocket reached
 * and the narrow one no longer does must report `"r"`. A build that answers
 * `"u"` there has lost a tile the light itself revealed, which is
 * this point's own reading rests on.
 *
 * TAKEN AFTER EVERY READING, so a scenario that ran cleanly is untouched by it:
 * the probe moves the brightness and nothing else, and every figure the check
 * asserts is already in hand by the time it runs.
 */
export async function requireFogMemory(h: Harness): Promise<void> {
  await poseBrightness(h, 1, BRIGHT_HOLD);
  await h.advance(PROBE_TICKS);
  const wide = h.snapshot();
  await poseBrightness(h, 0, BRIGHT_HOLD);
  await h.advance(PROBE_TICKS);
  const narrow = h.snapshot();

  for (let ty = 0; ty < narrow.grid.rows; ty += 1) {
    for (let tx = 0; tx < narrow.grid.cols; tx += 1) {
      const tile = { tx, ty };
      // A tile the wide pocket lit that the narrow one no longer holds: what
      // becomes of it is memory and nothing else.
      if (visibilityOf(wide, tile) !== "l") continue;
      const kept = visibilityOf(narrow, tile);
      if (kept === "l") continue;
      if (kept === "r") return;
      fail(
        `the tile at (${tx}, ${ty}) to be remembered once the forager's own ` +
          "light had been widened onto it and taken back — specs/sensing.md " +
          "remembers a revealed tile for the rest of the maze, and what a pulse " +
          "revealed is read off that memory",
        `it reported "${kept}"`,
      );
    }
  }
}
