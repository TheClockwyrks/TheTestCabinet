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

import type { FunctionSummary } from "../types.js";

export type { FunctionSummary };

/**
 * List the functions available on this API object, each as `{ name, summary }`. Only the functions
 * this run actually bound are returned, so the directory never names a call your program cannot
 * make. Open a view of one function's full signature, argument descriptions and types with
 * `view.openDocsView`.
 */
export declare function list(): FunctionSummary[];

// `list` is DECLARED rather than defined, and that is the honest shape of it. It has no
// implementation here because it is never imported: {@link "../shim.ts".buildScope} seeds it onto
// each API object it creates, bound from {@link listFunctions} with that object's own name closed
// over — so the function a program actually calls takes no arguments. The declaration is what makes
// the bound shape catalogued rather than described in prose somewhere gg cannot check, which is why
// its signature and its documentation are written here, on it, like every other model-facing
// function's.

/**
 * List one API object's bound functions, each with a one-line summary. Only the functions this run
 * actually bound are returned; an unknown object name is an empty list, not a failure.
 *
 * @param object The API object to list (`fs`, `view`, …).
 */
export function listFunctions(object: string): FunctionSummary[] {
  return raw.listFunctions(object);
}
