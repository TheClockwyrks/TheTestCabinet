/**
 * The `docs` carve-out: documentation lookup, bound into every program's scope and never a gg tool.
 *
 * It is the second model-facing function family that is not a capability (the first is
 * {@link "../session.ts"}'s `finish`): no toolset offers it, an ablation cannot withhold it, and it
 * is absent from `TOOL_CATALOGUE` so the bijection the component is checked against is undisturbed.
 * The shim binds it into every program as two things — an `object.list()` on each API object and a
 * `fn.docs()` on each bound function (plus `harness.readDocs(fn)`) — so a model can always discover
 * the functions it has and read what they do, whatever a run enables.
 */

import * as raw from "test-cabinet:gg/docs";
import { call } from "../errors.js";

export type { FunctionSummary } from "test-cabinet:gg/docs";

/**
 * List one API object's bound functions, each with a one-line summary. Only the functions this run
 * actually bound are returned; an unknown object name is an empty list, not a failure.
 */
export function listFunctions(object: string): raw.FunctionSummary[] {
  return raw.listFunctions(object);
}

/**
 * The full documentation for one function by the name it is called by: its signature, description,
 * and the declarations of any types it refers to that have not already been shown this session. Also
 * injects a durable copy into your context, so it stays across turns. Throws `not-found` for an
 * unknown name.
 */
export function readDoc(name: string): string {
  return call(() => raw.readDocs(name));
}
