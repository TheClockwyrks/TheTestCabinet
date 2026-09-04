// status-bar/overload-read — OVERLOAD, and the Maze Rating accruing beside it.
//
// `specs/hud.md`: "an `OVERLOAD` read shows during the finale, with the Maze
// Rating accruing live". `specs/campaign.md` fixes the Maze Rating as the total
// damage dealt to the Overload Dynamo, "direct hits and burn ticks alike", and
// `specs/enemies.md` has that unit take a burn like any other.
//
// THE ISOLATION. The finale is reached the direct way `specs/instrumentation.md`
// gives: releasing the Overload Dynamo puts the run into the finale, so no wave
// has to be played to get there. The yard holds nothing else — no structure, no
// other unit — and the damage comes from a burn posed on the Dynamo itself, which
// `specs/instrumentation.md` credits to no structure. So the rating the bar draws
// moved for exactly one reason, and it moved through the game's own burn rule
// rather than being posed. The Dynamo's travel is held so it cannot ground out
// and end the run while the bar is being read.
//
// THE FIGURES. A burn of 97 per second for two seconds of simulation is a rating
// no other read in the bar carries at either sample, so the figure the bar drew
// is unambiguous, and a whole point of room covers a build that rounds it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotEqual } from "../assert";
import {
  BAR,
  captureReplay,
  createHarness,
  drawnFigure,
  drew,
  type Harness,
  openYard,
  releaseUnit,
} from "../harness";
import { OVERLOAD_TEXT } from "../constants";

/** A burn whose per-second damage no other figure in the bar collides with. */
const BURN_DPS = 97;
const BURN_SECONDS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads OVERLOAD through the finale, with the rating growing", async () => {
  openYard(h);
  const dynamo = releaseUnit(h, "overload", { frozen: true });
  assertEqual(
    h.snapshot().phase,
    "finale",
    "the phase releasing the Overload Dynamo puts the run into " +
      "(specs/instrumentation.md)",
  );

  const seen = await captureReplay(h, "overload", async () => {
    h.debug.setUnitBurn(dynamo, BURN_DPS, BURN_SECONDS);
    await h.advanceSeconds(1);
    const early = await h.frameCalls();
    const earlyRating = h.snapshot().mazeRating;
    await h.advanceSeconds(1);
    const late = await h.frameCalls();
    const lateRating = h.snapshot().mazeRating;
    return { early, earlyRating, late, lateRating };
  });

  assertEqual(
    drew(seen.early, BAR, OVERLOAD_TEXT),
    true,
    "whether the bar reads OVERLOAD during the finale",
  );
  assertEqual(
    drew(seen.late, BAR, OVERLOAD_TEXT),
    true,
    "whether the bar still reads OVERLOAD later in the finale",
  );

  assertGreaterThan(
    seen.lateRating,
    seen.earlyRating,
    "the Maze Rating a second more of burn adds (specs/campaign.md)",
  );
  const early = drawnFigure(
    seen.early,
    BAR,
    seen.earlyRating,
    "the Maze Rating one second into the burn",
    1,
  );
  const late = drawnFigure(
    seen.late,
    BAR,
    seen.lateRating,
    "the Maze Rating two seconds into the burn",
    1,
  );
  assertNotEqual(
    late,
    early,
    "the Maze Rating the bar draws as the Overload Dynamo takes more damage",
  );
});
