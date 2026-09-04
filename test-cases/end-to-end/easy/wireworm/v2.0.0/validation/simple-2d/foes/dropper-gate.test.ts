// foes/dropper-gate — no dropper appears below the level droppers begin at.
//
// specs/foes.md: "Droppers begin at DROPPER_FROM_LEVEL (3), and none appears at
// levels 1 and 2."
//
// Both levels below the gate are watched, because they are the same edge
// exercised the same way: the sparse field that WOULD draw a dropper in at level
// 3 is posed at each of them, so what is being read is the level gate and not
// the sparse-field trigger. That trigger is foes/dropper-sparse-trigger's
// requirement, and the field posed here is the same seven nodes it uses, one
// below DROPPER_SPARSE_THRESHOLD.
//
// The requirement IS the level's own spawning, so this is one of the few checks
// that turns `setFoeSpawning` back on. At level 2 the glitch spawner runs
// alongside it — that is what `foeSpawning` gates — so the reading counts
// droppers alone. The harness is reset between the two levels, since
// `startPlaying` is written for a board in its opening state.

import { afterEach, beforeEach, it } from "vitest";
import {
  DROPPER_CHECK_INTERVAL,
  DROPPER_FROM_LEVEL,
  DROPPER_SPARSE_THRESHOLD,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { watchRoster } from "./harness";

/** Every level below the gate: 1 and 2. */
const LEVELS = Array.from(
  { length: DROPPER_FROM_LEVEL - 1 },
  (_, index) => index + 1,
);

/** The row the posed field stands on: inside the counted rows 10 to 19. */
const FIELD_ROW = 12;

/** One node short of the threshold, spread across the counted row. */
const FIELD_COLUMNS = Array.from(
  { length: DROPPER_SPARSE_THRESHOLD - 1 },
  (_, index) => 2 + index * 4,
);

/** The charge each posed node stands at: inert, so none of them is critical. */
const FIELD_CHARGE = 0;

/** The stretch watched at each level, as the review item states it. */
const WATCH_SECONDS = 10;

/** How often the roster is read: a twentieth of a second. */
const POLL_FRAMES = ticksFor(0.05);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every dropper off the board below the level they begin at", async () => {
  for (const level of LEVELS) {
    h.debug.reset();
    startPlaying(h);
    h.debug.setLevel(level);
    for (const c of FIELD_COLUMNS) h.debug.setNode(c, FIELD_ROW, FIELD_CHARGE);
    h.debug.setFoeSpawning(true);

    const watch = await watchRoster(
      h,
      "dropper",
      ticksFor(WATCH_SECONDS),
      POLL_FRAMES,
    );
    captureStill(h, "gated");

    assertEqual(
      watch.peak,
      0,
      `no dropper enters over ${WATCH_SECONDS} s of level-${level} play — ` +
        `four DROPPER_CHECK_INTERVALs (${DROPPER_CHECK_INTERVAL} s) — with ` +
        `${FIELD_COLUMNS.length} nodes standing in rows 10 to 19, below ` +
        `DROPPER_SPARSE_THRESHOLD (${DROPPER_SPARSE_THRESHOLD}); droppers ` +
        `seen at once`,
    );
  }
});
