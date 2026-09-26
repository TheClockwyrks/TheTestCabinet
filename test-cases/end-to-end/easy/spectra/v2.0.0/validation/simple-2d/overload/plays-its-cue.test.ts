// overload/plays-its-cue — an overload sounds a cue of its own.
//
// specs/mode.md closes this mode's reactions with a sound: "Each overload plays the
// `overload` cue in the frame it happens, a distinct short sound beside the nine
// `specs/ui.md` states." specs/ui.md governs all of them with one sentence — "Each is
// played on the frame its event happens and at most once on that frame" — so the tenth
// cue is graded here and cannot be graded by the common `audio` group, which a base
// build shares and which has no such cue.
//
// THE MEASUREMENT IS THE ONE EVERY CUE POINT TAKES, and it is deliberately the same:
// `../audio/cues` steps ONE FRAME AT A TIME so a sound can be attributed to the frame
// that produced it, and reads what sounded on the event's own frame against what
// sounded over the frames before it. A batched drive would say only that a sound
// happened somewhere in the window, which a build that blips every frame satisfies.
// That helper is shared rather than copied so this cue is read exactly as the nine are.
//
// WHAT THE QUIET WINDOW IS MADE OF, AND WHY IT IS TWO SHOTS. The overload cue belongs
// to the OVERLOAD, not to a mismatched shot: specs/mode.md gives the mode two distinct
// outcomes for a wrong-band shot — one that adds a charge and one that tips the drone
// over — and only the second sounds. A window holding nothing but empty frames cannot
// tell those apart, so this check puts a real charging shot inside it. The drone is
// posed at `OVERLOAD_AT - 2`, and TWO mismatched bullets are placed below it at
// staggered gaps so the game resolves them in turn: the first carries it to
// `OVERLOAD_AT - 1` and must sound nothing, the second overloads it and must sound
// once. A build that plays the cue on every wrong-band shot fails on the first.
//
// UNDER THIS ENGINE THE NAME IS OBSERVABLE. The game asks the engine's cue bus for a
// cue by name and the bus announces the play, so what is asserted is `CUES.overload`
// itself, sounding exactly once on the overload's own frame, at an audible gain, and
// not at all over the frames before it. The "not before" reading names that cue alone
// rather than asking for silence, because specs/ui.md allows a frame to raise more than
// one cue — and the charging shot inside the window is entitled to raise its own.
//
// THE EVENT IS THE OVERLOAD ITSELF, read as the charge returning to 0, which
// specs/mode.md says an overload does in the frame it happens. The drone is posed at
// `OVERLOAD_AT - 2` rather than 0, so the reading cannot mistake the charge it started
// at for the charge an overload left. A build that charges on and never overloads never
// reaches the event and fails on that, which is the honest verdict: there was no
// overload for a cue to play on.
//
// THE DRONE IS A PROP with every faculty off, so it holds the place both bullets were
// aimed at and neither shot is spoiled by a drone that moved. NOTHING IS DESTROYED, so
// no stage clears and no `stage-clear` cue can land on the frame this check reads.

import { afterEach, beforeEach, it } from "vitest";
import {
  CUES,
  FORM_CENTER_X,
  OVERLOAD_AT,
  PLAYER_BULLET_SPEED,
} from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  findDrone,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import {
  cuesBeforeEvent,
  cuesOnEvent,
  gainOnEvent,
  poseShotBelow,
  quietFrames,
  watchForEvent,
} from "../audio/cues";
import { chargeById, mismatchBand } from "./charge";

/**
 * Where the target Shard stands.
 *
 * High in the play field on the formation's own centre line, so both bullets are
 * placed inside `[FIELD_TOP, FIELD_BOTTOM]` (64 to 656) and the whole sequence plays
 * out on screen.
 */
const TARGET = { x: FORM_CENTER_X, y: 200 } as const;

/**
 * How far below the drone the FIRST bullet starts, in logical units.
 *
 * Far enough that the climb is a real window of quiet — at `PLAYER_BULLET_SPEED` (760)
 * it is better than a quarter of a second — and ten times the 20-unit contact reach a
 * Shard has against one of the player's bullets (`SHARD_HALF` 14 +
 * `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 200;

/**
 * How much further below the drone the SECOND bullet starts, in logical units.
 *
 * Geometry, not a tolerance: both bullets climb at the same `PLAYER_BULLET_SPEED`, so
 * the gap between them is the gap between their arrivals — 200 units is better than a
 * quarter of a second, which at the harness's 120 Hz is some thirty frames between the
 * charge and the overload. Ample for each to be resolved on a frame of its own, and
 * short enough to keep the second bullet inside the play field.
 */
const SHOT_STAGGER = 200;

/**
 * Frames the two climbs are given.
 *
 * The time for the FURTHER bullet to climb the whole gap at `PLAYER_BULLET_SPEED` —
 * geometry, not a tolerance — plus two frames for the frame the bullets are placed on.
 * Contact lands sooner, since the drone's and the bullet's half-extents meet before
 * their centres do.
 */
const CLIMB_FRAMES =
  ticksFor((SHOT_BELOW + SHOT_STAGGER) / PLAYER_BULLET_SPEED) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.overload on the frame a drone overloads, and not on the wrong-band shot before it", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
    charge: OVERLOAD_AT - 2,
  });
  const target = droneOf(h.snapshot(), id);
  const band = mismatchBand(target);
  // Two mismatched shots, stacked: the first charges, the second overloads.
  poseShotBelow(h, target.x, target.y, band, SHOT_BELOW);
  poseShotBelow(h, target.x, target.y, band, SHOT_BELOW + SHOT_STAGGER);

  const watch = await watchForEvent(
    h,
    (snapshot) => findDrone(snapshot, id)?.charge === 0,
    CLIMB_FRAMES,
  );
  captureStill(h, "overload");

  assertEqual(
    watch.hit,
    true,
    `the two ${band} shots placed ${String(SHOT_BELOW)} and ` +
      `${String(SHOT_BELOW + SHOT_STAGGER)} units below a drone at charge ` +
      `${String(OVERLOAD_AT - 2)} overloaded it inside the ` +
      `${String(CLIMB_FRAMES)} frames their climb takes (specs/mode.md)`,
  );
  assertEqual(
    chargeById(watch.snapshot, id, "the drone that has just overloaded"),
    0,
    "the charge that says the frame this check read really was the overload's " +
      "(specs/mode.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.overload),
    0,
    `times CUES.overload played over the ${String(quietFrames(watch))} frames ` +
      "before the overload — frames that hold the wrong-band shot that merely " +
      "CHARGED the drone, which runs no reaction and sounds no overload " +
      "(specs/mode.md)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.overload),
    1,
    "times CUES.overload played on the frame the drone overloaded, which is its " +
      "own frame and at most once on it (specs/mode.md, specs/ui.md)",
  );
  assertGreaterThan(
    gainOnEvent(watch, CUES.overload),
    0,
    "the gain the bus announced the overload cue at, nothing here having muted " +
      "it — it is a distinct short sound a player hears (specs/mode.md)",
  );
});
