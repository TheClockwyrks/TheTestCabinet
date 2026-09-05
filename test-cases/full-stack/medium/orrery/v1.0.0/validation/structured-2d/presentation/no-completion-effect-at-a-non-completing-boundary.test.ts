// presentation/no-completion-effect-at-a-non-completing-boundary — the completion
// effect plays on the boundary the run completes, and on no other.
//
// THE RULE. `specs/assets.md` fires each of the three produced systems at one
// moment apiece, and the completion system's is: "Completion |
// `assets/particles/complete.json` | hex `(0, 0)`, on the boundary the run
// completes". `specs/simulation.md` says which boundary that is: "After the rises,
// if every set's tally has reached the challenge's `target`, the run completes".
//
// THE BOUNDARY POSED IS ONE THE RUN DOES NOT COMPLETE AT. A set consumes a
// constellation — "An accepted constellation is consumed whole, and the set's
// tally rises by `1` for a plain product" (`specs/sigils.md`) — and the tally
// reaches `1` against a `target` of `CONSTELLATION_TARGET` (`6`), so the boundary
// does everything a completing one does except complete. That is the boundary a
// build that fires its completion effect on any delivery gets wrong.
//
// THE CONFIGURATION RUNS: a rise on the west of the field and a set on the east,
// with one `sol` spawned onto the set's own footprint hex. Nothing moves — the
// machine holds no arm — so the only thing the cycle does is the boundary, and the
// tally and the run's status are read back before any verdict about the drawing,
// because a check whose verdict is "nothing happened" has to show that the thing
// that should have happened did.
//
// WHAT IS COMPARED IS THE SQUARE ABOUT HEX `(0, 0)`, WHICH IS WHERE THE SYSTEM
// WOULD PLAY, and not the whole frame — because the whole frame legitimately
// moves. This is a boundary a set consumed at, so the DELIVERY system is playing
// on that set's anchor hex, and "Each play of a system varies, and that variation
// is correct" (`specs/assets.md`). Two runs of one scenario therefore draw
// different pictures at the set, and a build is right to. Hex `(0, 0)` is a
// hundred and forty-four units from the set and nothing stands on it — the machine
// is at the field's west and east ends and the bare field is what is left between
// them — so the square about it carries only what a completion effect would put
// there.
//
// THE READING OVER THAT SQUARE. The square is drawn exactly as it was BEFORE the
// boundary, so any paint an effect put there is a difference, and there is none.
// Nothing else in the scenario reaches hex `(0, 0)`, so the square holds the same
// picture from the frame before the boundary to the last frame of the window.
//
// THE FRACTION IS NOT READ, AND NEED NOT BE. The comparison is between two frames
// of one run driven from one opener.
//
// THE VERDICT. Every frame of the window draws hex `(0, 0)` exactly as the frame
// before the boundary drew it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import { hexCenter } from "../field";
import { risePart, setPart, solution } from "../formats";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openRun,
  pixelsDiffering,
  spawnMote,
  tallyOf,
  type Harness,
  type PixelRect,
} from "../harness";

/** How many frames past the boundary are compared. */
const WINDOW = 10;

/** Half the side of the square about hex `(0, 0)` the effect would play on. */
const HALF = 48;

/** What one run of the scenario hands back: the squares its frames left. */
interface Watched {
  origin: PixelRect[];
  before: PixelRect;
  tally: number;
  target: number;
  status: string;
}

/**
 * Open the run, take the boundary that consumes one constellation, and keep what
 * the frames after it drew.
 *
 * `openRun` leaves the completion switch ON, which is the state the completion
 * check runs in — this point is about a boundary that does NOT satisfy it, so the
 * switch has to be the one a player's run carries.
 */
async function watch(h: Harness): Promise<Watched> {
  await openRun(h, {
    challenge: BARE,
    machine: solution([
      risePart(0, WEST.q, WEST.r),
      setPart(0, EAST.q, EAST.r),
    ]),
  });
  // One `sol` on the set's own footprint hex: the constellation it accepts.
  await spawnMote(h, EAST, "sol");

  const centre = hexCenter(ORIGIN);
  await h.advance(1);
  const before = await h.pixelRect(
    centre.x - HALF,
    centre.y - HALF,
    2 * HALF,
    2 * HALF,
  );

  await captureReplay(h, "no-complete-effect", () => advanceCycles(h, 1));

  const snapshot = await h.snapshot();
  const origin: PixelRect[] = [];
  for (let frame = 0; frame < WINDOW; frame += 1) {
    await h.advance(1);
    origin.push(
      await h.pixelRect(centre.x - HALF, centre.y - HALF, 2 * HALF, 2 * HALF),
    );
  }
  return {
    origin,
    before,
    tally: tallyOf(snapshot, 0) ?? -1,
    target: snapshot.challenge?.target ?? -1,
    status: snapshot.sim?.status ?? "none",
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a boundary that consumed a constellation short of the target exactly as it drew the frame before it", async () => {
  const played = await watch(h);

  assertEqual(
    played.tally,
    1,
    "the set consumed its constellation at that boundary, so the boundary really did everything a completing one does but complete",
  );
  assertGreaterThan(
    played.target,
    played.tally,
    `the tally is short of the challenge's target of ${CONSTELLATION_TARGET}, so the completion check does not fire`,
  );
  assertEqual(
    played.status,
    "running",
    "the run is still running after the boundary, which is what makes it a non-completing one",
  );
  for (let frame = 0; frame < WINDOW; frame += 1) {
    assertEqual(
      pixelsDiffering(played.origin[frame] as PixelRect, played.before),
      0,
      `frame ${frame + 1} after the boundary draws hex (0, 0) exactly as the frame before the boundary did, and hex (0, 0) is where specs/assets.md fires the completion system`,
    );
  }
});
