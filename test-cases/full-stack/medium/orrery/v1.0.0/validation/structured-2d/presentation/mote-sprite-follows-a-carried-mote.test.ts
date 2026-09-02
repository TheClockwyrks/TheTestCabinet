// presentation/mote-sprite-follows-a-carried-mote — half way through a carry the
// mote's sprite is where the mote is, not where it started.
//
// THE RULE. The Motes row of `specs/assets.md` (The sprites) draws the sprite
// "centered on every mote's position, at rest and while carried". A carried mote's
// position within a cycle is what `specs/simulation.md` imposes — a `rotate-cw`
// turns "the same rotation about the base" onto each held constellation, sweeping
// `60 * t` degrees — and `specs/editor.md` says the field shows it: "The machine,
// the motes, and the arms' live poses are drawn on the field as the run leaves
// them each frame, motion interpolated smoothly along the same paths the collision
// rule samples."
//
// WHERE THE CHECK READS THAT POSITION FROM. `specs/instrumentation.md` reports it:
// a mote of `sim.motes` carries `q` and `r`, "the hex at the last boundary", and
// `x` and `y`, "the drawn position at the current fraction, in stage units". So
// the sprite belongs on `(x, y)`, and the hex the mote left is `(q, r)` — the two
// are the same figure only at a boundary, which is why this reads at half a cycle.
//
// THE CONFIGURATION. `BARE` opened as a bare run — the completion switch held
// off, an EMPTY FIELD — with one arm at `(0, 0)`, rotation `0`, length `1`, whose
// tape is a single `rotate-cw`, and one mote spawned back on `(1, 0)`, the arm's
// gripper hex ("one gripper per spoke at `base + length * DIRS[d]`",
// `specs/parts.md`). The hold is given with `setGrip`, "which takes hold with no
// `grab` ever running" (`specs/instrumentation.md`), so the only cycle that runs is
// the sweep. Nothing else is on the field, so nothing else is carried and nothing
// can collide.
//
// THE VERDICT is read at `sim.fraction` `0.5`: the sprite's centre is the position
// `sim.motes` reports. A build that left the sprite on the hex the mote began on
// fails, because the reported position has left that hex by then — which the check
// reads back first, so the comparison is about a sprite that had somewhere to move
// to.
//
// THE TOLERANCE is one logical unit, which `specs/assets.md` (Scale) makes one
// screen pixel at the reference `1280`-pixel fit.
//
// THE EVIDENCE is the carry itself, recorded as it is driven.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, fail } from "../assert";
import {
  FRACTION_TOLERANCE,
  FRAMES_PER_CYCLE,
  MOTE_SPRITE_PATHS,
} from "../constants";
import { at, distance, hexCenter } from "../field";
import { BARE } from "../fixtures";
import { armPart, solution } from "../formats";
import {
  advanceFraction,
  captureReplay,
  createHarness,
  imageDraws,
  moteById,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";
import { assetFile } from "../assets/files";
import { decodeSprite, sameAsDrawn } from "../assets/sprites";

/** One logical unit: one screen pixel at the reference fit (`specs/assets.md`). */
const PLACEMENT_TOLERANCE = 1;

/** The hex the carried mote begins the cycle on, and the type it is. */
const START = at(1, 0);
const TYPE = "sol";

/** Where in the cycle the sprite is read: half way, well clear of both ends. */
const AT_FRACTION = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("centres the carried mote's sprite on the position sim.motes reports", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
  });
  const [arm] = await partIds(h);
  const mote = await spawnMote(h, START, TYPE);
  await takeGrip(h, arm, 0, mote);

  await captureReplay(h, "carry", () =>
    advanceFraction(h, AT_FRACTION, FRAMES_PER_CYCLE / 2),
  );

  const snapshot = await h.snapshot();
  assertNear(
    snapshot.sim?.fraction ?? -1,
    AT_FRACTION,
    FRACTION_TOLERANCE,
    "the fraction the cycle was read at",
  );
  const carried = moteById(snapshot, mote);
  if (carried === null) {
    fail("the carried mote in sim.motes", "no mote with that id");
  }

  const from = hexCenter(START);
  assertGreaterThan(
    distance({ x: carried.x, y: carried.y }, from),
    PLACEMENT_TOLERANCE,
    "how far the position sim.motes reports has left the hex the mote began the cycle on",
  );

  const file = assetFile(MOTE_SPRITE_PATHS[TYPE]);
  const read = await decodeSprite(file);
  if (read.sprite === null) fail(`a decoded ${file}`, read.reason);

  // Every draw of that file in the frame, and the one nearest the position the
  // sprite belongs on — so a build that left it behind is reported as a sprite in
  // the wrong place rather than as no sprite at all.
  const calls = await h.lastCalls();
  let painted: { cx: number; cy: number } | null = null;
  for (const draw of imageDraws(calls)) {
    const drawn = await h.imagePixels(draw.image.id);
    if (drawn === null || !sameAsDrawn(read.sprite, drawn)) continue;
    const here = { cx: draw.cx, cy: draw.cy };
    if (
      painted === null ||
      distance({ x: here.cx, y: here.cy }, { x: carried.x, y: carried.y }) <
        distance(
          { x: painted.cx, y: painted.cy },
          { x: carried.x, y: carried.y },
        )
    ) {
      painted = here;
    }
  }
  if (painted === null) {
    fail(`an image draw of ${file} somewhere in the frame`, "no such draw");
  }

  assertNear(
    painted.cx,
    carried.x,
    PLACEMENT_TOLERANCE,
    "the stage x the carried mote's sprite is centred on, against the x sim.motes reports",
  );
  assertNear(
    painted.cy,
    carried.y,
    PLACEMENT_TOLERANCE,
    "the stage y the carried mote's sprite is centred on, against the y sim.motes reports",
  );
});
