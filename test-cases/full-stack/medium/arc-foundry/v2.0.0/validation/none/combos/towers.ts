// combos — the readings the twelve towers' checks share.
//
// Not a suite: vitest collects `*.test.ts` alone, so nothing here runs on its
// own. These are pure functions over a snapshot and over the readings, held in
// one place because a dozen checks next door read the same three things and a
// second spelling of any of them would be a second definition of what the
// specification says.

import { assertTruthy } from "../assert";
import {
  structureAt,
  type FoundrySnapshot,
  type PanelButton,
  type StructureView,
} from "../harness";

/**
 * The structure anchored at that tile, or a failure naming the tile.
 *
 * A combine moves what stands where, so a check that folded three components
 * reads the result back by its ANCHOR rather than by an id that may not have
 * survived the fold.
 */
export function anchored(
  snapshot: FoundrySnapshot,
  col: number,
  row: number,
): StructureView {
  const found = structureAt(snapshot, col, row);
  assertTruthy(
    found,
    `snapshot().structures to carry a structure anchored at tile (${col}, ` +
      `${row}); the yard carries ${
        snapshot.structures.length === 0
          ? "none"
          : snapshot.structures
              .map((s) => `${String(s.kind)} at (${s.col}, ${s.row})`)
              .join(", ")
      }`,
  );
  return found as StructureView;
}

/**
 * The abilities a structure reports, as the bare ability names, sorted.
 *
 * `specs/combinations.md` names the seven abilities `splash`, `chain`, `slow`,
 * `burn`, `crit`, `multishot` and `aura`, and writes each with its parameters in
 * the tower table (`splash(55)`). The snapshot reports `abilities` as strings and
 * the specification does not fix whether a build writes the bare name or the name
 * with its parameters, so the leading word is what is compared and the rest is
 * left to the build.
 */
export function abilityNames(view: StructureView): string[] {
  return view.abilities
    .map((ability) => /^[A-Za-z]+/.exec(String(ability).trim())?.[0] ?? "")
    .map((name) => name.toLowerCase())
    .sort();
}

/** The recipe rows the inspector is offering: one per reachable recipe. */
export function offeredRecipes(buttons: readonly PanelButton[]): PanelButton[] {
  return buttons.filter(
    (button) => button.action === "combine-special" && !button.disabled,
  );
}

/** The quality-fold rows the inspector is offering for the selected structure. */
export function offeredFolds(buttons: readonly PanelButton[]): PanelButton[] {
  return buttons.filter(
    (button) => button.action === "combine" && !button.disabled,
  );
}

/** A control label reduced to its letters, for a name comparison that is not a layout one. */
export function letters(text: string): string {
  return text.replace(/[^A-Za-z]/g, "").toLowerCase();
}
