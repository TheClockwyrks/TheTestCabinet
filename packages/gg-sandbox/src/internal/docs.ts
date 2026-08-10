/**
 * The membrane call behind the directory every module carries, and nothing a model reads.
 *
 * The model-facing half — the signature and the documentation of the zero-argument `list` a program
 * actually calls — is declared in `src/gg/docs.ts`. What is here is the one-argument host import the
 * shim closes a module's name over, which no program is ever handed.
 */

import * as raw from "test-cabinet:gg/docs";
import type { FunctionSummary } from "../gg/core.js";

/**
 * List one grouping's bound functions, each with a one-line summary.
 *
 * An unknown grouping name is an empty list rather than a failure, because the shim only ever passes
 * a name it built a module object under.
 */
export function listFunctions(grouping: string): FunctionSummary[] {
  return raw.listFunctions(grouping);
}
