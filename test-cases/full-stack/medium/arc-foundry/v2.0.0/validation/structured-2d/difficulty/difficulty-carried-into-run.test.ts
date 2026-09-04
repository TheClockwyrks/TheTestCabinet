// difficulty/difficulty-carried-into-run — the difficulty chosen at the menu is
// the one the run plays at.
//
// THE REQUIREMENT. `specs/ui.md` has the difficulty select's choice "begin the
// run on the chosen map at that difficulty", and `specs/difficulty.md` says what
// a difficulty is: a wave count and four health-scaling constants. So a build
// that draws three choices and opens the same run whichever is taken has drawn a
// menu rather than implemented a difficulty, and the way to tell them apart is to
// take each choice and read the run that opened.
//
// HOW IT IS DECIDED. Each of the three choices is taken from the difficulty
// select, at its own reported rectangle, and the run that opens is read three
// ways: the difficulty it reports, the wave count it carries, and the maximum
// health a released unit is given, which is the one place the four constants
// actually bite. All three are read against the chosen difficulty rather than
// against whatever was chosen last.
//
// WHY THE MENU IS PRESSED HERE. Every other check in this project reaches its
// scenario through the surface and never through a menu, because a broken menu
// should fail the menu's own points. This point IS the crossing from the menu
// into the run, so the menu is the surface it has to be decided on. What is
// pressed is the rectangle the build itself reports for that choice
// (`specs/instrumentation.md`), so no layout is assumed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  DIFFICULTIES,
  type Difficulty as DifficultyDef,
  type DifficultyId,
  type MenuAction,
} from "../../src/constants";
import {
  captureStill,
  createHarness,
  loadDef,
  openMenu,
  pressMenu,
  releaseUnit,
  scaledHp,
  unitById,
  type Harness,
} from "../harness";

/**
 * The choice each difficulty is reported under.
 *
 * `MENU_ACTIONS` names the difficulty select's three choices `difficulty-easy`,
 * `difficulty-medium` and `difficulty-hard`, so a choice is found by the action it
 * carries rather than by where the build drew it.
 */
function choiceFor(difficulty: DifficultyId): MenuAction {
  return `difficulty-${difficulty}`;
}

/** The wave the released unit is scaled to, well past the opening ramp. */
const WAVE = 15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it.each(DIFFICULTIES.map((d) => ({ difficulty: d })))(
  "opens a run at $difficulty.id when $difficulty.id is taken from the menu",
  async ({ difficulty }: { difficulty: DifficultyDef }) => {
    h.debug.reset();
    openMenu(h, "difficultyselect");
    await pressMenu(h, choiceFor(difficulty.id));
    captureStill(h, "chosen");

    const run = h.snapshot();
    assertEqual(
      run.screen,
      "playing",
      `taking ${difficulty.id} from the difficulty select to begin the run ` +
        "(specs/ui.md)",
    );
    assertEqual(
      run.difficulty,
      difficulty.id,
      "the difficulty the run reports after that choice (specs/ui.md)",
    );
    assertEqual(
      run.totalWaves,
      difficulty.waves,
      `the wave count of a run begun at ${difficulty.id} (specs/difficulty.md)`,
    );

    // And the constants are really in force: a unit released at a fixed wave
    // carries the maximum health this difficulty's four constants give it.
    h.debug.clearStructures();
    h.debug.setWave(WAVE);
    const id = releaseUnit(h, "mote", { frozen: true });
    assertEqual(
      unitById(h.snapshot(), id).maxHp,
      scaledHp(loadDef("mote").baseHealth, WAVE, difficulty),
      `a Mote's maximum health on wave ${WAVE} in a run begun at ` +
        `${difficulty.id} (specs/enemies.md, specs/difficulty.md)`,
    );
  },
);
