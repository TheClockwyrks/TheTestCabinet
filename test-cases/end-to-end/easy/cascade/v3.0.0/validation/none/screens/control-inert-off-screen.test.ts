// screens/control-inert-off-screen — a control answers nothing on a screen it
// does not belong to.
//
// THE RULE. `specs/controls.md`, The controls: "A control answers only on the
// screen it belongs to", above a table that gives each of the four screens its
// own list of controls — and gives the `title` screen the two items of
// `TITLE_ITEMS` and nothing of the HUD's.
//
// WHY IT IS AN EDGE CASE WORTH GRADING. It is what the general rule implies at a
// boundary rather than a rule of its own, and the way to get it wrong is
// ordinary: a build that hit-tests every control it knows about, whatever screen
// is up, answers a press over dead space on the title as though the game were in
// play. A player who pressed there would be dealt a game they did not ask for.
//
// THE POINT PRESSED IS THE ONE THE HUD'S `NEW GAME` OCCUPIES DURING PLAY, read
// back from the build itself while play is up (`specs/instrumentation.md`), so
// this point follows the build's own layout wherever it put its HUD.
//
// AND IT IS CHOSEN CLEAR OF THE TITLE'S OWN ITEMS. `specs/controls.md` keeps the
// regions of ONE screen from overlapping each other and says nothing across
// screens, so a build is free to draw a title item over the strip the HUD uses.
// The press is therefore made at whichever point of the HUD item's region lies
// outside every region the title reports — the two lists are different screens'
// and almost never cover each other — and the check says so plainly when a build
// leaves no such point.
//
// BOTH HALVES ARE READ, because the press has two ways to be answered: the screen
// must still be `title`, and the table must still be empty. A build whose HUD
// `NEW GAME` answered here would deal fifty-two cards and stay, and one whose
// title `NEW GAME` answered would deal and leave.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { HUD_NEW_GAME_ITEM, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  everyCard,
  gridPoints,
  menuRect,
  openTable,
  openTitle,
  pointInRect,
  type Harness,
  type MenuRect,
  type Point,
} from "../harness";

/** How finely the HUD item's region is searched for a point clear of the title. */
const SEARCH_COLS = 5;
const SEARCH_ROWS = 3;

/** One frame, so the canvas carries the screen the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals nothing when the HUD's NEW GAME point is pressed on the title", async () => {
  // Where the HUD's NEW GAME sits, read off the build while play is up.
  await openTable(h);
  const hud = await menuRect(h, HUD_NEW_GAME_ITEM);

  // And the title, whose own regions the press must stay clear of.
  await openTitle(h);
  const titleRegions: MenuRect[] = [];
  for (let index = 0; index < TITLE_ITEMS.length; index += 1) {
    titleRegions.push(await menuRect(h, index));
  }

  const clear = gridPoints(hud, SEARCH_COLS, SEARCH_ROWS).find((point: Point) =>
    titleRegions.every((rect) => !pointInRect(point.x, point.y, rect)),
  );
  if (clear === undefined) {
    fail(
      "some point of the region the build reports for the HUD's NEW GAME item " +
        "to lie outside every region it reports for the title's own items, so " +
        "a press there can only be answered by a control that does not belong " +
        "to the title (specs/controls.md)",
      `the title's items cover the whole of the HUD item's region ` +
        `{ x: ${hud.x}, y: ${hud.y}, w: ${hud.w}, h: ${hud.h} }`,
    );
  }

  await clickAt(h, clear.x, clear.y);
  await h.advance(SETTLE_FRAMES);
  const after = await h.snapshot();

  // Before the assertions, so a press that dealt still leaves the picture of the
  // table it dealt onto.
  await captureStill(h, "title");

  assertEqual(
    after.screen,
    "title",
    `the screen a press and release at (${clear.x.toFixed(0)}, ` +
      `${clear.y.toFixed(0)}), inside the region the HUD's NEW GAME occupies ` +
      `during play, left the game on — a control answers only on the screen it ` +
      `belongs to (specs/controls.md)`,
  );
  assertLength(
    everyCard(after),
    0,
    "the cards on the table after that press, which was made on a title " +
      "screen posed with none — a HUD control answering off its own screen " +
      "deals a game nobody asked for (specs/controls.md, specs/screens.md)",
  );
});
