// waves/pause-freezes-the-heat — while the game is paused a firing tower's heat
// holds where it was.
//
// specs/waves.md, Pause and speed: "While the game is paused the simulation does
// not advance: nothing moves, NO HEAT CHANGES, no clock counts down, no unit is
// released, and `simTime` holds where it was."
//
// THE SAME MEASUREMENT AS `waves.pause-freezes-the-floor`, TURNED ON THE SIGNATURE
// SYSTEM. Heat is what this game is about, and it is resolved on its own pass of
// the frame (specs/heat.md), so a build can perfectly well hold its surge still
// while its heat pass runs on. Only a reading taken on the heat catches that.
//
// ================================ THE CLOCK RULE ============================
//
// ANY CHECK ABOUT WHETHER TIME PASSES IS MEASURED ON THE CLOCK THE PLAYER'S GAME
// ACTUALLY RUNS ON, NEVER THROUGH A STEPPING OPERATION. Under this engine
// `engine.advance` is the engine's own frame loop running the identical `update` a
// player's frame runs, so `overWindow` IS the player's clock; what the rule binds
// is the shape. TWO LEGS OF THE SAME LENGTH ON THE SAME TOWER, a running one its
// heat must move across and a paused one it must not; BOTH PAUSED READINGS FROM THE
// ONE SNAPSHOT ON THE PRESS, which is what `overWindow` guarantees; and the pause
// pressed through its real binding rather than posed with `setScreen`, which runs
// no screen entry effect (specs/instrumentation.md). The running leg is what stops
// a build with no heat model at all passing the paused one vacuously.
//
// ============================================================================
//
// THE TOWER IS A STUTTER, and the choice is what makes the two bounds far apart.
// specs/towers.md gives it `7.0` shots per second at `4.2` heat a shot into a
// thermal mass of `0.5`, so one shot moves its heat by `8.4` and a second and a
// half of firing is ten of them. The running leg therefore moves the heat by tens
// of points while the most a single stray frame could add is one shot's worth — and
// the drift ceiling has to clear one shot's worth, because a build may legally
// resolve the injected key on the frame after it arrived and that frame may be the
// one a shot lands on. An Arc, at `2.0` shots per second and `10.3` heat a shot,
// would put the two bounds within a whisker of each other.
//
// BOTH ITS FACULTIES RUN. The tower is posed by `addTower` alone, so its firing and
// its thermal model are both on (specs/instrumentation.md): the heat this reads is
// the shot gain and the air loss together, which is the heat a player watches.
//
// THE MARK CANNOT DIE AND CANNOT WALK. `poseTarget` holds its tile and gives it an
// hp ceiling far past anything this window's shots remove, so the tower has a target
// for the whole of both legs and neither leg ends early with the guns falling
// silent.
//
// THE HEAT STARTS AT `0`, where a placed tower starts (specs/instrumentation.md),
// and that is asserted rather than assumed. specs/heat.md makes air cooling
// proportional to `H / 100`, so a tower that opened the window hot would shed as
// fast as it gained and the running leg would read a plateau rather than a climb —
// a failure of the pose rather than of the pause, and the precondition says which.
//
// WHAT EVERY WRONG MODEL READS. A build whose pause leaves the heat pass running
// climbs through the paused leg exactly as it did through the running one; a build
// that stops the surge but not the emitters does the same; a build with no heat
// model fails the running leg.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  overWindow,
  poseTarget,
  poseTower,
  startRun,
  ticksFor,
  towerOf,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds the pause to. */
const PAUSE_KEY = BINDINGS.pause[0];

/** The emitter watched, and where it stands: open floor, clear of both corridors. */
const TOWER = "stutter";
const SITE = { col: 4, row: 4 } as const;

/**
 * The tile the mark stands on: three tiles right of the tower's anchor.
 *
 * Off the 2x2 footprint and `48` logical units from its centre, comfortably inside
 * the Stutter's `5.0`-tile (`95` unit) range measured from that centre
 * (specs/combat.md, specs/towers.md).
 */
const MARK = { col: 7, row: 4 } as const;

/** The length of each leg: a second and a half of the build's own clock. */
const WINDOW = ticksFor(1.5);

/**
 * The least the heat must move across the running leg: `30` points.
 *
 * specs/towers.md fires the Stutter at `7.0` shots a second for `4.2` heat a shot
 * into a mass of `0.5`, which is `8.4` a shot, so this window is ten shots and `84`
 * points of gain against an air loss proportional to the heat reached — a
 * conformant build ends the leg somewhere in the sixties. The floor is under half
 * of that, so a build whose fire clock or thermal mass differs is not troubled by
 * it, and it sits well clear of the drift ceiling below.
 */
const MIN_HEAT_GAIN = 30;

/**
 * The most the heat may move across the paused leg: `9` points.
 *
 * Not zero, and the figure is one shot's worth. The press and the heat are read a
 * round trip apart, a build may legally resolve an injected key on the frame after
 * it arrived, and that frame may be the one on which a shot lands: one Stutter shot
 * is `4.2` heat into a mass of `0.5`, which is `8.4`. Nine clears it, and it is
 * under a third of what a leg that kept firing moves.
 */
const MAX_HEAT_DRIFT = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a firing tower's heat across a paused window it climbed the one before", async () => {
  startRun(h);
  const gun = poseTower(h, TOWER, SITE.col, SITE.row);
  poseTarget(h, "mote", MARK.col, MARK.row);

  const legs = await captureReplay(h, "frozen", async () => {
    const running = await overWindow(h, WINDOW);
    await h.tap(PAUSE_KEY);
    const screen = h.snapshot().screen;
    const paused = await overWindow(h, WINDOW);
    return { running, paused, screen };
  });

  assertEqual(legs.screen, "paused", "precondition: the press paused the game");
  assertEqual(
    towerOf(legs.running.before, gun).heat,
    0,
    `precondition: the heat the ${TOWER} opened the running leg at`,
  );
  assertGreaterThan(
    legs.running.heatChange(gun),
    MIN_HEAT_GAIN,
    `the heat a firing ${TOWER} gained across the running leg`,
  );
  assertLessThan(
    Math.abs(legs.paused.heatChange(gun)),
    MAX_HEAT_DRIFT,
    `the heat a firing ${TOWER} moved by across the paused leg`,
  );
});
