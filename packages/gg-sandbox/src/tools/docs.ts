/**
 * The `docs` carve-out: documentation lookup, bound into every program's scope and never a gg tool.
 *
 * It is the second model-facing function family that is not a capability (the first is
 * {@link "../session.ts"}'s `finish`): no toolset offers it, an ablation cannot withhold it, and it
 * is absent from `TOOL_CATALOGUE` so the bijection the component is checked against is undisturbed.
 * The shim binds it into every program as an `object.list()` on each API object, so a model can
 * always discover
 * the functions it has, whatever a run enables. Reading what one *does* is
 * {@link "./views.ts".openDocsView} — a view, because everything the model reads is a view.
 */

import * as raw from "test-cabinet:gg/docs";

export type { FunctionSummary } from "test-cabinet:gg/docs";

/**
 * List one API object's bound functions, each with a one-line summary. Only the functions this run
 * actually bound are returned; an unknown object name is an empty list, not a failure.
 *
 * @param object The API object to list (`fs`, `view`, …).
 */
export function listFunctions(object: string): raw.FunctionSummary[] {
  return raw.listFunctions(object);
}
