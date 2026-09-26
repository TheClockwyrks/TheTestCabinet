// abilities — waiting for one shot to land, and reading what it took off.
//
// Not a check: vitest never collects a file that is not a `.test.ts`, and nothing
// here decides a review point. Almost every ability in this directory is applied
// BY AN IMPACT — a chain leaps from one, a splash discharges at one, a slow and a
// burn are set on one — so almost every suite has the same two lines to write: run
// the real systems until the shot lands, then read what the impact did. They live
// here so that they are the same two lines everywhere and no suite quietly waits
// for something slightly different from its neighbour.
//
// WHY A WATCHED UNIT RATHER THAN A FRAME COUNT. The specification fixes no
// granularity for an update and no delay between acquiring a target and firing, so
// the frame a shot lands on is not something a check may assume. Watching the
// health of the unit the shot is aimed at is the reading that says the impact has
// happened, whatever schedule the build reached it on.

import { assertEqual } from "../assert";
import { unitById, type FoundrySnapshot, type Harness } from "../harness";

/** How long a shot is waited for, in seconds, unless a suite says otherwise. */
export const PATIENCE = 6;

/**
 * Drive until the shot aimed at `watched` lands, and hand back the state it left.
 *
 * The impact and everything it applies — the splash, the chain's leaps, the slow,
 * the burn — resolve on one update, so the state on the frame `watched` first
 * loses health is the state that shows the whole of what the shot did.
 */
export async function awaitImpact(
  h: Harness,
  watched: number,
  patience = PATIENCE,
): Promise<FoundrySnapshot> {
  const before = unitById(h.snapshot(), watched).hp;
  const landed = await h.until((s) => unitById(s, watched).hp < before, {
    maxFrames: h.ticks(patience),
    poll: 1,
  });
  assertEqual(
    landed.hit,
    true,
    `a shot to land on the unit it was aimed at within ${patience}s`,
  );
  return landed.snapshot;
}

/**
 * Drive until `watched` first carries a status effect, and hand back that state.
 *
 * A slow or a burn is applied on the update the shot arrives, so this is the same
 * moment {@link awaitImpact} finds — read from the effect rather than from the
 * health, for a suite whose subject is the effect.
 */
export async function awaitEffect(
  h: Harness,
  watched: number,
  carries: (unit: ReturnType<typeof unitById>) => boolean,
  patience = PATIENCE,
): Promise<FoundrySnapshot> {
  const landed = await h.until((s) => carries(unitById(s, watched)), {
    maxFrames: h.ticks(patience),
    poll: 1,
  });
  assertEqual(
    landed.hit,
    true,
    `the shot's effect to reach the unit it was aimed at within ${patience}s`,
  );
  return landed.snapshot;
}
