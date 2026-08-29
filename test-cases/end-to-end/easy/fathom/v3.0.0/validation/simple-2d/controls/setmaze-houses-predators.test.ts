// controls/setmaze-houses-predators — a posed layout leaves the roster alone.
//
// specs/instrumentation.md fixes what `setMaze` touches, and the sentence is
// exhaustive: "The layout is the whole of what it sets. The plankton, the
// revealed-tile memory, the roster, every body's tile and facing, the cooldowns,
// the score, the lives, the depth and the screen are all left exactly as they
// stand." It then fixes what becomes of a body the new layout closes over: "A body
// the new layout leaves on a tile closed to it holds that tile and travels
// nowhere, because travel carries a body only along tiles open to it."
//
// WHY THIS IS ITS OWN POINT. Most of this suite poses a fixture and then measures
// something standing on it, and every one of those checks is only as good as this
// contract. A build that rebuilds the board and rearranges its hunters with it
// drops them wherever its own bookkeeping puts them, which is regularly the
// corridor the scenario is about. One run went exactly that way: a Lanternjaw
// stood in the middle of a posed corridor, ate the forager a quarter of a second
// in, and three unrelated points reported an input bug and a turning bug against a
// build whose input and turning were fine. This is the point that fails for it.
//
// SO THE ROSTER IS POSED AND READ BACK WHOLE. `setDepth(1)` lays out the depth-1
// roster in the fixture's den, one of each kind (specs/predators.md), and one of
// them is posed out onto a named corridor tile with a facing of its own. A second
// layout is then posed over the top — the same corridor with that one tile closed
// to rock, and no den chamber at all — and every field of every predator is
// compared across the call. Three hunters rather than one, deliberately: the
// claim is about the roster, and a build that keeps the first entry and loses the
// rest is exactly what one predator would not catch.
//
// AND THE CLOSED TILE IS WATCHED. The hunter left standing on rock is loose,
// released and running its own mind, so a build that carries it anywhere at all is
// carrying a body across rock. The watch runs past the `10 s` the third hunter of
// a depth-1 roster would be due at, so a build that quietly rebuilds its own den
// out of the posed layout has time to walk somebody out of it.

import { afterEach, beforeEach, it } from "vitest";
import { DEN_RELEASE_GAP } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  placeForager,
  placePredator,
  poseMaze,
  stampLayout,
} from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";

/**
 * The first layout: a corridor with the forager at one end and a named tile for
 * the hunter that is posed out of the den.
 *
 * Two rows of rock below it sits a den chamber — three den tiles with the gate
 * above the middle one and rock on the gate's other three sides — which is where
 * `setDepth` lays the roster out.
 */
const FIRST = ["F..H...", "", "", "     g", "    ddd"];

/**
 * The second layout, stamped over the first at the same corner: the same corridor
 * with `H` closed to rock, and no den chamber anywhere.
 *
 * Both halves of the contract are read off this one call — the roster is left
 * exactly as it stands, and the body standing on `H` travels nowhere.
 */
const SECOND = ["F..#..."];

/** The depth whose roster this point poses, which holds one of each kind. */
const DEPTH = 1;

/**
 * How long the posed board is watched, in seconds.
 *
 * Past the `10 s` the third hunter of a depth-`1` roster is due at —
 * `DEN_RELEASE_GAP` twice over from the moment live play began — with room to
 * spare.
 */
const WATCH_SECONDS = 2 * DEN_RELEASE_GAP + 2;

/**
 * How much of the watch is filmed, in seconds.
 *
 * The opening two, which is the part worth looking at. The rest runs outside the
 * capture, which is the same real simulation and costs the clip nothing.
 */
const FILMED_SECONDS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the roster exactly as it stands when a layout is posed", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, FIRST);
  // Faced into the rock above a corridor one tile wide, so it stays where it is
  // put for the whole watch (specs/movement.md).
  await placeForager(h, board.mark("F"), "up");

  // The roster this point is about: one of each kind, laid out in the fixture's
  // own den (specs/instrumentation.md), with one of them posed out onto the
  // corridor and faced along it.
  h.debug.setDepth(DEPTH);
  const loose = 0;
  await placePredator(h, loose, board.mark("H"), {
    dir: "left",
    state: "wander",
  });
  const watch = await sceneGuard(h);

  const before = h.snapshot();
  const second = stampLayout(before, SECOND, { at: board.at }).rows;
  h.debug.setMaze(second);
  const after = h.snapshot();

  const stride = ticks(FILMED_SECONDS);
  await captureReplay(h, "housed", () => h.advance(stride));
  await h.advance(ticks(WATCH_SECONDS - FILMED_SECONDS));
  const ended = h.snapshot();

  requireSceneHeld(ended, watch);

  // The watch was worth taking: a roster with nothing on it would clear every
  // comparison below without the build having kept anything.
  assertGreaterThan(
    before.predators.length,
    1,
    `predators the depth-${DEPTH} roster carried when the second layout was ` +
      "posed, which is what the comparisons below are of",
  );
  assertEqual(
    after.predators.length,
    before.predators.length,
    "predators on the roster after a layout was posed over it",
  );
  assertEqual(
    after.predators.map((one) => one.kind).join(", "),
    before.predators.map((one) => one.kind).join(", "),
    "the kinds on the roster, in release order, across the posed layout",
  );

  const moved = after.predators.flatMap((now, index) => {
    const was = before.predators[index];
    if (was === undefined) return [];
    const differences: string[] = [];
    if (now.tx !== was.tx || now.ty !== was.ty) {
      differences.push(
        `its tile went from (${was.tx}, ${was.ty}) to (${now.tx}, ${now.ty})`,
      );
    }
    if (now.dir !== was.dir) {
      differences.push(`its facing went from ${was.dir} to ${now.dir}`);
    }
    if (now.state !== was.state) {
      differences.push(`its state went from ${was.state} to ${now.state}`);
    }
    if (now.released !== was.released) {
      differences.push(
        `its released flag went from ${String(was.released)} to ` +
          String(now.released),
      );
    }
    return differences.length === 0
      ? []
      : [`the ${now.kind}: ${differences.join(", ")}`];
  });
  assertLength(
    moved,
    0,
    "predators the posed layout changed, of the tile, facing, state and " +
      "released flag it leaves exactly as they stand" +
      (moved.length > 0 ? ` — ${moved.join("; ")}` : ""),
  );

  // And the body the new layout closed over. It is loose, released and running
  // its own mind, so anywhere it turns up it reached across rock.
  const stuck = ended.predators[loose];
  assertEqual(
    `${String(stuck.tx)}, ${String(stuck.ty)}`,
    `${String(before.predators[loose].tx)}, ${String(before.predators[loose].ty)}`,
    `the tile the ${stuck.kind} stands on after ${WATCH_SECONDS} s on a layout ` +
      "that closed that tile to rock, which travel carries a body off of nowhere",
  );
  assertEqual(
    ended.screen,
    "playing",
    "the dive stayed in live play across the posed layout, which sets the " +
      "layout and leaves the screen as it stands",
  );
});
