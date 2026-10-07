// scoring — the two placements and the two drives the six checks in this group
// share. CASE-PROVIDED.
//
// This group decides one thing: what each event in `specs/scoring.md` PAYS. Every
// check in it therefore arranges the same shape — a run posed at a known score, one
// body standing on quiet ground, and the score read across the event that takes the
// body off the field — so that shape is built once, here.
//
// IT LIVES IN THE GROUP RATHER THAN IN `../harness.ts` because nothing outside
// `scoring` wants it: the harness owns what the whole project shares, and what is
// here is the score's own scaffolding. The one drive that looks general —
// {@link recycleTheRock} — is deliberately not promoted: `armor` carries its own
// sling for a `warhead`-only checklist, and a shared one would have to serve both
// readings at once.
//
// NOTHING BELOW IS A TOLERANCE. Every figure here is geometry or a recognition
// bound — where a body stands, how fast it is dropped, how far a body must move in
// one tick before it has plainly been RE-PLACED rather than have travelled. The
// score each check asserts is `specs/scoring.md`'s own whole number, asserted in
// the check, exactly.

import { ROCK_SPEED_MAX, STAR_X, type RockSize } from "../constants";
import { wrappedDistance, type Vec } from "../geometry";
import {
  fireAt,
  poseRock,
  smallestRock,
  ticksFor,
  bulletById,
  type Harness,
  type RockView,
  type ShatterSnapshot,
  type Target,
  type UntilResult,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Where a scored body stands                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Where a body that is about to be destroyed is posed: `(320, 620)`.
 *
 * `412` units from the star, where `specs/gravity.md`'s well pulls at about `26`
 * units per second squared — so over the fifth of a second a round spends crossing
 * its standoff, the well moves the target by well under a unit and the round is
 * aimed at where the body still is. It is clear of the star's whole drawn extent
 * (nothing of the star is drawn beyond `180`, `specs/field.md`), clear of the
 * ship's safe point at `(640, 560)`, and a Large's whole circle stands inside the
 * field, so nothing a still shows straddles a seam.
 *
 * None of that decides a verdict here — a score does not depend on where the body
 * was standing — but posing the event out of the well's way keeps the reading the
 * event's alone.
 */
export const QUIET_SPOT: Vec = { x: 320, y: 620 };

/**
 * The score a run is posed at before the event under test, `1234`.
 *
 * THE DISTINGUISHING VALUE OF THIS GROUP, and the reason it is not zero. Each check
 * reads what the event ADDED — the score after it, less the score before — and a
 * run opened at `0` cannot tell adding from assigning: a build that answers a
 * destroyed Medium with `score = SCORE_MEDIUM` reads exactly `50` there, the same
 * as one that adds it. Posed at `1234` the two part company, and each reads as its
 * own number: the conformant build reports `1284`, the assigning one `50`, and a
 * build paying the wrong figure reports `1234` plus that figure.
 *
 * `1234` is divisible by none of the four figures, so no wrong model lands on the
 * right answer by arithmetic accident, and it is far enough below
 * `EXTRA_LIFE_STEP` (`10 000`) that no run in this group crosses a multiple —
 * the extra ship is `lives`' business, and nothing here should reach it.
 *
 * `specs/instrumentation.md` makes `setScore` a precondition that grants no ship
 * whatever multiple it carries the score across, so posing it arranges the score
 * and nothing else.
 */
export const POSED_SCORE = 1234;

/* -------------------------------------------------------------------------- */
/* Watching the score                                                         */
/* -------------------------------------------------------------------------- */

/** Told the game's state on every tick a watched drive runs. */
export type Watch = (snapshot: ShatterSnapshot) => void;

/**
 * Advance until `predicate` holds, handing EVERY tick's snapshot to `watch` on the
 * way.
 *
 * The harness's own sweeps report where a drive stopped; two checks here need what
 * the score did at each tick BETWEEN the stops — `score-only-rises` because a dip
 * that a later event undid would otherwise be invisible, and
 * `recycling-scores-nothing` because a build that pays for the swallow and takes it
 * back on the re-entry would read as unchanged from the ends alone.
 */
export function sweepWatching(
  h: Harness,
  watch: Watch,
  predicate: (snapshot: ShatterSnapshot) => boolean,
  options: { maxTicks?: number } = {},
): Promise<UntilResult> {
  return h.until(
    (snapshot) => {
      watch(snapshot);
      return predicate(snapshot);
    },
    { maxTicks: options.maxTicks ?? ticksFor(1), poll: 1 },
  );
}

/**
 * Put one round on the body's doorstep, run it until it resolves, and hand every
 * tick of its flight to `watch`.
 *
 * {@link fireAt} is the harness's, so the round is placed exactly as every other
 * check in this project places one — on the side facing away from the star, at the
 * target's own velocity, aimed at its centre — and what it strikes is resolved by
 * the build's own collision pass.
 */
export async function shootWatching(
  h: Harness,
  target: Target,
  watch: Watch,
): Promise<UntilResult> {
  const bullet = await fireAt(h, target);
  return sweepWatching(
    h,
    watch,
    (snapshot) => bulletById(snapshot, bullet) === undefined,
    { maxTicks: ticksFor(1) },
  );
}

/**
 * Shoot the whole field down — every rock, and every fragment they leave — one
 * round at a time, watching each tick, and report the rounds it took.
 *
 * The harness's `shootFieldDown` drives the same rounds through the same
 * {@link fireAt}, and this is it with the flights watched. The smallest rock is
 * always the one shot at, because only destroying a Small takes a rock off the
 * field: working from the smallest is what empties the field rather than
 * multiplying it (`specs/rocks.md`).
 *
 * `maxRounds` bounds a build whose rounds do not land, so it fails with what the
 * scenario needed named rather than hanging the suite. A `base` build spends seven
 * rounds on one Large's whole ladder and a `warhead` build eleven, so the ceiling
 * leaves a wide margin.
 */
export async function shootLadderWatching(
  h: Harness,
  watch: Watch,
  maxRounds = 40,
): Promise<number> {
  let rounds = 0;
  for (;;) {
    const target = smallestRock(await h.snapshot());
    if (target === undefined) return rounds;
    if (rounds >= maxRounds) return rounds;
    await shootWatching(h, target, watch);
    rounds += 1;
  }
}

/* -------------------------------------------------------------------------- */
/* The star's recycling                                                       */
/* -------------------------------------------------------------------------- */

/** Where a rock is dropped from to fall onto the star: straight above its centre. */
export const FALL_FROM: Vec = { x: STAR_X, y: 120 };

/** The size dropped: a Large, whose circle reaches the core soonest and shows best. */
export const FALL_SIZE: RockSize = "large";

/**
 * The inward speed it is dropped at: the top of a Large's own drift range.
 *
 * `specs/rocks.md` draws a Large's base drift speed from `60` to `110`, so a rock
 * entering the field at `110` is a rock the game itself produces, and the well
 * only adds to it from there. The drop is radial and the fall takes about
 * four-fifths of a second.
 */
export const FALL_SPEED = ROCK_SPEED_MAX.large;

/**
 * How far a rock must move between two consecutive ticks before it has plainly
 * been RE-PLACED rather than have travelled there.
 *
 * NOT A TOLERANCE — a recognition bound, and margined by more than thirty times in
 * both directions. `specs/rocks.md` has the star take the rock and "immediately
 * re-place" it at a random point on one of the four edges: the nearest point of any
 * edge to the star's centre is `360` away, so even a build that insets a rock by its
 * own radius sets it down at least `238` units from the core it was swallowed at,
 * and the re-placement therefore shows up as a single-tick step of hundreds of
 * units. Travel cannot counterfeit that. A Large dropped by {@link FALL_SPEED} onto
 * the core is moving about `330` units per second when it arrives — under `3` units
 * in a tick of `specs/simulation.md`'s `120` Hz — so nothing that merely flew, or
 * bounced, ever steps this far.
 *
 * It is the recycle's signature rather than an edge test on purpose: WHERE a
 * recycled rock re-enters is the `rocks` group's item, and reading it here would
 * make this group's verdict turn on a rule it does not decide.
 */
const REPLACED_STEP = 100;

/** What a watched fall onto the star found. */
export interface RecycleRun {
  /** Whether the star took the rock and set it down again. */
  recycled: boolean;
  /** Where the game stood on the tick the sweep ended. */
  snapshot: ShatterSnapshot;
}

/**
 * Drop one rock straight onto the star and run until the star has re-placed it,
 * handing every tick to `watch`.
 *
 * The rock is posed directly above the star's centre, so the well's pull lies along
 * its fall and the approach is radial: it reaches the core — `ROCK_RADIUS.large +
 * CORE_R` from the centre, `specs/collision.md` — rather than swinging past it. The
 * whole fall is swept a tick at a time, so what `watch` sees is the score on every
 * tick of the approach, the swallow, and the re-entry.
 *
 * IT REACHES NO VERDICT. A build that never recycles is a build this group's caller
 * must fail for the reason IT decides, in the order it chooses, so what comes back
 * is whether the recycle was seen rather than an assertion that it was.
 *
 * The rock is followed as "the one rock on the field" rather than by its id:
 * `specs/rocks.md` makes a recycled rock the same rock relocated and leaves the
 * field's rock count unchanged, but it never says the id survives, so a check that
 * followed one would demand something the specification does not.
 */
export async function recycleTheRock(
  h: Harness,
  watch: Watch = () => undefined,
  maxTicks = ticksFor(2),
): Promise<RecycleRun> {
  let previous: RockView | undefined = (await h.snapshot()).rocks[0];
  const run = await sweepWatching(
    h,
    watch,
    (snapshot) => {
      const rock = snapshot.rocks.length === 1 ? snapshot.rocks[0] : undefined;
      const stepped =
        rock !== undefined &&
        previous !== undefined &&
        wrappedDistance(rock, previous) >= REPLACED_STEP;
      previous = rock;
      return stepped;
    },
    { maxTicks },
  );
  return { recycled: run.hit, snapshot: run.snapshot };
}

/** Pose the one rock this group drops onto the star, and hand back its id. */
export function poseFallingRock(h: Harness): Promise<number> {
  return poseRock(h, FALL_SIZE, FALL_FROM.x, FALL_FROM.y, 0, FALL_SPEED);
}
