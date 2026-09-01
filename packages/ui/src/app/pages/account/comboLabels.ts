// How a combination reads on the scheduling surface. A combination takes two shapes
// (a harness and its model, or a gg configuration and the models it binds), and every
// surface that names one — the member pills in the editors, the matrix group titles
// and cell labels, the ladder's climber rows — has to spell both. Naming them in one
// place is what stops the same member reading as "gg · " on one screen and as its
// configuration on the next.
//
// Deliberately structural: every function here takes the fields the shapes share, so a
// `ReviewPlanCombo`, a `CoverageCell`, a `LadderCell` and a `LadderClimber` are all
// labelled by the same code without converting between them first.

/**
 * The fields a combination is labelled from, in whichever shape it arrived.
 *
 * A structural type rather than a union of the generated ones: the wire types differ in
 * what else they carry (counts, a rung, a verdict) but agree exactly here, and a label
 * that insisted on one of them would have to be re-implemented for the others.
 */
export interface CombinationLike {
  /** The harness the combination runs — `gg` on a gg combination. */
  harness: string;
  /** The model a harness combination runs, or the root agent's on a gg one. */
  model: string;
  /** The provider for a provider-routed harness. */
  provider?: string | null;
  /** The gg configuration's launcher key (`saved:<id>`); absent on a harness member. */
  ggConfigId?: string | null;
  /** The configuration's current display name, resolved by whoever read it. */
  ggConfigName?: string | null;
  /** The model bound to each launch slot the configuration declares. */
  ggSlotModels?: Record<string, string> | null;
}

/**
 * Whether this is a gg combination.
 *
 * Decided on `ggConfigId` and never on the harness slug, because that is what the wire
 * contract says makes a member a gg member: a stored member's `harness` is normalized
 * to `gg` server-side, so a member the console has just built locally would otherwise
 * be classified before it had been told what it is.
 */
export function isGgCombo(combo: CombinationLike): boolean {
  return Boolean(combo.ggConfigId);
}

/**
 * The models a gg combination binds, de-duplicated and in slot-name order.
 *
 * Order and de-duplication are not cosmetic: these models are half of what identifies
 * a gg cell, so two members that bound the same models through differently-ordered
 * maps have to read — and key — identically.
 */
export function ggBoundModels(combo: CombinationLike): string[] {
  const slots = combo.ggSlotModels ?? {};
  const out: string[] = [];
  for (const slot of Object.keys(slots).sort()) {
    const model = (slots[slot] ?? "").trim();
    if (model && !out.includes(model)) out.push(model);
  }
  return out;
}

/**
 * What a gg combination's configuration is called.
 *
 * Falls back to the bare id when the name is missing, which happens for exactly one
 * reason worth surfacing: the configuration has been deleted and there is no name left
 * to resolve. The member still has to be identifiable — it is still costing the plan a
 * cell — so it reads as the id rather than as nothing.
 */
export function ggConfigLabel(combo: CombinationLike): string {
  const name = (combo.ggConfigName ?? "").trim();
  if (name) return name;
  return (combo.ggConfigId ?? "").replace(/^saved:/, "");
}

/**
 * The models half of a combination's label: the harness member's model, or every model
 * a gg member binds.
 *
 * A gg member with no launch slots left to bind (a configuration that pins every model
 * itself) falls back to the root agent's model a read filled in, so the label is never
 * silently empty.
 */
export function comboModels(combo: CombinationLike): string {
  if (!isGgCombo(combo)) return combo.model;
  const bound = ggBoundModels(combo);
  return bound.length > 0 ? bound.join(", ") : combo.model;
}

/**
 * The whole combination on one line: `harness · model`, or `configuration · models`.
 *
 * This is the form used wherever the combination stands alone — a matrix group title, a
 * cell label, a climber's heading — because in those places nothing else on screen says
 * which harness the runs belong to.
 */
export function comboLabel(combo: CombinationLike): string {
  const models = comboModels(combo);
  const head = isGgCombo(combo) ? ggConfigLabel(combo) : combo.harness;
  return models ? `${head} · ${models}` : head;
}

/**
 * The part of a combination that varies *within* one harness — what a pill reads when
 * the group it sits in has already named the harness.
 *
 * A harness member drops to its model (plus its provider, which is part of what makes
 * two otherwise identical members distinct); a gg member keeps its configuration name,
 * because "gg" is the whole of what its group heading said and the configuration is the
 * thing the reviewer chose.
 */
export function comboDetail(combo: CombinationLike): string {
  if (isGgCombo(combo)) return comboLabel(combo);
  return combo.provider ? `${combo.model} · ${combo.provider}` : combo.model;
}
