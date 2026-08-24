/**
 * Show the agent a file, a value, or an entry's documentation.
 *
 * A view is the only channel into the agent's own context window. Under responses-as-code a whole
 * program's output would otherwise collapse into one anonymous blob, charged to one band, attributed
 * to nothing and evictable by nothing; a view restores what tool calling gave for free — one message
 * apiece, carrying the band it is charged to and the selector it is keyed by.
 *
 * Everything opened here arrives on the **next** turn, never the one that opened it.
 */

import * as raw from "test-cabinet:gg/views";
import { DOCS_NAME } from "../catalogue.js";
import { U32_MAX, call, opts, typeName, uint } from "../internal/errors.js";
import { ApiError } from "./core.js";
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
  /** An entry's documentation; its selector is that entry's key. */
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

  /**
   * What it is keyed by, and what closes it.
   *
   * A file's path, a text view's label or `search results` for `close`, and for a documentation
   * view the fully-qualified name of the entry it documents.
   */
  selector: string;

  /** Roughly what holding it costs, in tokens. */
  tokens: number;

  /** The line window a paged file view covers; absent for a whole-file view and for a text view. */
  region?: ViewRegion;

  /**
   * Close this view, with its selector already supplied.
   *
   * `gg.views.close` for the common case where the listed view is in hand. A documentation view is
   * the one it does not take away, exactly as that call does not.
   *
   * @ggop views.close
   * @returns how many views were closed, which is zero when this one has already gone.
   * @throws `ApiError` with `unavailable` for an agent whose run did not buy
   * `agent-managed-context`, which is what buys closing a view.
   */
  close(): number;
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
 * The view's text is held to the same 65,536-byte cap a text view's body is: a window that would
 * carry more is refused, naming the size and the bound, and nothing is opened. Nothing is ever
 * silently truncated, so the way through is to narrow the window with `offset` and `limit`, or to
 * cut its long lines with `maxLineChars`, in the same turn. A picture is not a text body and is
 * bounded by gg's image cap alone.
 *
 * @ggop views.open_file
 * @param path The file to open, relative to the workspace or absolute.
 * @param options The window of lines to show, and how long a shown line may be; omit it to show the
 * whole file with its lines whole.
 * @param options.offset The 1-based line to start at. Omitted, the view starts at the first line.
 * @param options.limit How many lines to show from `offset`. Omitted, a capped read policy's
 * default applies, or the view runs to the end of the file. Both are honoured under every read
 * policy.
 * @param options.maxLineChars The longest a line of the view may be, in characters. Set, each line
 * longer than it is cut there and annotated in place as `foo (123 more chars...)`; omitted, lines
 * arrive whole. It cuts the view alone — the value this call returns and the file itself are
 * untouched — and the byte cap is measured after the cut, which is what lets a window over a log
 * of enormous lines fit. It must be between 1 and 65,536.
 * @returns the same value `gg.files.readFile` hands back for that window, so a program can use what
 * it just put in front of the agent.
 * @throws `ApiError` with `not-found` for a path that is not there, `limit-exceeded`, naming the
 * size and the bound, for a window whose text would be over the cap, and `invalid-argument` for a
 * `maxLineChars` of zero or over 65,536. The read is what fails, so nothing is opened when it does.
 */
export function openFile(
  path: string,
  options?: { offset?: number; limit?: number; maxLineChars?: number },
): FileRead {
  const o = opts<{ offset?: number; limit?: number; maxLineChars?: number }>("openFile", options);
  const offset = uint("openFile", "offset", o?.offset, U32_MAX);
  const limit = uint("openFile", "limit", o?.limit, U32_MAX);
  const maxLineChars = uint("openFile", "maxLineChars", o?.maxLineChars, U32_MAX);
  return asFileRead(call(() => raw.openFileView(path, offset, limit, maxLineChars)));
}

