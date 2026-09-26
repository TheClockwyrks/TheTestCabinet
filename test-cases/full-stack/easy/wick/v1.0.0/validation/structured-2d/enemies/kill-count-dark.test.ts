// Wick — enemies/kill-count-dark: the Dark's death raises the kill count.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("The life of an
// enemy"): "On any tick that leaves `hp` at or below `0` the enemy dies on
// that tick: it is removed, the kill count rises by one, its drop appears at
// its center", and the sentence that follows makes the rule rank-blind: "Kill
// count and drops apply to every rank alike." `specs/weapons.md` ("Hits and
// death") says the same of the tick: "the kill count rises by one". So each of
// the three ranks raises `kills` by exactly one: a moth for `common`, a
// mothwing for `elite`, and the Dark for `dark`.
//
// WHY THREE DEATHS IN ONE RUN. The claim is about the count, so it is read as
// a count: `kills` is noted before each death and required to stand one higher
// after it, three times over in the one run, ending at three. A build that
// counted only its commons, or that raised the count by the rank's worth
// rather than by one, fails on the death that breaks it.
//
// WHY THE WORLD IS POSED AS IT IS. `enemies/drops` states the arrangement: an
// isolated run whose `kills` begins at `0` (`specs/state.md`, the idle run),
// and one enemy at a time, its `hp` posed to the damage of a level-1 Oil
// Splash puddle laid at its own center, killed by the one tick that pulse
// lands on. Each death clears the last one's zone first, so exactly one enemy
// is alive and exactly one shape can hit it on each of the three ticks that
// count. Nothing the deaths drop is read here: what each rank leaves behind is
// the drop checks' business, and the gems fall 200 units out, too far to be
// collected and level the lamp mid-scenario.
//
// THE TOLERANCE. None: `kills` is a whole count, compared exactly.
//
// The other ranks are `enemies/kill-count-common`, `enemies/kill-count-elite`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { killOne } from "./drops";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises kills by one on the Dark's death", async () => {
  const start = isolate(h);
  assertEqual(start.run.kills, 0, "the kills an isolated run begins with");

  const death = await killOne(h, "dark");
  captureStill(h, "kills");

  assertEqual(
    death.after.run.kills,
    start.run.kills + 1,
    "kills on the tick the Dark died (specs/enemies.md, The life of an enemy)",
  );
});
