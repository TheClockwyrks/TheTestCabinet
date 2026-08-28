// maze-movement/predators-keep-to-corridors — the hunters' half of the rule the
// forager's `no-wall` decides, asked in both of the shapes it can be broken in.
//
// specs/predators.md states it and then spells out the two consequences: "A
// predator stands only on a tile it may enter: an open corridor tile, and, while
// it is in the den, a den tile or the den gate. Every position it occupies, in
// every state and at every moment, lies on such a tile. Two consequences are
// requirements in their own right. — A predator holding a fix rounds the rock
// between it and the fixed tile. Each step it takes is the first step of a
// shortest corridor route from its tile to that tile, so it takes the way around
// an obstacle even while the direction that shortens the straight line to the fix
// is rock. — A predator standing on a tile with no open neighbor stays on that
// tile, however long it stands there."
//
// TWO SHAPES, BECAUSE ONE OF THEM IS NOT ENOUGH. A build can respect rock whenever
// it has a legal move and still walk into it when it has none, and a build that
// only ever steps toward the straight line rounds nothing while never being boxed
// in. So this asks both: route around the obstacle, and stand still when there is
// nowhere to route to.
//
// WHY THIS POINT EXISTS AT ALL. Every posed fixture in this suite keeps a scenario
// apart with rock — a bystander walled off from its subject, a pair sealed into
// neighboring cells, a hunter in a sealed ring — and all of it rests on a predator
// not crossing rock. This point OWNS that claim, so the checks that merely stand
// on it can raise a precondition and step aside.
//
// THE GLOAMFIN CARRIES IT because the rule under test is the shared one every
// predator obeys and the Gloamfin needs no light managed to hold a fix
// (specs/predators/gloamfin.md). The fix itself is posed rather than earned:
// `setPredatorState(index, "chase")` leaves a predator "loose on the tile it
// stands on, with a fix on the forager's current tile, pursuing it"
// (specs/instrumentation.md), which is exactly the state the requirement is
// written about.
//
//
// AND IT DOES NOT STAND DOWN ON A HUNTER THAT NEVER MOVED. Most checks in this
// suite defer to this one when a predator covers no ground, because a hunter that
// cannot travel has not exhibited whatever they were reading. This point is where
// that deferral lands: a hunter holding a fix that presses into the rock between
// it and the fixed tile and stops there is exactly the fault named above, and a
// precondition here would turn the fault it owns into a check that decided
// nothing.
// THE BOXED HALF RUNS OFF-CAMERA. The picture worth keeping is the hunter taking
// the long way round; a second of a predator correctly doing nothing is not. Its
// verdict is no weaker for it — the same real simulation runs either way.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  denAll,
  failPrecondition,
  indexOfKind,
  parkForager,
  sceneGuard,
  sceneHeld,
} from "../scene";
import type { FathomSnapshot } from "../surface";

/**
 * THE OBSTACLE. Two corridors with a rock spine between them, joined at their
 * right-hand ends alone. The hunter starts at `P` and its fix is `F`, directly
 * below it through the spine, so the one direction that shortens the straight
 * line is rock and the only route there is right, down, and back along the
 * bottom.
 */
const SPINE = ["P....", "####.", "F...."];

/**
 * AND NOWHERE TO GO. `B` is a single corridor tile with no open neighbor at all,
 * and the forager stands four tiles away — well outside `GLOAMFIN_HEAR` (`64`),
 * so nothing about the pose turns on what the hunter can hear.
 *
 * specs/instrumentation.md makes this a layout a build must cope with: a posed
 * fixture "is used exactly as given" and is "exempt from every rule in
 * specs/maze.md", and "the game keeps running on one".
 */
const BOXED = ["B   F.."];

/**
 * How often the hunter's tile is read, in ticks.
 *
 * Six ticks is at most seven logical units at any predator speed
 * specs/predators.md and the per-kind files fix, well under a `TILE`, so no
 * tile it stands on can be stepped over between two reads.
 */
const SAMPLE_TICKS = 6;

/**
 * How long the boxed hunter is watched, in ticks.
 *
 * A second, which is three tiles and more of travel at any speed the
 * specification names for a loose predator: a hunter that means to move has moved
 * long before this runs out.
 */
const BOX_WATCH_TICKS = 120;

/**
 * How long the routing hunter is watched, in ticks.
 *
 * The way around the spine is six tiles, `192` logical units, which is `1.7 s` at
 * the slowest speed specs/predators/gloamfin.md fixes for a chasing Gloamfin
 * (`GLOAMFIN_CORNER_SPEED`, `115`). Three seconds is nearly twice that, and it is
 * a HARD bound: a hunter that has not reached the fix's corridor by then has not
 * rounded the spine, and this check FAILS rather than waiting on it.
 */
const ROUTE_WATCH_TICKS = 360;

/**
 * Ticks recorded after the watch closes, so the clip shows the hunter still
 * closing rather than stopping the moment the verdict was taken.
 *
 * A tile's worth of travel, which leaves it three tiles short of the forager, so
 * nothing here reaches contact.
 */
