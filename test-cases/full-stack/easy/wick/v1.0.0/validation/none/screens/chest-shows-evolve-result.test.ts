// screens/chest-shows-evolve-result — the chest overlay shows an evolution as
// the evolved weapon's icon and name.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`chest`"), the result table:
// "`evolve` | The evolved weapon's icon and its name from `WEAPON_NAMES`."
// specs/evolutions.md ("Opening a chest"), rule 1, is what makes the result an
// evolution: "the first base weapon at `MAX_WEAPON_LEVEL` whose recipe passive
// is held at any level evolves ... The result is `{ kind: "evolve", weapon }`",
// over the recipe "Pyre | `pyre` | Taper | Wick". What a produced icon is comes
// from specs/assets.md: an icon canvas of `ICON_SIZE` (`24 x 24`) per offerable
// id, drawn from that source at whatever size the build scales it to.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night holding exactly the recipe
// — Taper at `MAX_WEAPON_LEVEL` and Wick — and nothing else, so the chest has
// one thing it can do and the frame has one item on it. The chest is reached
// the real way, through a pickup at the lamplighter's center and the tick that
// collects it, and the result is read off `chestResult` rather than assumed, so
// a build that evolved something else fails against its own report. The
// weapon's name is read from `WEAPON_NAMES` for the id the result names.
//
// THE TOLERANCE. The name is matched ignoring case and whitespace, across the
// runs of text the frame drew (the shared harness's `drewTextAnywhere`), its
// row is the one the shortest span of consecutive draws spelling it landed on,
// and the icon counts as the
// result's when it is drawn from a `24 x 24` source within `ROW_BAND` (`110`
// units) of the row the name was drawn on, the case's allowance for a layout
// specs/ui.md does not fix and one that keeps the HUD's own slots, which stand
// at the stage's edge, out of the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { WEAPON_NAMES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertShows,
  chestResultOf,
  iconDraws,
  iconOnRow,
  mustRowY,
  night,
  openEvolveChest,
  shown,
  TAPER_EVOLUTION,
} from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the evolved weapon's name and an icon on its row", async () => {
  await night(h);
  const opened = await openEvolveChest(h);
  const result = chestResultOf(
    opened,
    "the chest that paid the Taper recipe off",
  );
  assertEqual(result.kind, "evolve", "the result's kind");
  if (result.kind !== "evolve") return;
  assertEqual(result.weapon, TAPER_EVOLUTION, "the weapon Taper evolved into");

  const page = await shown(h);
  await captureStill(h, "evolve");

  const name = WEAPON_NAMES[result.weapon];
  assertShows(page, name, "the chest overlay's evolve result");
  const row = mustRowY(page, name, "the evolved weapon's name");
  assertNotNull(
    iconOnRow(iconDraws(page.calls), row) ?? null,
    `an icon-sized image drawn on the row of ${name}`,
  );
});
