/**
 * The directory every capability module carries.
 *
 * `list` is not declared on any one module: the shim seeds it onto each module object it builds, with
 * that module's own name closed over, so the function a program calls takes no arguments and belongs
 * to all of them. This module is where its signature and its documentation are written, for the
 * reason everything else on this surface is written on its own declaration — a description kept
 * anywhere else is one nothing can compare against the code.
 */

import type { FunctionSummary } from "./core.js";

/**
 * List the functions this module offers, each with a one-line summary.
 *
 * Only the functions this run actually bound are returned, so the directory never names a call the
 * program cannot make. One function's full signature, argument descriptions and types are opened as a
 * view with `gg.views.openDocsView`.
 */
export declare function list(): FunctionSummary[];

// `list` is DECLARED rather than defined, and that is the honest shape of it. It has no
// implementation here because it is never imported: the shim seeds it onto each module object it
// creates, bound from the membrane's own directory call with that module's name closed over. The
// declaration is what makes the bound shape catalogued rather than described in prose somewhere gg
// cannot check.
