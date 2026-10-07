// presentation/radiator-faces-follow-the-rotation — the marking a tower puts on
// its faces is on the faces its rotation gives it.
//
// THE RULE. `specs/overview.md`'s legibility table asks that "a tower's radiator
// faces are drawn distinctly from its plain faces, so the player can see which
// sides shed heat", and `specs/towers.md` fixes which sides those are: "The
// rotation turns the local faces into world faces in the order `N -> E -> S -> W`
// ... A tower's radiator faces are reported and drawn in world orientation." So a
// tower placed at rotation `1` draws its radiators one step round from its local
// ones, and on its local ones no longer. It matters because of what
// `specs/heat.md` does with them: `RAD_K` (`3.6`) against `BASE_K` (`1.1`) per
// edge-tile, so which way a tower is turned is worth better than three times the
// air cooling on that face, and a player who cannot see which sides they are
// cannot lay out a maze.
//
// THE TOWER, AND WHY THE ANSWER IS UNAMBIGUOUS. The Rime, whose local radiators
// are N, S and E, so exactly one of its four faces is plain (`specs/towers.md`).
// One step turns that set into E, S and W. Each of the four faces therefore
// answers a different way, and between them they say the whole rule:
//
//   N   marked at rotation 0 and not at rotation 1  -> it must CHANGE
//   W   marked at rotation 1 and not at rotation 0  -> it must CHANGE
//   E   marked at both                              -> it must NOT change
//   S   marked at both                              -> it must NOT change
//
// and every wrong model of the rotation reads as a different number. A build that
// ignores the rotation, one that turns two steps, and one that turns the wrong way
// all leave N marked, so all three fail on N. A build that draws no marking at all
// fails on N and W, because a face that carries nothing cannot change. A build
// that simply redraws its whole tower differently whenever the rotation changes
// fails on E and S. Only one step, the way `specs/towers.md` states it, answers
// all four.
//
// HOW IT IS READ, AND WHERE THE BAR COMES FROM. The SAME band of the SAME face of
// the SAME tower on the SAME tile at the SAME heat, on a tower posed at rotation
// `0` and one posed at rotation `1`. No colour is named and no two things the
// build drew are compared: whatever a build draws on a footprint that does not
// depend on the rotation — a body, an outline, a label, the heat read
// `specs/hud.md` asks for — is identical in both frames and cancels out of every
// reading, and what is left is exactly what the rotation moved. How far a band
// moves on its own is measured, by reading each band twice at one rotation, and a
// face that must change has to beat that by `NOISE_MARGIN` while a face that must
// not stays inside it.
//
// WHY THE SECOND TOWER IS A SECOND TOWER. `specs/building.md`: "A tower's
// orientation is fixed at the moment it is placed: a placed tower's rotation and
// its world radiator faces never change again." So the rotation-1 reading is taken
// on a tower posed at rotation 1, not on the first one turned.
//
// WHAT IT DOES NOT DECIDE. What the snapshot REPORTS for `radiatorFaces` is
// `towers/`'s item, and that the rotation is fixed at placement is `building/`'s.
// This is pixels, and it is about which faces carry the marking.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { worldRadiators } from "../constants";
import type { Side } from "../constants";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import { NOISE_MARGIN, faceBands, widestGap } from "./read";

/**
 * The type read, and where it stands: clear of the casing and both corridors.
 *
 * The Rime, because `specs/towers.md` gives it radiators on local N, S and E —
 * the one layout in the roster whose four faces each answer the turn differently.
 */
const TYPE = "rime";
const AT = { col: 12, row: 8 } as const;

/** The faces exactly one of the two rotations marks, and the two it marks at both. */
const CHANGES: readonly Side[] = ["N", "W"];
const KEEPS: readonly Side[] = ["E", "S"];

/** One rotation's four face bands, read twice so the frame's own movement shows. */
interface Reading {
  first: Record<Side, Rgb[]>;
  second: Record<Side, Rgb[]>;
}

/** Pose the type at `rotation` and read its four face bands on two frames. */
async function bandsAt(h: Harness, rotation: 0 | 1): Promise<Reading> {
  await h.debug.clearTowers();
  const id = await posePinnedTower(h, TYPE, AT.col, AT.row, 0, rotation);
  await h.debug.setTowerFiring(id, false);
  await h.advance(1);
  const tower = requireTower(await h.snapshot(), id, `rotation ${rotation}`);
  const first = await faceBands(h, tower);
  await h.advance(1);
  await captureStill(h, rotation === 0 ? "unturned" : "turned");
  const second = await faceBands(h, tower);
  return { first, second };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks the faces rotation 1 gives, and no longer rotation 0's", async () => {
  await startRun(h);
  const unturned = await bandsAt(h, 0);
  const turned = await bandsAt(h, 1);

  const rule =
    `a ${TYPE}, whose world radiator faces are ` +
    `${worldRadiators(TYPE, 0).join(", ")} at rotation 0 and ` +
    `${worldRadiators(TYPE, 1).join(", ")} at rotation 1 (specs/towers.md: ` +
    `the rotation turns the local faces N -> E -> S -> W)`;

  /** How far the band on `side` moves between two frames at one rotation. */
  const noiseOn = (side: Side): number =>
    Math.max(
      widestGap(unturned.first[side], unturned.second[side]).distance,
      widestGap(turned.first[side], turned.second[side]).distance,
    );

  for (const side of CHANGES) {
    const noise = noiseOn(side);
    assertGreaterThanOrEqual(
      widestGap(unturned.second[side], turned.second[side]).distance,
      noise + NOISE_MARGIN,
      `${rule}: its world ${side} face, which exactly one of the two ` +
        `rotations marks, is drawn differently at rotation 1 than at ` +
        `rotation 0 — past the ${noise} that band moves between two frames at ` +
        `one rotation`,
    );
  }

  for (const side of KEEPS) {
    const noise = noiseOn(side);
    assertLessThanOrEqual(
      widestGap(unturned.second[side], turned.second[side]).distance,
      noise + NOISE_MARGIN,
      `${rule}: its world ${side} face, which is a radiator at BOTH ` +
        `rotations, is drawn the same way at rotation 1 as at rotation 0 — ` +
        `within the ${noise} that band moves between two frames at one ` +
        `rotation`,
    );
  }
});
