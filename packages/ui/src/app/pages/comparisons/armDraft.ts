// The editable shape of one comparison **arm** — one configuration — while the
// create/edit form holds it, plus the label it reads as. Kept free of React so the
// label derivation (which every chart, panel, and launch summary keys off) is unit
// tested directly (see armDraft.test.ts).
import { harnesses } from "../../data/harnesses";
import { PRIMARY_SLOT } from "../runs/gg/ggCatalog";

/** What an arm runs: a third-party harness on a model, or a gg configuration
 *  with a model bound to every slot it declares. */
export type ArmKind = "harness" | "gg";

/** One row of the comparison editor's configuration list. Both shapes' fields are
 *  carried at once so switching a row's kind and back does not lose the other
 *  side's picks mid-edit; only the fields belonging to `kind` are ever saved. */
export interface ArmDraft {
  /** The arm's stable id — assigned once and preserved across edits, since the
   *  arm's launched `runIds` are keyed to it. */
  id: string;
  kind: ArmKind;
  /** The operator's own label. Blank means "use the derived one". */
  label: string;
  /** The harness slug this arm runs (`kind: "harness"`). */
  harness: string;
  /** The model that harness runs (`kind: "harness"`). */
  modelId: string;
  /** The picked gg configuration's key (`kind: "gg"`; see `useGgConfigs`). */
  ggConfig: string;
  /** The model bound to each of that configuration's model slots, by slot name. */
  slotModels: Record<string, string>;
  /** The runs already launched for this arm, carried through an edit untouched. */
  runIds: string[];
}

/**
 * How an arm reads when the operator has not labeled it themselves: the thing it
 * runs, then the model it runs on — "Pi · claude-opus-4.8", "configuration A ·
 * claude-opus-4.8". The model belongs in the label because it is per arm now: two
 * arms can share a harness (or a gg configuration) and differ only in model, and a
 * chart legend that showed just "Pi" twice would be unreadable.
 *
 * A gg configuration can bind several models, so the label names its
 * [primary](PRIMARY_SLOT) slot's — falling back to whichever slot is bound first —
 * rather than listing them all.
 */
export function armLabel(
  arm: ArmDraft,
  ggName: (key: string) => string,
): string {
  if (arm.kind === "harness") {
    const harness =
      harnesses.find((h) => h.slug === arm.harness)?.displayName ?? arm.harness;
    const model = arm.modelId.trim();
    return model ? `${harness} · ${model}` : harness;
  }
  const name = arm.ggConfig ? ggName(arm.ggConfig) : "gg";
  const model = (
    arm.slotModels[PRIMARY_SLOT] ??
    Object.values(arm.slotModels).find((m) => m.trim()) ??
    ""
  ).trim();
  return model ? `${name} · ${model}` : name;
}
