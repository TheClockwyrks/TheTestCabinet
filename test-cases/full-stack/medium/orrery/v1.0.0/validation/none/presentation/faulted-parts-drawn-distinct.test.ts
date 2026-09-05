// presentation/faulted-parts-drawn-distinct — a part the fault names is drawn
// otherwise than the same part standing on the same hex unnamed.
//
// THE RULE. "While `sim.status` is `faulted`, the field shows the machine frozen
// at the cycle the fault stopped, the parts and motes `specs/simulation.md` names
// in the fault drawn visibly distinct from the rest" (`specs/ui.md`, The fault
// display). Which parts those are comes from the payload table of
// `specs/simulation.md` (Faults): "Every fetch fault — `parts`: the faulting
// part; `motes`: empty". So `unmounted`, "`advance` or `recede` on a part not on
// a track", names exactly ONE part and no mote at all, which is the narrowest
// naming the specification offers and the cleanest world to read a part's own
// marking in.
//
// HOW IT IS DRAWN IS THE BUILD'S. `specs/ui.md` "fixes no palette, no font, and
// no background", and nothing in `specs/` fixes a mark, a colour or a geometry
// for the distinction — so what is read is that the part is drawn OTHERWISE when
// the fault names it, never what makes it so. That is the reading the case
// already makes of its other two "drawn distinct" requirements
// (`campaign/select-highlight-drawn-distinctly`,
// `editor/the-selected-part-is-drawn-distinct`).
//
// THE TWO POSES. Two arms stand on an otherwise EMPTY field, one on `WEST`
// (`(-3, 0)`) and one on `EAST` (`(3, 0)`), each at rotation `0` and length `1`
// and neither of them on a track. In the first pose the west arm's tape cell `0`
// carries `advance` and the east arm's is blank; in the second the two are
// swapped. Each pose runs one cycle, whose fetch — step 1 of the cycle, before
// drops, grabs and motion — raises `unmounted` on the one arm that was asked to
// advance and names that arm alone. So the WEST arm is named by the fault in the
// first pose and is one of "the rest" in the second, with its kind, its anchor,
// its rotation, its length, its rest pose and its neighbours identical in both.
//
// EVERYTHING ELSE THE TWO FRAMES SHOW IS THE SAME. Both poses are driven by the
// same calls in the same order over the same clock, so `state.simTime` — which
// "accumulates the frame's delta time on every update" (`specs/ui.md`) — reaches
// the same figure in both, and anything a build draws from it is drawn alike.
// Both fault as `unmounted` at cycle `0`, so a banner naming the fault carries
// the same words. And `openBareRun` empties the field, so there is no mote in
// either pose whose own marking could be what the reading picks up.
//
// THE ONE-SHOT EFFECT IS WAITED OUT. `specs/assets.md` fires the fault effect at
// "the anchor hex of the part it names" when the fault names no mote, and every
// system it fixes is "authored one-shot, its timeline set with `set-timeline
// --loop false`, so it decays to empty rather than settling into a steady
// state". Each pose therefore runs `SETTLE_SECONDS` of further game time before
// it is read — which a frozen run advances no cycle, no fraction and no mote
// over, "nothing advances further" (`specs/simulation.md`, Faults) — so what is
// left over the west arm is the frozen machine and whatever marks it.
//
// THE VERDICT. The window around the west arm is drawn differently between the
// pose that names it and the pose that does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { TICK_HZ } from "../constants";
import { hexX, hexY, type Hex, type Region } from "../field";
import { armPart, solution } from "../formats";
import { BARE, EAST, WEST } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  pixelsDiffering,
  type Harness,
  type PixelRect,
} from "../harness";

/**
 * How much further game time a frozen run is given before it is read.
 *
 * Long enough that a one-shot system authored to "decay to empty" has decayed,
 * and irrelevant to the simulation, which "advances no further" once it has
 * faulted. The same span runs in both poses, so a build that draws from
 * `state.simTime` draws the two frames the same way.
 */
const SETTLE_SECONDS = 5;

/** That span in whole frames of the harness's own clock. */
const SETTLE_FRAMES = SETTLE_SECONDS * TICK_HZ;

/** How deep the band read across an arm is, in logical units. */
const WINDOW_H = 72;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The window an arm's own drawing is read inside: its anchor hex and the gripper
 * hex east of it, with a hex of margin on each side and a band deep enough for
 * whatever is drawn on them. The window `editor/the-selected-part-is-drawn-distinct`
 * reads the same question in.
 */
function windowAround(anchor: Hex): Region {
  return {
    x: hexX(anchor.q - 1, anchor.r),
    y: hexY(anchor.q, anchor.r) - WINDOW_H / 2,
    w: hexX(anchor.q + 2, anchor.r) - hexX(anchor.q - 1, anchor.r),
    h: WINDOW_H,
  };
}

/** The window read around the west arm, which is the arm this point is about. */
const READ = windowAround(WEST);

/**
 * Pose the two arms with `advance` on one of them, run the cycle that faults, let
 * the effect decay, and answer the window around the west arm.
 *
 * `faulting` is `0` for the west arm and `1` for the east one, and the machine is
 * loaded as a DOCUMENT so both poses place the same two parts in the same
 * placement order — which is the order `sim.fault.parts` is reported in.
 */
async function pose(faulting: number): Promise<PixelRect> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", WEST.q, WEST.r, 0, 1, faulting === 0 ? ["advance"] : []),
      armPart("arm", EAST.q, EAST.r, 0, 1, faulting === 1 ? ["advance"] : []),
    ]),
  });
  const placed = await partIds(h);

  await advanceCycles(h, 1);
  await h.advance(1);
  await h.advance(SETTLE_FRAMES);
  if (faulting === 0) await captureStill(h, "marked");

  const sim = (await h.snapshot()).sim;
  assertEqual(
    sim?.status,
    "faulted",
    "`advance` on a part not on a track raises a fetch fault, which freezes the run",
  );
  assertEqual(
    sim?.fault?.kind,
    "unmounted",
    "the fault the fetch raises for `advance` off a track is `unmounted`",
  );
  assertDeepEqual(
    sim?.fault?.parts,
    [placed[faulting]],
    `the fault names the ${faulting === 0 ? "west" : "east"} arm, and no other part`,
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [],
    "a fetch fault names no mote, so no mote's marking is on the field",
  );

  return h.pixelRect(READ.x, READ.y, READ.w, READ.h);
}

it("draws the arm the fault names differently from the same arm unnamed", async () => {
  const named = await pose(0);
  const unnamed = await pose(1);

  assertGreaterThan(
    pixelsDiffering(named, unnamed),
    0,
    "the west arm is drawn visibly distinct where the fault names it and as one " +
      "of the rest where the fault names the east arm instead, so the arm that " +
      "raised the fault is picked out of the machine",
  );
});
