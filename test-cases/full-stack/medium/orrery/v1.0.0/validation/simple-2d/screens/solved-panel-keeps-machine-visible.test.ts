// screens/solved-panel-keeps-machine-visible — the machine that finished the run
// is still on the field under the panel, standing where the completing boundary
// left it.
//
// THE RULE is the last sentence of `specs/ui.md`, The solved panel: "The finished
// machine stays visible behind the panel." The editor section says the same of
// both panels: "The two panels below are drawn over it while a run is in the
// matching status, and THE FIELD STAYS VISIBLE BEHIND THEM." So a completion
// neither clears the field nor puts the machine back to its rest state; what is
// drawn is what the boundary left.
//
// THE CONFIGURATION is a run that completes with a mote ON THE MOVE, because a
// machine that never moved cannot tell "left where the boundary left it" from
// "put back where it started". An `arm` on `(0, 3)`, rotation `0`, length `1`,
// holds one `sol` at its gripper hex `(1, 3)` and its tape turns it one step
// clockwise, so the cycle carries that mote to `(0, 4)` — the arm's gripper on
// spoke `1`, at `base + length * DIRS[1]` (`specs/parts.md`). Beside it, far
// enough away to reach nothing, the set for the challenge's one product, with the
// tally posed to the `target` so that this cycle's boundary is the one that
// completes the run.
//
// HOW THE FIELD IS READ. `specs/assets.md` fixes what the field draws and where:
// a mote sprite is `44 x 44` and "centered on every mote's position, at rest and
// while carried", and an arm hub is `40 x 40` and "centered on the part's anchor
// hex". So the reading is the frame's own drawing operations — every image whose
// centre lands on the hex asked about — rather than its pixels, which is the only
// reading that can say the field was DRAWN behind a panel that is drawn over it.
//
// THE VERDICT. On the frame that carries the panel, the mote's sprite is drawn on
// `(0, 4)`, where the boundary left it, and the arm's hub on `(0, 3)`. Nothing is
// drawn on `(1, 3)`, where the mote stood before the cycle ran, so a build that
// returned the run to its rest poses fails, and a build that cleared the field
// fails on all three readings at once.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
} from "../assert";
import { HUB_SPRITE_SIZE, MOTE_SPRITE_SIZE } from "../constants";
import { at, hexCenter } from "../field";
import { armPart, setPart, solution } from "../formats";
import { BARE, ORIGIN, TARGET } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  imagesNear,
  moteAt,
  openRun,
  partIds,
  spawnMote,
  takeGrip,
  type DrawCall,
  type Harness,
} from "../harness";

/** The arm's anchor, three rows south of the set and out of its reach. */
const ARM = at(0, 3);

/** Its gripper hex at rest: length `1` along spoke `0`, which is east. */
const HELD_AT = at(1, 3);

/** Where one clockwise step carries that gripper, and the mote it holds. */
const CARRIED_TO = at(0, 4);

/** One set at the origin, and one arm that turns one step clockwise per cycle. */
const MACHINE = solution([
  setPart(0, ORIGIN.q, ORIGIN.r),
  armPart("arm", ARM.q, ARM.r, 0, 1, ["rotate-cw"]),
]);

/**
 * How near a sprite's centre must land to count as drawn on a hex.
 *
 * `specs/assets.md`: every sprite is "drawn at that size in logical units,
 * centered on the thing it depicts, so nothing is scaled at draw time". A hex is
 * `HEX_PITCH` (`48`) from its neighbour, so this span cannot reach one.
 */
const ON_HEX = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every image of `size x size` the frame drew centred on `hex`. */
function spritesOn(
  calls: readonly DrawCall[],
  hex: { q: number; r: number },
  size: number,
): number {
  return imagesNear(calls, hexCenter(hex), ON_HEX).filter(
    (draw) => draw.image.width === size && draw.image.height === size,
  ).length;
}

it("draws the finished machine and its mote where the completing boundary left them", async () => {
  await openRun(h, { challenge: BARE, machine: MACHINE });
  const arm = (await partIds(h))[1] as number;
  const carried = await spawnMote(h, HELD_AT, "sol");
  await takeGrip(h, arm, 0, carried);
  await h.debug.setTally(0, TARGET);

  await advanceCycles(h, 1);
  await h.advance(1);

  const calls = await h.lastCalls();
  await captureStill(h, "behind");

  const shown = await h.snapshot();
  assertNotNull(shown.sim, "the run is still reported once it has completed");
  assertEqual(
    shown.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );
  assertNotNull(
    moteAt(shown, CARRIED_TO),
    "the cycle really ran: the arm's clockwise step carried its mote from (1, 3) to (0, 4)",
  );

  assertGreaterThan(
    spritesOn(calls, CARRIED_TO, MOTE_SPRITE_SIZE),
    0,
    "the finished machine stays visible behind the panel, so the mote it is " +
      "holding is drawn on the hex the completing boundary left it on",
  );
  assertGreaterThan(
    spritesOn(calls, ARM, HUB_SPRITE_SIZE),
    0,
    "and the arm holding it is drawn on its anchor hex",
  );
  assertLength(
    imagesNear(calls, hexCenter(HELD_AT), ON_HEX).filter(
      (draw) => draw.image.width === MOTE_SPRITE_SIZE,
    ),
    0,
    "the field is drawn as the completing boundary left it rather than as the " +
      "run began it, so no mote is drawn back on (1, 3)",
  );
});
