import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router";

/** Which tab's selection parameter to read: a tool name, or an `object.name` function. */
export type SelectionParam = "tool" | "fn";

export interface EntrySelection {
  /**
   * The entry the URL names, or `null` when it names none.
   *
   * Deliberately the *raw* parameter rather than a resolved entry: the caller has to
   * tell "the URL named nothing, so show the first entry" apart from "the URL named
   * something this gg does not have", and those are the same value once resolved. The
   * second case is a real one — a link to a tool that a later gg renamed or dropped —
   * and it deserves to say so rather than silently landing somewhere else.
   */
  requested: string | null;
  /** Put an entry's name in the URL. */
  select: (name: string) => void;
}

/**
 * The Reference tabs' selected entry, carried in the query string so a specific tool or
 * function is a linkable address.
 *
 * The selection **replaces** rather than pushes. Both trees are fully visible beside the
 * pane, so every entry is one click away whether or not the back button walks the ones
 * already read — while pushing would spend the whole history stack on a browsing session
 * and leave Back unable to do the one thing it is actually wanted for here, which is
 * getting out of the reference and back to where the question came from.
 */
export function useEntrySelection(param: SelectionParam): EntrySelection {
  const [params, setParams] = useSearchParams();
  const select = useCallback(
    (name: string) => {
      const next = new URLSearchParams(params);
      next.set(param, name);
      setParams(next, { replace: true });
    },
    [param, params, setParams],
  );
  return { requested: params.get(param), select };
}

/**
 * Scroll a deep-linked entry's row into view, once, when the tree first has it.
 *
 * Both trees list every entry gg has — 37 tools under eight folders, 50 functions under
 * thirteen — so an entry named by the URL is very often below the sidebar's fold. Without
 * this, opening a link to `create_memory` shows the right detail pane beside a tree
 * scrolled to `read_file`, and the page reads as though nothing were selected at all.
 *
 * Deliberately **only** for a selection that arrived in the URL, and only the first time:
 * a row the reader clicked is already under their cursor, and scrolling the tree out from
 * under them afterwards is the browsing session fighting back. The row is found by the
 * `aria-current` [`FsFileRow`](../../runs/gg/GgFsExplorer) already sets, rather than by
 * threading a ref through the tree, so the shared explorer needs nothing added to it.
 *
 * `ready` is what the caller uses to say "the document has loaded and the tree is
 * rendered"; the effect waits for it, because on the first paint there is no row to find.
 */
export function useRevealSelection(deepLinked: boolean, ready: boolean): void {
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current || !ready || !deepLinked) return;
    revealed.current = true;
    const row = document.querySelector('[aria-current="true"]');
    // Feature-detected, not merely null-checked: jsdom implements no layout and so defines
    // no `scrollIntoView` at all, and an unguarded call throws out of the effect and takes
    // the whole tab down with it under test. Purely cosmetic behaviour has no business
    // being the thing that decides whether the page renders.
    //
    // `nearest` rather than `center`: it scrolls the sidebar only as far as it must, and
    // leaves an entry that was already visible exactly where the reader will look for it.
    row?.scrollIntoView?.({ block: "nearest" });
  }, [deepLinked, ready]);
}
