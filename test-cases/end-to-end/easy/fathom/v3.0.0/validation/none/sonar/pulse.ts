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
// EVERY CROSSING INTO THE PAGE IS AWAITED, which is the whole of what separates
// this file from its counterparts under the two engines: the scenario, the
// thresholds and the readings are the same.
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

import { BINDINGS } from "../constants";
import {
  type FathomSnapshot,
  type Harness,
  type PulseSnapshot,
} from "../harness";
import { predatorIndex } from "../fixtures";

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
  await h.debug.setSonarCooldown(0);
  const before = await h.snapshot();
  await h.tap(SONAR_KEY);
  const after = await h.snapshot();
  return {
    before,
    after,
    pulse: foragerPulse(after) ?? null,
    armed: after.sonar.cooldown > 0 || !after.sonar.ready,
  };
}

/**
 * Stand the check down when the press did nothing whatever: no pulse, and no
 * cooldown armed.
 *
 * That is a build that did not read the key, which is `controls/sonar-key`'s
 * verdict to give.
 */
export function requirePress(h: Harness, emitted: Emitted): void {
  if (emitted.pulse !== null || emitted.armed) return;
  h.unmet(
    `pressing ${SONAR_KEY} with sonar.ready ` +
      `${String(emitted.before.sonar.ready)} put no pulse in flight and armed no ` +
      "cooldown, so nothing about a pulse can be read here; whether the key emits " +
      "one at all is controls/sonar-key's verdict, not this one's",
  );
}

/**
 * The pulse the press cast, or a refusal naming the point that owns its absence.
 *
 * A press that armed the cooldown and left nothing on `pulses` DID emit — the
 * wavefront it emitted was gone within the tick, which is a fault in how the
 * front travels, and `sonar/wavefront` is where that is decided.
 */
export function requireLivePulse(h: Harness, emitted: Emitted): PulseSnapshot {
  requirePress(h, emitted);
  if (emitted.pulse === null) {
    h.unmet(
      `pressing ${SONAR_KEY} armed the sonar cooldown but left no wavefront on ` +
        "pulses a tick later, so this scenario has no front to follow; a pulse " +
        "that does not travel is sonar/wavefront's verdict, not this one's",
    );
  }
  return emitted.pulse;
}

/** {@link castPulse}, refusing to go on without a wavefront to follow. */
export async function emitPulse(h: Harness): Promise<LiveEmitted> {
  const emitted = await castPulse(h);
  return { ...emitted, pulse: requireLivePulse(h, emitted) };
}

/**
 * The roster index of the one predator a scenario poses, or a refusal naming the
 * point that owns a roster too short to hold it.
 *
 * specs/predators.md gives depth `1` one of each kind, so at the depth every
 * posed scenario runs at "the Gloamfin" names exactly one predator.
 */
export function requireKind(
  h: Harness,
  snapshot: FathomSnapshot,
  kind: string,
): number {
  const index = predatorIndex(snapshot, kind);
  if (index === null) {
    h.unmet(
      `the roster carries no ${kind}, so this scenario has nothing to pose; ` +
        "specs/predators.md gives depth 1 one predator of each kind, and what " +
        "the roster holds is the progression checks' verdict, not this one's",
    );
  }
  return index;
}

/** Simulated seconds from the tick the pulse was cast on to `snapshot`. */
export function sinceEmit(emitted: Emitted, snapshot: FathomSnapshot): number {
  return snapshot.simTime - emitted.before.simTime;
}
