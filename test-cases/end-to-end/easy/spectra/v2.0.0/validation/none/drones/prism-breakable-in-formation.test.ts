// drones/prism-breakable-in-formation — a Prism in its slot can be broken.
//
// specs/drones.md, Its two layers: "A Prism can be broken while it rests in the
// formation, not only while it dives." Without that rule a Prism would be
// untouchable until the assault chose to send it down, and the wave it anchors
// could not be cleared on the player's own initiative. So the rule is about the
// PHASE the drone is in, not about the band table — the band table is
// `drones/prism-shell-breaks-to-shell-band`, which fires the same band into a
// lone Prism standing on its own.
//
// WHAT MAKES THIS THE FORMATION SCENARIO. The Prism is posed in a real block:
// six drones on the slot grid specs/field.md fixes, laid out mirror-symmetric
// about `FORM_CENTER_X` as specs/swarm.md requires a formation to be, every one in
// phase `formation` with its TRAVEL ON so the block rides the sway rather than
// standing frozen. The Prism sits on the grid's bottom row, so the shot climbing
// from below reaches it before anything else, and its two neighbours on that row
// are a full `SLOT_DX` (64) away — well outside the 34 units a shelled Prism and
// one of the player's bullets need to touch — so nothing else on the field can
// take the shot.
//
// The block is given one frame before the shot is aimed, so the drones are at
// their slots PLUS the sway the build's own clock is at rather than at the bare
// slot they were placed on; `shootDrone` then reads the Prism where it actually
// stands. Over the flight the sway can carry the block at most
// `SWAY_AMP * 2π / SWAY_PERIOD` = 25.2 units per second, which is 6.3 units in the
// 0.25 s the sweep allows — a fifth of the 34-unit reach, so the drift cannot
// decide the contact either way.
//
// Nothing is destroyed here: the shell comes off and the Prism stands, so no
// bystander is needed and no stage-clear reading is in play.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseFormation,
  requireDrone,
  shootDrone,
  startPosed,
  type Harness,
  type FormationEntry,
} from "../harness";

/** The stage the scenario is posed at. */
const STAGE = 1;

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
 * The Prism's row sits at `slotY(4)` = 332, so 120 puts the bullet at y 452 —
 * inside the play field, clear of the ship's lane at `SHIP_Y` (600), and three and
 * a half times the 34-unit contact reach a shelled Prism has against one of the
 * player's bullets (`PRISM_HALF` 28 + `PLAYER_BULLET_HALF` 6) clear of the drone.
 * Short deliberately: the less time the flight takes, the less the sway can carry
 * the block while the bullet is in the air.
 */
const SHOT_BELOW = 120;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the reach 86 units up, inside 12 frames, and 25 leaves
 * thirteen for whichever frame a build resolves the contact on while stopping the
 * sweep 70 units short of the row above.
 */
const SHOT_FRAMES = 25;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("breaks the shell of a Prism resting in the formation", async () => {
  await startPosed(harness, { stage: STAGE });
  const ids = await poseFormation(harness, BLOCK);
  const prism = ids[0] as number;
  // One frame, so the block is at its slots plus the build's own sway offset
  // before the shot is aimed at where the Prism actually stands.
  await harness.advance(1);

  const shot = await shootDrone(harness, prism, SHELL_BAND, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "broken");

  const after = requireDrone(
    shot.snapshot,
    prism,
    "the formation Prism left alive with its core exposed (specs/drones.md)",
  );
  assertEqual(
    after.shellAlive,
    false,
    `the shell a ${SHELL_BAND} shot broke off a Prism resting in the formation (specs/drones.md)`,
  );
  assertEqual(
    after.phase,
    "formation",
    "the phase the Prism rested in for the whole scenario (specs/swarm.md)",
  );
});
