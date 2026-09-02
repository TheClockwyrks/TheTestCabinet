// controls/setmaze-houses-predators — a posed layout sets the layout and nothing
// else.
//
// specs/instrumentation.md fixes what `setMaze` touches, and the sentence is
// exhaustive: "The layout is the whole of what it sets. The plankton, the
// revealed-tile memory, the roster, every body's tile and facing, the cooldowns,
// the score, the lives, the depth and the screen are all left exactly as they
// stand." It also fixes what the game does with the fixture afterwards: it
// behaves "in every respect as though the posed layout were the maze it had laid
// out itself", accepting it "without repairing it, refusing it, stalling on it,
// or returning to a maze of its own".
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
// SO EVERY READING THE SENTENCE NAMES IS POSED OFF ITS OPENING VALUE AND READ BACK
// ACROSS THE CALL. The score, the lives, the depth, both cooldowns, a plankton, a
// bonus drifter, the forager's tile and facing, and a roster of three hunters —
// `setDepth(1)` lays out one of each kind (specs/predators.md) and one of them is
// posed out onto a named corridor tile with a facing of its own. Three hunters
// rather than one, deliberately: the roster is part of the claim, and a build that
// keeps the first entry and loses the rest is exactly what one predator would not
// catch.
//
// THE HUNTERS ARE HELD WHERE THEY LIE. Every one of them is a bystander to this
// contract: what is being read is what an operation SET, not how a body travels,
// so `holdPredators` leaves each mind running and each body still. Whether a
// hunter keeps to the corridors of a layout posed under it is
// `maze-movement/predators-keep-to-corridors`' verdict, and a roster free to
// travel here would only add its failures to this one.
//
// AND THE FIXTURE IS WATCHED AFTERWARDS. The layout is read back once more at the
// end of a watch that runs past the `10 s` the third hunter of a depth-1 roster
// would be due at, so a build that quietly repairs the fixture, or returns to a
// maze of its own once its own schedule comes round, is caught by the tiles rather
// than by inference.

import { afterEach, beforeEach, it } from "vitest";
import { DEN_RELEASE_GAP } from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  holdPredators,
  placeForager,
  placePredator,
  poseMaze,
  spawnDrifter,
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
 * The first layout: a corridor with the forager at one end, a named tile for the
 * hunter that is posed out of the den, and a named tile for the plankton.
 *
 * Two rows of rock below it sits a den chamber — three den tiles with the gate
 * above the middle one and rock on the gate's other three sides — which is where
 * `setDepth` lays the roster out.
 */
const FIRST = ["F.KH.D.", "", "", "     g", "    ddd"];

/**
 * The second layout, stamped over the first at the same corner: the same corridor
 * with `H` closed to rock, and no den chamber anywhere.
 *
 * `H` is closed deliberately: the tiles the call sets are read against the rows
 * it was handed, so the second layout has to differ from the first somewhere.
 */
const SECOND = ["F.K#.D."];

/** The depth whose roster this point poses, which holds one of each kind. */
const DEPTH = 1;

/** The score posed off `0`, which an opening dive carries. */
const SCORE = 4321;

/** The lives posed off the `START_LIVES` an opening dive carries. */
const LIVES = 1;

/** The sonar cooldown posed off the ready `0` an opening dive carries. */
const SONAR_LEFT = 3.5;

/** The ink cooldown posed off the ready `0` an opening dive carries. */
const INK_LEFT = 6.25;

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
  const pellet = board.mark("K");
  // Faced into the rock above a corridor one tile wide, so it stays where it is
  // put for the whole watch (specs/movement.md).
  await placeForager(h, board.mark("F"), "up");

  // The roster this point is about: one of each kind, laid out in the fixture's
  // own den (specs/instrumentation.md), with one of them posed out onto the
  // corridor and faced along it, and every one of them held where it lies.
  h.debug.setDepth(DEPTH);
  const loose = 0;
  await placePredator(h, loose, board.mark("H"), {
    dir: "left",
    state: "wander",
  });
  await holdPredators(h);

  // And the rest of the sentence, each posed off the value an opening dive
  // carries so that reading it back is a question rather than a formality.
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  h.debug.setSonarCooldown(SONAR_LEFT);
  h.debug.setInkCooldown(INK_LEFT);
  h.debug.setPlankton(pellet.tx, pellet.ty, true);
  await spawnDrifter(h, board.mark("D"), { mind: false });
  const watch = await sceneGuard(h);

  const before = h.snapshot();
  // The drifter and the pellet really are on the board, so the two readings
  // below are of something rather than of an empty list.
  assertLength(
    before.drifters,
    1,
    "the bonus drifter this point poses onto the board before the call",
  );
  assertGreaterThan(
    before.planktonRemaining,
    0,
    "the plankton this point poses onto the board before the call",
  );
  const second = stampLayout(before, SECOND, { at: board.at }).rows;
  h.debug.setMaze(second);
  const after = h.snapshot();

  const stride = ticks(FILMED_SECONDS);
  await captureReplay(h, "housed", () => h.advance(stride));
  await h.advance(ticks(WATCH_SECONDS - FILMED_SECONDS));
  const ended = h.snapshot();

  requireSceneHeld(ended, watch);

  // ---- What the call SET ----------------------------------------------------
  assertDeepEqual(
    after.tiles,
    second,
    "the tiles after the call, against the rows it was handed — the layout is " +
      "what setMaze sets, and it is used exactly as given",
  );

  // ---- The roster -----------------------------------------------------------
  // The comparison was worth taking: a roster with nothing on it would clear
  // every reading below without the build having kept anything.
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

  // ---- And every other reading the sentence names ---------------------------
  const kept: [string, unknown, unknown][] = [
    ["the score", after.score, before.score],
    ["the lives", after.lives, before.lives],
    ["the depth", after.depth, before.depth],
    ["the screen", after.screen, before.screen],
    ["the sonar cooldown", after.sonar.cooldown, before.sonar.cooldown],
    ["the ink cooldown", after.ink.cooldown, before.ink.cooldown],
    [
      "the plankton remaining",
      after.planktonRemaining,
      before.planktonRemaining,
    ],
    ["the plankton layer", after.plankton.join("|"), before.plankton.join("|")],
    [
      "the revealed-tile memory",
      after.visibility.join("|"),
      before.visibility.join("|"),
    ],
    [
      "the bonus drifters on the board",
      after.drifters.length,
      before.drifters.length,
    ],
    [
      "the forager's tile",
      `${after.forager.tx}, ${after.forager.ty}`,
      `${before.forager.tx}, ${before.forager.ty}`,
    ],
    ["the forager's facing", after.forager.dir, before.forager.dir],
  ];
  for (const [what, now, was] of kept) {
    assertEqual(
      now,
      was,
      `${what} across a posed layout, which sets the layout and leaves every ` +
        "one of these exactly as it stands (specs/instrumentation.md)",
    );
  }

  // ---- And the game carried on on the fixture -------------------------------
  assertDeepEqual(
    ended.tiles,
    second,
    `the tiles after ${WATCH_SECONDS} s of live play on the posed layout — ` +
      "the game accepts a fixture without repairing it, stalling on it, or " +
      "returning to a maze of its own",
  );
  assertEqual(
    ended.screen,
    "playing",
    "the dive stayed in live play across the posed layout, which sets the " +
      "layout and leaves the screen as it stands",
  );
});
