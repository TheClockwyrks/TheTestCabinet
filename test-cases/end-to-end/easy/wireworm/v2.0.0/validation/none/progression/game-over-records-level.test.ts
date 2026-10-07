// progression/game-over-records-level — the ended run reports the level it
// reached.
//
// `specs/progression.md`, Losing a life: the contact that takes lives to `0`
// moves to the `gameover` screen "reporting `0` lives and the level the run
// reached", and Clearing a level defines that figure: "The level reached is the
// highest level the run has opened, and it is what the end screens report."
// `specs/ui.md` puts it on the screen: `gameover` shows "The final score and the
// level the run reached".
//
// So a run is posed as one that has climbed to level `7` — standing on level `7`
// with `7` as the level it reached, which is what a run that opened seven levels
// carries — and it is ended by a contact on its last life. The reading is the
// figure the ended run reports. A build that carries it through answers `7`; one
// that clears it as the run ends answers `0` or `1`; one that reports the level
// reached as a fresh run's answers `1`.
//
// THAT the contact ends the run is `progression/game-over-at-zero-lives`, and
// WHERE on the screen the figure is drawn is `screens/gameover-screen`; this
// point reads the figure the ended run holds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { contactCursor } from "./run";

/** The level the posed run climbed to, and the level it must report reaching. */
const REACHED = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reports level 7 as the level a run that ended there reached", async () => {
  await startPlaying(h, { level: REACHED });
  await h.debug.setReachedLevel(REACHED);
  await h.debug.setLives(1);

  await contactCursor(h);

  await captureStill(h, "gameover");
  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "gameover",
    "precondition: the contact ended the run (specs/progression.md)",
  );
  assertEqual(
    after.reachedLevel,
    REACHED,
    "the level reached the ended run reports",
  );
});
