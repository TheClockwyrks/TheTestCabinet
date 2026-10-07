// Wick — instrumentation/overlay-sources: the debug overlay, once shown,
// reports the registered diagnostics, each with the live value the snapshot
// reports.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Diagnostics"):
// "Register at least the current `screen`, the run clock, the level with `xp`
// over `xpToNext`, `hp` over `maxHp`, the kill count, the lamplighter's
// position and facing, the enemy count with the spawn window index, the
// projectile and zone counts, the gem count, the held weapons with their
// levels and cooldowns, the held passives with their levels,
// `pendingLevelUps`, and the nine driver switches, the same facts the
// snapshot reports." The overlay's medium is the build's, so what it shows is
// read as text: the runs the toggled frame drew beyond the untoggled one, and
// any text the document gained. The specification fixes the facts and not their
// wording, so a fact it names as a WORD is looked for folded for case, spacing,
// and dashes, and a fact it names as a NUMBER as a figure some line of that
// text carries — the figures of a line rather than its characters, so the `7`
// of a level is not answered by the `7` inside a `77` of health.
//
// THE CLOCK IS THE ONE FACT WITH A UNIT OF ITS OWN. `specs/state.md` fixes the
// run clock as `tick / TICK_HZ` seconds, and the `m:ss` of `specs/ui.md` is
// what the HUD draws, not what this panel must: `5:30`, `330`, `330.0s` and the
// tick count `19800` are one clock written four ways. It is therefore looked for
// as any of them, a written second within half of the clock's, which is what
// rounding to a whole second moves it by. That half second is wide enough for
// an unrelated figure to fall inside, so the clock is read TWICE, at two posed
// ticks far apart — `setTick` "Sets `tick` to `tick`" and the clock follows it
// — and the SAME reading has to answer both: a reading is known across the two
// reads by its line with every figure struck out, so `5:30 (tick 19800)` and
// `3:45 (tick 13500)` are one reading, while a figure that merely fell within
// half a second of the first clock is never asked for the second.
//
// THE NINE SWITCHES ARE READ AS A DEPENDENCE. The specification names each
// switch as a fact "the snapshot reports" and fixes no spelling for a reading
// of one: a build may draw the boolean itself as `true`, or a word of its own —
// `on`, `enabled`, `yes`, a `1`, a tick — and no list of the words is complete,
// so a list would fail a build that spelled an honest reading some other way.
// Its LABEL is no more fixed than its value: `specs/instrumentation.md` asks
// only that each source be registered and "short enough to read on a line", so
// a line reading `spawn on events on` names the same two switches a line
// reading `spawning: on` does. What CAN be decided is that each switch reaches
// the overlay: the overlay is read before and after the switch is flipped
// through its own debug operation, and one reading must change that did not
// change between two reads with nothing flipped, which is what a reading that
// moves on its own — a frame time, a frame count — would otherwise answer with.
// A reading is known by its line with every figure struck out, so a reading
// whose figure merely drifts is not counted as a new one. Each switch is put
// back as it was, so the nine readings are taken over the one posed run.
//
// WHY THE WORLD IS POSED AS IT IS. Every fact is posed to a value that is not
// the fresh run's, so a readout of defaults fails; the run is then paused so
// the frame the toggle runs ticks nothing and the values on show are the ones
// posed. A figure is looked for across the whole overlay, so every figure the
// point asks for is posed to a value no other number of the posed run carries —
// the clock's own spellings, the loadout's levels and the counts of the field
// included — or one line would answer for a fact the overlay left out. The
// counts themselves are posed clear of every figure the point asks for rather
// than asked for here, which is where this variant reads less than the
// `simple-2d` and `structured-2d` ones, whose panels are read line by line.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { clockText, SWITCH_NAMES, TICK_HZ } from "../constants";
import {
  addedText,
  captureStill,
  createHarness,
  folded,
  holdPassive,
  holdWeapon,
  isolate,
  placeEnemy,
  placeGem,
  placeProjectile,
  placePuddle,
  poseScreen,
  pressOverlayToggle,
  readout,
  setSwitch,
  switchesOf,
  type Harness,
} from "../harness";

