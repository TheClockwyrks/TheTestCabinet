/**
 * Show the agent a file, a value, or a function's documentation.
 *
 * A view is the only channel into the agent's own context window. Under responses-as-code a whole
 * program's output would otherwise collapse into one anonymous blob, charged to one band, attributed
 * to nothing and evictable by nothing; a view restores what tool calling gave for free — one message
 * apiece, carrying the band it is charged to and the selector it can be closed by.
 *
 * Everything opened here arrives on the **next** turn, never the one that opened it.
 */

import * as raw from "test-cabinet:gg/views";
import { DOCS_NAME } from "../catalogue.js";
import { U32_MAX, call, opts, typeName, uint } from "../internal/errors.js";
import { ToolError } from "./core.js";
import { asFileRead } from "../internal/lower.js";
import type { FileRead } from "./files.js";

/**
 * Which of the three kinds a view is.
 *
 * The taxonomy is closed at three deliberately: everything on disk is a file, everything a program
 * computes is a string, and documentation is neither, because gg holds it. A directory listing, a
 * command's output, a child agent's answer and an assembled table are all text views.
 */
export type ViewKind =
  /** A file that was opened; its selector is the path. */
  | "file"
  /** A value that was shown; its selector is the label it was given. */
  | "text"
  /** A function's documentation; its selector is the function's name. */
  | "docs";

/** The window of lines a **paged** file view covers; absent for a whole-file view. */
export interface ViewRegion {
  /** The 1-based first line the view shows. */
  offset: number;

  /** How many lines it shows. */
  limit: number;
}

/** One view open in the context window, as `current` reports it. */
export interface OpenView {
  /** Whether it is a file, a text, or a documentation view. */
  kind: ViewKind;

  /** What `close` takes: a file's path, a text view's label, or a docs view's function name. */
  selector: string;

  /** Roughly what holding it costs, in tokens. */
  tokens: number;

  /** The line window a paged file view covers; absent for a whole-file view and for a text view. */
  region?: ViewRegion;
}

/**
 * Read a file and show it to the agent, handing the program the same value `gg.files.readFile` does.
 *
 * The split from `gg.files.readFile` is the point: that call gets bytes for the program, this one
 * puts the file in front of the agent, so a program that reads forty files to grep them adds nothing
 * to the window. Two pages of one file are two views that coexist, while re-opening the same page
 * replaces what it showed rather than piling up a duplicate.
 *
 * An image file is shown as a picture, and this is the only way to look at one:
 * `gg.files.readFile` of an image describes it without showing it.
 *
 * @ggop views.open_file
 * @param path The file to open, relative to the workspace or absolute.
 * @param options The window of lines to show; omit it to show the whole file.
 * @param options.offset The 1-based line to start at.
 * @param options.limit How many lines to show from `offset`.
 */
export function openFile(path: string, options?: { offset?: number; limit?: number }): FileRead {
  const o = opts<{ offset?: number; limit?: number }>("openFile", options);
  const offset = uint("openFile", "offset", o?.offset, U32_MAX);
  const limit = uint("openFile", "limit", o?.limit, U32_MAX);
  return asFileRead(call(() => raw.openFileView(path, offset, limit)));
}

/**
 * Show the agent a value the program computed, filed under a label.
 *
 * A directory listing, a command's output, a child agent's answer, an assembled table: this is the
 * channel a value takes into the next turn's context. Opening the same label again replaces what it
 * showed, so a program may refine one view in a loop without piling up a copy per iteration.
 *
 * An empty label is `invalid-argument`, since a view with no selector could never be closed or
 * attributed. An empty **body** is allowed, because it is how a program says that something it was
 * showing is now empty.
 *
 * Throws `ToolError` with `limit-exceeded`, naming the cap, when a body or a label is over gg's
 * ceilings. Nothing is ever silently truncated.
 *
 * @ggop views.open_text
 * @param label What to file the view under. It is what `close` takes, and opening the same label
 * again replaces what it showed. It may not be empty.
 * @param body What to show. An empty body is allowed: it says that something previously shown is now
 * empty.
 */
