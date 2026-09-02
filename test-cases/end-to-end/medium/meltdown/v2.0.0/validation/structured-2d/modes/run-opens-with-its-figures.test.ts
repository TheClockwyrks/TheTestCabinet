// Meltdown — modes/run-opens-with-its-figures: a run started from a menu opens
// in the opening phase, on wave 1, holding its own figures.
//
// THE RULE. `specs/modes.md`, The derived figures: "A run that has just started
// is in the `opening` phase on Wave 1, with its money at that row's starting
// money and its lives at that row's starting lives." `specs/screens.md` says
// where a run is started from: confirming a row of `difficultyselect` "opens
// `playing` in the `opening` phase, on Containment at that difficulty".
//
// THE RUN IS STARTED, NOT POSED. `specs/instrumentation.md` is explicit that
// `setScreen` and `setPhase` "set that field alone and run no entry effect" and
// that neither "rebuilds" a run, so a posed `playing` screen would prove nothing
// about what a STARTED run opens holding: the whole of this item is the entry
// effect. So the run is reached the way a player reaches it, through one real
// `confirm` on a real menu.
//
// ONE CONFIRM, FROM THE DIFFICULTY SCREEN. The screen and the highlighted row are
// posed outright and the single transition under test is driven for real. That is
// deliberate: which row of the title menu opens mode select, and which row of
// mode select opens the difficulty list, are `screens.title-to-mode-select` and
// `screens.containment-opens-difficulty-select`, and walking the whole chain here
// would make this item fail for their reasons as well as its own. `setMenuIndex`
// "sets the highlighted row of whatever menu the current screen shows"
// (`specs/instrumentation.md`), so a build whose arrow keys are broken still gets
// a fair reading.
//
// HARD IS THE ROW CONFIRMED, AND THAT IS THE DISTINGUISHING CHOICE. `reset`
// leaves the game on Containment MEDIUM (`specs/instrumentation.md`), whose
// starting money is `250`; Hard's is `200`. A build that opens every run on the
// figures of the difficulty it reset to, rather than the one just confirmed,
// therefore reads a different number from a build that reads the row. A build
// that opens on a hard-coded purse reads that purse. A build that carries the
// money the title screen was holding reads `250` again.
//
// MONEY IS READ AGAINST `startMoney` AND LIVES AGAINST `startLives`, rather than
// against `200` and `20`. Those two figures are `modes.containment-hard`'s
// business; what this point decides is that the run OPENS on whatever its own row
// derives, so a build with a wrong table and a right opening fails there and
// passes here, and the two grades stay separable. Both are whole numbers with no
// tolerance: `specs/modes.md` fixes them exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DIFFICULTIES, DIFFICULTY_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed on the difficulty menu: `HARD`, the third of three. */
const ROW = DIFFICULTY_ITEMS.indexOf("HARD");

/** The difficulty that row chooses, in the order `specs/modes.md` lists them. */
const DIFFICULTY = DIFFICULTIES[ROW];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the confirmed run in its opening phase on wave 1 with its own money and lives", async () => {
  resetTo(h);
  h.debug.setScreen("difficultyselect");
  h.debug.setMenuIndex(ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "difficultyselect",
    "precondition: the menu the run is started from",
  );
  assertEqual(
    before.menuIndex,
    ROW,
    "precondition: the row the run is started from",
  );

  await tapAction(h, "confirm");
  captureStill(h, "opening");

  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "playing",
    `the screen confirming row ${ROW} of the difficulty menu opens`,
  );
  assertEqual(
    opened.difficulty,
    DIFFICULTY,
    `the difficulty row ${ROW} of the difficulty menu chooses`,
  );
  assertEqual(opened.phase, "opening", "the phase a started run opens in");
  assertEqual(opened.wave, 1, "the wave a started run opens on");
  assertEqual(
    opened.money,
    opened.startMoney,
    "the money a started run opens holding, against its own starting money",
  );
  assertEqual(
    opened.lives,
    opened.startLives,
    "the lives a started run opens with, against its own starting lives",
  );
});