const POSED = {
  tick: 19800,
  level: 7,
  xp: 12,
  hp: 77,
  kills: 250,
  x: 300,
  y: -120,
  weaponLevel: 3,
  cooldown: 0.7,
  passiveLevel: 2,
  pending: 9,
};

/**
 * The second tick the clock is read at, a minute and three quarters before the
 * first, and inside the `0 … 35999` `setTick` takes.
 */
const TICK_B = 13500;

/**
 * How far a second written on the overlay may sit from the clock's and still be
 * it: half a second, which is what rounding or truncating a figure to a whole
 * number of seconds moves it by.
 */
const CLOCK_TOLERANCE = 0.5;

/** Every number one line carries, a grouped figure read as the figure it is. */
function numbersIn(line: string): number[] {
  return (
    line.match(
      /-?\d{1,3}(?:[,'\u00A0\u202F\u2009]\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g,
    ) ?? []
  ).map((written) => Number(written.replace(/[,'\u00A0\u202F\u2009]/g, "")));
}

/** Whether some line of the overlay carries `figure` as a figure of its own. */
function showsFigure(lines: readonly string[], figure: number): boolean {
  return lines.some((line) =>
    numbersIn(line).some((written) => written === figure),
  );
}

/**
 * One line with every figure it carries struck out: what a reading is known by
 * across two reads, whether the two are at two clocks or either side of a
 * switch flip.
 */
function shapeOf(line: string): string {
  return line.replace(
    /-?\d{1,3}(?:[,'\u00A0\u202F\u2009]\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g,
    "#",
  );
}

/**
 * The shapes of the lines that show the run clock at `tick`: as `m:ss`, as the
 * seconds `tick / TICK_HZ` however they are written, or as the tick count.
 */
function clockShapes(lines: readonly string[], tick: number): Set<string> {
  const seconds = tick / TICK_HZ;
  const shapes = new Set<string>();
  for (const line of lines) {
    const shows =
      folded(line).includes(folded(clockText(tick))) ||
      numbersIn(line).some(
        (figure) =>
          figure === tick || Math.abs(figure - seconds) <= CLOCK_TOLERANCE,
      );
    if (shows) shapes.add(shapeOf(line));
  }
  return shapes;
}

/** The lines of `a` that `b` does not have, counting repeats. */
function minusLines(a: readonly string[], b: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of b) counts.set(line, (counts.get(line) ?? 0) + 1);
  const extra: string[] = [];
  for (const line of a) {
    const held = counts.get(line) ?? 0;
    if (held > 0) counts.set(line, held - 1);
    else extra.push(line);
  }
  return extra;
}

/** The shapes two reads of the overlay disagree on, either way round. */
function changedShapes(
  a: readonly string[],
  b: readonly string[],
): Set<string> {
  const shapesA = a.map(shapeOf);
  const shapesB = b.map(shapeOf);
  return new Set([
    ...minusLines(shapesA, shapesB),
    ...minusLines(shapesB, shapesA),
  ]);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the registered diagnostics with their live values", async () => {
  await isolate(h);
  await h.debug.setTick(POSED.tick);
  await h.debug.setLevel(POSED.level);
  await h.debug.setXp(POSED.xp);
  await h.debug.setHp(POSED.hp);
  await h.debug.setKills(POSED.kills);
  await h.debug.setPlayerPosition(POSED.x, POSED.y);
  await h.debug.setFacing("left");
  // The field is posed clear of every figure the point asks for: six enemies,
  // eight projectiles, four zones and five gems are numbers no fact of the
  // reading carries, so none of them can answer for one.
  for (let i = 0; i < 6; i += 1)
    await placeEnemy(h, "moth", 200, -250 + 100 * i);
  for (let i = 0; i < 8; i += 1)
    await placeProjectile(h, "ember", 100, -140 + 40 * i, 400, 0, 0);
  for (let i = 0; i < 4; i += 1)
    await placePuddle(h, "oil-splash", -400 + 200 * i, 50);
  for (let i = 0; i < 5; i += 1) await placeGem(h, "small", 300 + 20 * i, 300);
  const slot = await holdWeapon(h, "ember", POSED.weaponLevel);
  await h.debug.setWeaponCooldown(slot, POSED.cooldown);
  await holdPassive(h, "bellows", POSED.passiveLevel);
  await h.debug.setPendingLevelUps(POSED.pending);
  await h.debug.setDespawning(false);
  const paused = await poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the overlay is read on");

  await h.step(1);
  const before = await readout(h);
  await pressOverlayToggle(h);
  const shown = await readout(h);
  await captureStill(h, "sources");
  const lines = addedText(before, shown);
  const text = folded(lines.join("\n"));

  const clockAt = clockShapes(lines, POSED.tick);
  assertTrue(
    clockAt.size > 0,
    `the overlay showing the run clock (${clockText(POSED.tick)}, ${String(
      POSED.tick / TICK_HZ,
    )}s, or tick ${String(POSED.tick)})`,
  );
  // The clock again, at a tick far from the first, and on the SAME reading: a
  // figure that merely sat within half a second of the first clock does not
  // follow the clock to the second tick. The overlay is shown, so it is hidden
  // for a fresh baseline and shown again.
  await h.debug.setTick(TICK_B);
  await pressOverlayToggle(h);
  const hiddenAgain = await readout(h);
  await pressOverlayToggle(h);
  const shownAgain = await readout(h);
  assertTrue(
    [...clockShapes(addedText(hiddenAgain, shownAgain), TICK_B)].some((shape) =>
      clockAt.has(shape),
    ),
    `the reading that showed the run clock at ${clockText(
      POSED.tick,
    )} showing it at ${clockText(TICK_B)} (${String(
      TICK_B / TICK_HZ,
    )}s, or tick ${String(TICK_B)}) too, with the clock posed there`,
  );
  await h.debug.setTick(POSED.tick);

  const words: [string, string][] = [
    ["the screen", "paused"],
    ["facing", "left"],
    ["the held weapon", "ember"],
    ["the held passive", "bellows"],
  ];
  for (const [what, value] of words) {
    assertTrue(
      text.includes(folded(value)),
      `the overlay showing ${what} as ${JSON.stringify(value)}`,
    );
  }
  const figures: [string, number][] = [
    ["the level", POSED.level],
    ["xp", POSED.xp],
    ["xpToNext", paused.run.xpToNext],
    ["hp", POSED.hp],
    ["maxHp", paused.run.maxHp],
    ["the kill count", POSED.kills],
    ["the lamplighter's x", POSED.x],
    ["the lamplighter's y", POSED.y],
    ["the spawn window", paused.run.spawnWindow],
    ["the held weapon's level", POSED.weaponLevel],
    ["the held weapon's cooldown", POSED.cooldown],
    ["the held passive's level", POSED.passiveLevel],
    ["pendingLevelUps", POSED.pending],
  ];
  for (const [what, figure] of figures) {
    assertTrue(
      showsFigure(lines, figure),
      `the overlay showing ${what} as ${String(figure)}`,
    );
  }

  // The nine switches, each as a dependence. The overlay stays shown, and what
  // it contributes is read against the hidden frame `before` held: the game's
  // own text is drawn alike either way and cancels out. The control pair comes
  // first — two reads with nothing flipped — and whatever differs between them
  // is what the overlay moves on its own, which no switch's reading may rest
  // on.
  const overlayNow = async (): Promise<string[]> => {
    await h.step(1);
    return addedText(before, await readout(h));
  };
  const restless = changedShapes(await overlayNow(), await overlayNow());
  const posed = switchesOf(paused);
  for (const name of SWITCH_NAMES) {
    const held = await overlayNow();
    await setSwitch(h, name, !posed[name]);
    const flipped = await overlayNow();
    await setSwitch(h, name, posed[name]);
    assertTrue(
      [...changedShapes(held, flipped)].some((shape) => !restless.has(shape)),
      `a reading that changes when the ${name} switch is flipped from ` +
        `${String(posed[name])} through its own operation and holds still ` +
        `with nothing flipped (${String(restless.size)} reading(s) moved on ` +
        `their own), so the overlay reports it (specs/instrumentation.md, ` +
        `Diagnostics: the nine driver switches)`,
    );
  }
});