export function openText(label: string, body: string): void {
  call(() => raw.openTextView(label, body));
}

/**
 * Show the agent one function's full documentation: its signature, its description and its types.
 *
 * Only the types it names that have not already been shown this session are appended, so re-reading
 * costs nothing twice. The argument is the function itself, as in
 * `gg.views.openDocsView(gg.files.readFile)`, or its name as a string.
 *
 * It is a **view** rather than a return value, so the documentation arrives in the next prompt under
 * a `Documentation` heading and is not available in the turn that asked for it. Asking in one turn
 * and using it in the next is the shape that works. Opening the same function again replaces the
 * view, and `close` takes the same name.
 *
 * Throws `ToolError` with `not-found` for an unknown or unbound name; searching the documentation is
 * what says which names exist.
 *
 * @ggop views.open_docs_view
 * @param target The function to document: the function itself, or its name as a string.
 */
export function openDocsView(target: Function | string): void {
  call(() => raw.openDocsView(docsName(target)));
}

/**
 * The catalogue name behind an `openDocsView` argument: the string itself, or the name the shim
 * tagged onto the bound function.
 *
 * A bare `String(fn)` would give the source of the wrapper rather than the name gg knows it by,
 * which is why the tag exists at all. A function that carries no tag — something the program defined
 * itself — falls through to its own `name`, so the lookup fails as `not-found` on a name the model
 * can recognise rather than on a stringified closure.
 *
 * An argument that is neither is refused **here**, before the lookup, and that is the point.
 * `openDocsView(gg.shell.run)` — a function this run does not bind — evaluates to `undefined` long
 * before the call, and coercing it produced a lookup for a function literally named `"undefined"`,
 * reported back as an unknown name. The name was never the model's; nothing it wrote said
 * `undefined`, and telling it so sends it looking for a typo that is not there. So a value that does
 * not exist is reported as documentation that does not exist, and a value of the wrong type is
 * reported as the type it was.
 *
 * @internal
 */
function docsName(target: Function | string): string {
  if (typeof target === "string") return target;
  if (typeof target !== "function") {
    throw new ToolError(
      "openDocsView",
      "invalid-argument",
      target === undefined || target === null
        ? "no documentation found"
        : `expected a function or function name, got ${typeName(target)}`,
    );
  }
  const tagged = (target as unknown as Record<symbol, unknown>)[DOCS_NAME];
  return typeof tagged === "string" ? tagged : String(target.name);
}

/**
 * Close every view carrying a selector, and hand back how many were closed.
 *
 * For a file that is every page of that path, for a text view the one with that label, and for a
 * documentation view the function's name. Closing a selector that is not open returns zero rather
 * than failing, so a program that tidies up unconditionally needs no guard on every call.
 *
 * Closing a file view forgets what was read, not what exists. Closing a text view discards the only
 * copy of what it held, so anything needed later belongs in a file or a memory first.
 *
 * @ggop views.close
 * @param selector What the view is filed under: a file's path, a text view's label, or a
 * documentation view's function name.
 */
export function close(selector: string): number {
  // A `u32`, so already a `number` — the `bigint` conversion `current` makes is not needed here.
  return call(() => raw.closeView(selector));
}

/**
 * List what is open in the context window right now.
 *
 * Each entry carries its `kind`, the `selector` that closes it, roughly what it costs in `tokens`,
 * and — for a paged file view — the `region` it covers. It is the thing to read before deciding what
 * to close when the window is filling up.
 *
 * What it enumerates is the context window's contents, not any module's functions.
 *
 * @ggop views.current
 */
export function current(): OpenView[] {
  return call(() => raw.currentViews()).map((view) => ({
    kind: view.kind,
    selector: view.selector,
    tokens: Number(view.tokens),
    region: view.region,
  }));
}
