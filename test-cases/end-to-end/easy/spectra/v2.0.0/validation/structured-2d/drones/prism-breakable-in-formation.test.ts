// drones/prism-breakable-in-formation — a Prism in its slot can be broken.
//
// specs/drones.md, Its two layers: "A Prism can be broken while it rests in the
// formation, not only while it dives." Without that rule a Prism would be
// untouchable until the assault chose to send it down, and the wave it anchors
// could not be cleared on the player's own initiative. So the rule is about the
// PHASE the drone is in, not about the band table — the band table is
// `drones/prism-shell-breaks-to-shell-band`, which fires the same band into a lone
// Prism standing on its own.
//
// WHAT MAKES THIS THE FORMATION SCENARIO. The Prism is posed in a real block: five
// drones on the slot grid specs/field.md fixes, laid out mirror-symmetric about
// `FORM_CENTER_X` as specs/swarm.md requires a formation to be, every one in phase
// `formation` with its TRAVEL ON so the block rides the sway rather than standing
// frozen. The Prism sits on the grid's bottom row, so the shot climbing from below
// reaches it before anything else, and its neighbours on that row are two columns —
// `2 * SLOT_DX` (`128`) — away, well outside the `20` units a Shard and one of the
// player's bullets need to touch, so nothing else on the field can take the shot.
//
// The block is given one frame before the shot is aimed, so the drones are at their
// slots PLUS the sway the build's own clock is at rather than at the bare slot they
// were placed on; the shot is then aimed at where the Prism actually stands. Over
// the flight the sway can carry the block at most `SWAY_AMP * 2π / SWAY_PERIOD` =
// `25.2` units per second, which is under `4` units in the sixth of a second the
// flight takes — an eighth of the `34`-unit reach, so the drift cannot decide the
// contact either way.
//
// Nothing is destroyed here: the shell comes off and the Prism stands, so no stage
// clear is in play.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYER_BULLET_SPEED } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAt,
  poseFormation,
  startPosed,
  ticksFor,
  type FormationEntry,
  type Harness,
} from "../harness";
import { requireDrone } from "./roster";

/** The Prism's stored band, which specs/instrumentation.md makes the SHELL's. */
const SHELL_BAND = "magenta" as const;

/** The grid row the Prism rests on: the bottom one, nearest the cannon. */
const PRISM_ROW = 4;

/** The grid column the Prism rests on: the centre one the block is mirrored about. */
const PRISM_COL = 4;

/**
 * The block the Prism rests in.
 *
 * Mirror-symmetric about `FORM_CENTER_X` — for the filled slot at column `c` the
 * slot at `8 - c` is filled too — which is the layout rule specs/swarm.md states,
 * and every drone travelling, so the block rides the sway as one body. The two
 * slots directly above the Prism are left empty so nothing stands between it and
 * the field below, and the columns beside it are two slots out on its own row.
 */
const BLOCK: readonly FormationEntry[] = [
  {
    kind: "prism",
    col: PRISM_COL,
    row: PRISM_ROW,
    band: SHELL_BAND,
    travel: true,
  },
  { kind: "shard", col: 2, row: PRISM_ROW, band: "cyan", travel: true },
  { kind: "shard", col: 6, row: PRISM_ROW, band: "cyan", travel: true },
  { kind: "shard", col: 3, row: PRISM_ROW - 1, band: "magenta", travel: true },
  { kind: "shard", col: 5, row: PRISM_ROW - 1, band: "magenta", travel: true },
];

/**
 * How far below the Prism the shot is placed, in logical units.
 *
 * Geometry, not a tolerance. The Prism's row sits at `slotY(4)` = `332`, so `120`
 * puts the bullet at y `452` — inside the play field, clear of the ship's lane at
 * `SHIP_Y` (`600`), and three and a half times the `34`-unit contact reach a
 * shelled Prism has against one of the player's bullets (`PRISM_HALF` `28` +
 * `PLAYER_BULLET_HALF` `6`). Short deliberately: the less time the flight takes,
 * the less the sway can carry the block while the bullet is in the air.
 */
const SHOT_BELOW = 120;

/**
 * Frames the shot is flown for.
 *
 * The climb of `SHOT_BELOW` at `PLAYER_BULLET_SPEED` (`760`, specs/ship.md), so the
 * bullet's centre reaches the Prism's and every frame of the approach runs through
 * the build's own collision code.
 */
const FLIGHT_TICKS = ticksFor(SHOT_BELOW / PLAYER_BULLET_SPEED);

/** Where the Prism's id sits in the ids `poseFormation` reports, in order. */
const PRISM_INDEX = 0;

/**
 * What a missing drone would mean here.
 *
 * Breaking a shell "leaves the Prism alive with its core exposed", so a roster that
 * no longer holds the id is the build that destroyed the whole Prism on one hit.
 */
const ALIVE =
  "the Prism left alive in its slot by the shot that broke its shell " +
  "(specs/drones.md)";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("breaks the shell of a Prism resting in the formation", async () => {
  // An empty, quiet, live wave at stage 1, then the block the requirement is
  // about. `setDiveLaunching` is off through `startPosed`, so nothing pulls the
  // Prism out of its slot mid-scenario.
  startPosed(h);
  const prism = poseFormation(h, BLOCK)[PRISM_INDEX];
  // One frame, so the block is at its slots plus the build's own sway offset
  // before the shot is aimed at where the Prism actually stands.
  await h.advance(1);

  const posed = requireDrone(h.snapshot(), prism, ALIVE);
  await fireAt(h, posed.x, posed.y, SHELL_BAND, SHOT_BELOW, FLIGHT_TICKS);
  captureStill(h, "broken");

  const after = requireDrone(h.snapshot(), prism, ALIVE);
  assertEqual(
    after.shellAlive,
    false,
    `the shell a ${SHELL_BAND} shot broke off a Prism resting in the formation ` +
      "(specs/drones.md)",
  );
  assertEqual(
    after.phase,
    "formation",
    "the phase the Prism rested in for the whole scenario (specs/swarm.md)",
  );
});
