// presentation/faulted-motes-drawn-distinct — a mote the fault names is drawn
// otherwise than the same mote resting on the same hex unnamed.
//
// THE RULE. "While `sim.status` is `faulted`, the field shows the machine frozen
// at the cycle the fault stopped, the parts and motes `specs/simulation.md` names
// in the fault drawn visibly distinct from the rest" (`specs/ui.md`, The fault
// display). Which motes those are comes from the payload table of
// `specs/simulation.md` (Faults): "`torn` — `parts`: every part holding the
// constellation; `motes`: every mote of the constellation".
//
// WHY `torn` RATHER THAN `collision`. The torn check runs "at the start" of the
// motion step (`specs/simulation.md`, One cycle runs in this order), so the run
// freezes before anything sweeps: "every other fault ... leaves [the fraction] at
// `0`", and every mote is still on its own hex. The two poses below therefore
// show the named motes at exactly the same places, which is what lets the same
// mote be read named and unnamed.
//
// HOW IT IS DRAWN IS THE BUILD'S. `specs/ui.md` "fixes no palette, no font, and
// no background", and nothing in `specs/` fixes a mark, a colour or a geometry
// for the distinction — so what is read is that the mote is drawn OTHERWISE when
// the fault names it, never what makes it so, exactly as
// `campaign/select-highlight-drawn-distinctly` and
// `editor/the-selected-part-is-drawn-distinct` read their own requirements.
//
// THE TWO POSES. Two chains of four motes stand far apart on the field, one along
// `r = -2` and one along `r = 2`, each joined by three plain filaments so it is
// one constellation — "A constellation is a maximal group of motes connected by
// filaments" (`specs/field.md`). Each chain is held by two arms, one gripper on
// its first mote and one on its second, taken through `setGrip`, "which takes
// hold with no `grab` ever running". In the first pose the NORTH chain's outer
// arm carries `rotate-cw` and every other tape is blank; in the second the SOUTH
// chain's outer arm carries it instead. A rotation and a rest "do not agree", so
// the chain whose arms disagree is torn and the other is not, and the fault names
// every mote of the torn chain.
//
// SO THE NORTH CHAIN'S LAST MOTE — held by no gripper, and the mote this point
// reads — is named by the fault in the first pose and is one of "the rest" in the
// second, on the same hex, of the same type, with the same neighbours and the
// same filaments, in a run frozen at the same cycle and the same fraction.
//
// WHY THE LAST MOTE. `specs/assets.md` fires the fault effect at "the position of
// the mote the fault ... names, lowest in `y` and then lowest in `x` among them",
// and the four motes of a chain share one `y`, so the effect plays on the chain's
// FIRST mote whichever way `lowest` is read. The window is read around the mote
// four hexes further along, and the two holders' anchors and grippers lie further
// away still, so what the window holds is one named mote's own drawing rather
// than an effect or a part's marking. The frozen run is left a further
// `SETTLE_SECONDS` of game time before it is read all the same, because each
// system is "authored one-shot ... so it decays to empty rather than settling
// into a steady state".
//
// EVERYTHING ELSE THE TWO FRAMES SHOW IS THE SAME. The same calls in the same
// order over the same clock, so `state.simTime` reaches the same figure in both;
// the same fault kind, so a banner naming it carries the same words; and the same
// eight motes on the same eight hexes, since nothing moved in either pose.
//
// THE VERDICT. The window around the north chain's last mote is drawn
// differently between the pose that names it and the pose that does not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { MOTE_R, TICK_HZ } from "../constants";
import { at, hexCenter, type Hex, type Region } from "../field";
import { armPart, solution, type SolutionPart } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  pixelsDiffering,
  spawnConstellation,
  takeGrip,
  type Harness,
  type PixelRect,
} from "../harness";

/** How much further game time a frozen run is given before it is read. */
const SETTLE_SECONDS = 5;

/** That span in whole frames of the harness's own clock. */
const SETTLE_FRAMES = SETTLE_SECONDS * TICK_HZ;

