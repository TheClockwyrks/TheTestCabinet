// Orrery — the sigil phase of a boundary: the four waves, then the sets, then
// the rises (specs/simulation.md "The sigil phase").
//
// THE ORDER IS THE WHOLE OF THIS MODULE. What each sigil does is in
// `src/sigils.ts` and what a rise and a set do is in `src/apertures.ts`; here
// is when each of them gets its turn, and every rule of the ordering the
// specification states is written down once:
//
//   1. Four waves, each completing before the next: the transmuting sigils,
//      then the binding sigils, then `sunder`, then `void`.
//   2. Within a wave, sigils act ONE AT A TIME in reading order of their anchor
//      hex — ascending `r`, then ascending `q` — and each reads the field as
//      the sigils before it left it. Nothing is batched and nothing is resolved
//      against a snapshot: each effect is applied to the live run before the
//      next sigil looks at it.
//   3. After the four waves, every set is evaluated, then every rise, each in
//      the same reading order. A set consumes every constellation it accepts
//      BEFORE any rise spawns, so a footprint a set clears refills at the same
//      boundary.
//
// The waves are read off `SIGIL_WAVES`, so the four groups are stated once, in
// `src/constants.ts`, beside the footprints they act on.
//
// A sigil whose condition does not hold waits: no fault is raised here, and the
// status a boundary was reached in is the status it is left in. The area bank
// and the completion check that follow are in `src/sim.ts`.

import { SIGIL_WAVES } from "./constants";
import { runRises, runSets } from "./apertures";
import { readingOrder } from "./hex";
import { isTransformingSigil, sigilFootprint } from "./parts";
import { actSigil } from "./sigils";
import type { SimContext } from "./simcontext";
import type { PartKind, PartState } from "./types";

/**
 * The parts of these kinds, in reading order of their anchor hex: ascending
 * `r`, then ascending `q` (specs/simulation.md "The sigil phase"). The sort is
 * stable, so two parts anchored on one hex — which only a rise and a set can
 * be — keep their placement order.
 */
export function inReadingOrder(
  parts: readonly PartState[],
  kinds: readonly PartKind[],
): PartState[] {
  return parts
    .filter((part) => kinds.includes(part.kind))
    .sort((a, b) => readingOrder({ q: a.q, r: a.r }, { q: b.q, r: b.r }));
}

/**
 * One wave: every sigil of these kinds acts once, in reading order, each
 * reading the field as the one before it left it.
 */
export function runWave(ctx: SimContext, kinds: readonly PartKind[]): void {
  for (const part of inReadingOrder(ctx.parts, kinds)) {
    if (!isTransformingSigil(part.kind)) continue;
    const placed = sigilFootprint(
      part.kind,
      { q: part.q, r: part.r },
      part.rotation,
    );
    actSigil(ctx.sim, part.kind, placed);
  }
}

/**
 * The transforming, binding, sundering, and voiding waves in order, then every
 * set, then every rise, each in reading order (specs/simulation.md "The sigil
 * phase"). Run at every boundary, the settle included, before the area bank and
 * the completion check.
 */
export function runSigilsSetsAndRises(ctx: SimContext): void {
  for (const wave of SIGIL_WAVES) runWave(ctx, wave);
  runSets(ctx, inReadingOrder(ctx.parts, ["set"]));
  runRises(ctx, inReadingOrder(ctx.parts, ["rise"]));
}