/**
 * Show the agent a value the program computed, filed under a label.
 *
 * A directory listing, a command's output, a child agent's answer, an assembled table: this is the
 * channel a value takes into the next turn's context. Opening the same label again replaces what it
 * showed, so a program may refine one view in a loop without piling up a copy per iteration.
 *
 * An empty **body** is allowed, because it is how a program says that something it was showing is
 * now empty. An empty label is not: a view with no selector could never be closed or attributed.
 *
 * @ggop views.open_text
 * @param label What to file the view under: its selector, and what opening the same label again
 * replaces. It may not be empty.
 * @param body What to show. An empty body is allowed: it says that something previously shown is now
 * empty.
 * @throws `ApiError` with `invalid-argument` for an empty label, and `limit-exceeded`, naming the
 * cap, when a body or a label is over gg's ceilings. Nothing is ever silently truncated.
 */
export function openText(label: string, body: string): void {
  call(() => raw.openTextView(label, body));
}

/**
 * Show the agent one module, function or type's full documentation: signature, description and types.
 *
 * Only the types it names that have not already been shown this session are appended, so re-reading
 * costs nothing twice. The argument is a bound function itself, as in
 * `gg.views.openDocsView(gg.docs.search)`, or the entry's name as a string.
 *
 * It is a **view** rather than a return value, so the documentation arrives in the next prompt under
 * a `Documentation` heading and is not available in the turn that asked for it. Asking in one turn
 * and using it in the next is the shape that works. Opening an entry that is already open does
 * nothing at all: the band only grows, and taking a documentation view away is bought by a
 * capability of its own.
 *
 * @ggop views.open_docs_view
 * @param target What to document: a bound function itself, or the entry's name as a string — a
 * module's name is its own path, as in `gg.views`.
 * @throws `ApiError` with `not-found` for an unknown or unbound name — searching the documentation
 * is what says which names exist — and `invalid-argument` for an argument that is neither a
 * function nor a string.
 */
export function openDocsView(target: Function | string): void {
  call(() => raw.openDocsView(docsName(target)));
}

/**
 * The catalogue name behind an `openDocsView` argument: the string itself, or the
 * {@link DOCS_NAME} tag on the function.
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
    throw new ApiError(
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
 * Close every view carrying a selector.
 *
 * For a file that is every page of that path, for a text view the one with that label, and for the
 * results of a search the label `search results`. Closing a selector that is not open is not a
 * failure, so a program that tidies up unconditionally needs no guard on every call.
 *
 * Documentation views are not among them: taking one of those away is bought by a capability of its
 * own, `docview-close`. A sweep that quietly reached them would answer zero for an agent that may not
 * close one, which reads exactly like a selector that named nothing.
 *
 * Closing a file view forgets what was read, not what exists. Closing a text view discards the only
 * copy of what it held, so anything needed later belongs in a file or a memory first.
 *
 * Closing a view is context management, and is bought by the same `agent-managed-context`
 * capability that buys evicting a file view: an agent whose run did not enable it is refused.
 *
 * @ggop views.close
 * @param selector What the view is filed under: a file's path, a text view's label, or `search
 * results`.
 * @returns how many views were closed, which is zero when the selector named nothing open.
 * @throws `ApiError` with `invalid-argument` for an empty selector, which could never have been a
 * view's name, and `unavailable` for an agent whose run did not buy `agent-managed-context`.
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
 * It takes no argument, so once granted nothing about it can fail: an empty window is an empty
 * list. Listing what is open is context management, bought with `close` by the
 * `agent-managed-context` capability, and an agent whose run did not enable it is refused.
 *
 * @ggop views.current
 * @returns every view open right now, each with what closes it and roughly what it costs.
 * @throws `ApiError` with `unavailable` for an agent whose run did not buy `agent-managed-context`.
 */
export function current(): OpenView[] {
  // The method is attached here rather than declared on a class: nothing in a program ever
  // constructs an `OpenView`, and a constructible declaration would be one inviting it to.
  return call(() => raw.currentViews()).map((view) => ({
    kind: view.kind,
    selector: view.selector,
    tokens: Number(view.tokens),
    region: view.region,
    close(): number {
      return close(view.selector);
    },
  }));
}