const ROUTE_TAIL_TICKS = 30;

/** Where a hunter stands, and what kind of tile that is. */
function standing(
  snap: FathomSnapshot,
  index: number,
): { where: string; kind: string | undefined } {
  const predator = snap.predators[index];
  return {
    where: `(${predator.tx}, ${predator.ty})`,
    kind: snap.tiles[predator.ty]?.[predator.tx],
  };
}

/** Add `entry` to `seen` once. */
function note(seen: string[], entry: string): void {
  if (!seen.includes(entry)) seen.push(entry);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps a hunter to the corridors, rounding a spine and staying put when boxed in", async () => {
  const roster = startPlaying(h);
  const gloamfin = indexOfKind(roster, "gloamfin");
  if (gloamfin < 0) {
    // Which kinds a roster carries is `scoring/depth-scaling`'s verdict; with no
    // Gloamfin there is no scenario to pose here.
    failPrecondition(
      "the roster to carry a Gloamfin, so there is a hunter to pose on either " +
        "fixture; specs/predators.md gives depth 1 one of each kind",
      "scoring/depth-scaling",
      roster.predators.map((one) => one.kind).join(", "),
    );
  }

  // ---- Boxed in, off-camera ------------------------------------------------
  const box = await poseMaze(h, BOXED);
  const boxed = box.mark("B");
  await parkForager(h, box.mark("F"));
  const boxQuiet = await denAll(h, [gloamfin]);
  h.debug.setPredatorTile(gloamfin, boxed.tx, boxed.ty);
  h.debug.setPredatorState(gloamfin, "chase");
  const boxGuard = await sceneGuard(h, boxQuiet);
  const boxHome = standing(h.snapshot(), gloamfin).where;

  const boxTrespass: string[] = [];
  const boxStrayed: string[] = [];
  for (let spent = 0; spent < BOX_WATCH_TICKS; spent += SAMPLE_TICKS) {
    await h.advance(SAMPLE_TICKS);
    const snap = h.snapshot();
    const at = standing(snap, gloamfin);
    if (at.where !== boxHome) note(boxStrayed, at.where);
    if (at.kind !== ".") {
      note(boxTrespass, `${at.where} is "${at.kind}"`);
      // Stop the moment the rule is broken. A hunter loose in the rock four
      // tiles from the forager reaches it inside this window, and the verdict
      // this point owes is "it stood on rock", not "a life was lost".
      break;
    }
  }
  const boxBroke = sceneHeld(h.snapshot(), boxGuard);

  // ---- Rounding the spine, on camera ---------------------------------------
  const board = await poseMaze(h, SPINE);
  const start = board.mark("P");
  const fix = board.mark("F");
  await parkForager(h, fix);
  const quiet = await denAll(h, [gloamfin]);
  h.debug.setPredatorTile(gloamfin, start.tx, start.ty);
  h.debug.setPredatorState(gloamfin, "chase");
  const guard = await sceneGuard(h, quiet);
  const opening = h.snapshot();

  const route = await captureReplay(h, "route", async () => {
    const trespass: string[] = [];
    let rounded = false;
    let last: FathomSnapshot = opening;
    for (let spent = 0; spent < ROUTE_WATCH_TICKS; spent += SAMPLE_TICKS) {
      await h.advance(SAMPLE_TICKS);
      last = h.snapshot();
      const at = standing(last, gloamfin);
      if (at.kind !== ".") {
        note(trespass, `${at.where} is "${at.kind}"`);
        // Stop the moment the rule is broken, well short of the forager, so the
        // verdict is "it stood on rock" rather than a life lost downstream of it.
        break;
      }
      if (last.predators[gloamfin].ty === fix.ty) {
        rounded = true;
        break;
      }
    }
    // Taken before the tail, so nothing recorded purely for the clip can reach
    // the verdict.
    const broke = sceneHeld(last, guard);
    await h.advance(ROUTE_TAIL_TICKS);
    return { trespass, rounded, broke, last };
  });

  assertNull(route.broke, "the spine scenario held to the end");
  assertNull(boxBroke, "the boxed-in scenario held to the end");

  assertEqual(
    boxTrespass.join("; "),
    "",
    `tiles the gloamfin stood on that are not corridor over ` +
      `${BOX_WATCH_TICKS} ticks boxed into (${boxed.tx}, ${boxed.ty}), a tile ` +
      "with no open neighbor",
  );
  assertEqual(
    boxStrayed.join("; "),
    "",
    `tiles the gloamfin left ${boxHome} for over ${BOX_WATCH_TICKS} ticks, ` +
      "having nowhere legal to go",
  );

  assertEqual(
    route.trespass.join("; "),
    "",
    "tiles the gloamfin stood on that are not corridor while chasing a fix " +
      `across the spine from (${start.tx}, ${start.ty})`,
  );
  assertEqual(
    route.rounded,
    true,
    `the gloamfin reached the corridor its fix (${fix.tx}, ${fix.ty}) is on ` +
      `within ${ROUTE_WATCH_TICKS} ticks, rather than pressing into the rock ` +
      "between them",
  );
});