/**
 * Half the side of the square a mote's own drawing is read inside.
 *
 * `MOTE_R` (`22`) is "the radius every mote's drawn form fits inside"
 * (`specs/field.md`), and a mark that tells a mote apart may sit just outside it,
 * so the window is that radius with a margin — and still well short of the
 * `HEX_PITCH` (`48`) that separates it from the next mote's own hex.
 */
const MOTE_WINDOW_R = MOTE_R + 14;

/** The north chain's four hexes, in order along the row. */
const NORTH: readonly Hex[] = [at(1, -2), at(2, -2), at(3, -2), at(4, -2)];

/** The south chain's four hexes, laid out the same way a row further down. */
const SOUTH: readonly Hex[] = [at(0, 2), at(1, 2), at(2, 2), at(3, 2)];

/** The two arms that hold a chain: one anchored west of it, one on its first hex. */
function holders(chain: readonly Hex[], turning: boolean): SolutionPart[] {
  const first = chain[0] as Hex;
  const second = chain[1] as Hex;
  return [
    armPart("arm", first.q - 1, first.r, 0, 1, turning ? ["rotate-cw"] : []),
    armPart("arm", second.q - 1, second.r, 0, 1, []),
  ];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The window one mote's own drawing is read inside. */
function windowAround(hex: Hex): Region {
  const centre = hexCenter(hex);
  return {
    x: centre.x - MOTE_WINDOW_R,
    y: centre.y - MOTE_WINDOW_R,
    w: MOTE_WINDOW_R * 2,
    h: MOTE_WINDOW_R * 2,
  };
}

/** The window read around the north chain's last mote, which this point is about. */
const READ = windowAround(NORTH[3] as Hex);

/** Spawn one four-mote chain, join it, and hand its first two motes to two arms. */
async function chain(
  hexes: readonly Hex[],
  first: number,
  second: number,
): Promise<number[]> {
  const motes = await spawnConstellation(
    h,
    hexes.map((hex) => ({ hex, type: "dust" as const })),
    [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 3 },
    ],
  );
  await takeGrip(h, first, 0, motes[0] as number);
  await takeGrip(h, second, 0, motes[1] as number);
  return motes;
}

/**
 * Pose both chains with the tear on one of them, run the cycle that tears it, let
 * the effect decay, and answer the window around the north chain's last mote.
 *
 * `tearing` is `0` for the north chain and `1` for the south one.
 */
async function pose(tearing: number): Promise<PixelRect> {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      ...holders(NORTH, tearing === 0),
      ...holders(SOUTH, tearing === 1),
    ]),
  });
  const placed = await partIds(h);
  assertLength(
    placed,
    4,
    "the machine is the four arms that hold the two chains",
  );

  const north = await chain(NORTH, placed[0] as number, placed[1] as number);
  const south = await chain(SOUTH, placed[2] as number, placed[3] as number);
  assertEqual(
    (await h.snapshot()).sim?.grips.length,
    4,
    "each chain is held by two grippers, which is what makes its imposed motions " +
      "something that can disagree",
  );

  await advanceCycles(h, 1);
  await h.advance(1);
  await h.advance(SETTLE_FRAMES);
  if (tearing === 0) await captureStill(h, "marked");

  const sim = (await h.snapshot()).sim;
  assertEqual(
    sim?.status,
    "faulted",
    "a rotation and a rest do not agree, so the held constellation is torn and " +
      "the run freezes",
  );
  assertEqual(
    sim?.fault?.kind,
    "torn",
    "the fault a disagreement raises is torn",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [...(tearing === 0 ? north : south)].sort((a, b) => a - b),
    `the fault names every mote of the ${tearing === 0 ? "north" : "south"} chain, ` +
      "in ascending mote id, and no mote of the other",
  );

  return h.pixelRect(READ.x, READ.y, READ.w, READ.h);
}

it("draws the mote the fault names differently from the same mote unnamed", async () => {
  const named = await pose(0);
  const unnamed = await pose(1);

  assertGreaterThan(
    pixelsDiffering(named, unnamed),
    0,
    "the north chain's last mote is drawn visibly distinct where the fault names " +
      "it and as one of the rest where the fault names the south chain instead, " +
      "so a torn body's motes are picked out of the frozen field",
  );
});
