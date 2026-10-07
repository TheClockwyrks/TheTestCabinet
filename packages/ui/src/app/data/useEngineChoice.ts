import { useMemo, useState } from "react";
import { DEFAULT_ENGINE_SLUG, orderEngines } from "./engines";

// Picking an engine is the same problem everywhere it comes up: a *case version*
// decides which engines exist, an operator picks one of them, and the version
// underneath can change to a set that no longer holds the pick. The new-run form
// launches on the answer and the plan and ladder editors pin it, so both ask this
// hook rather than each keeping the selection in sync with the catalog themselves.

/** The engine selection over one resolved version's supported set. */
export interface EngineChoice {
  /** The engines the version supports, in catalog order; empty until it resolves. */
  options: string[];
  /**
   * The engine a launch or a pin actually carries. Always one of `options` while the
   * version supports anything at all.
   */
  engine: string;
  /** Record the operator's pick. */
  setEngine: (slug: string) => void;
}

/**
 * The engine chosen against `supported`, held to what that set actually offers.
 *
 * The answer is **derived** from the operator's pick rather than synced into it by an
 * effect, because the supported set moves under the selection: switching to a case
 * that offers a different set would otherwise leave a render — the one where a launch
 * or an add can be pressed — holding an engine that case would refuse. So the pick is
 * remembered as a *preference* and resolved on every render: the pick when the version
 * still supports it, otherwise the engineless run, otherwise the first engine the
 * version does support (a case built against a runtime need not offer the engineless
 * run at all).
 *
 * `initial` seeds the preference once, for a surface that was navigated to with an
 * engine already in hand (a case's Run action carries its whole anchored coordinate).
 * An `initial` the version does not support is held to the set like any other pick.
 */
export function useEngineChoice(
  supported: readonly string[] | null | undefined,
  initial?: string | null,
): EngineChoice {
  const [choice, setEngine] = useState(() => initial ?? DEFAULT_ENGINE_SLUG);
  const options = useMemo(() => orderEngines(supported ?? []), [supported]);
  const engine =
    options.find((slug) => slug === choice) ??
    options.find((slug) => slug === DEFAULT_ENGINE_SLUG) ??
    options[0] ??
    DEFAULT_ENGINE_SLUG;
  return { options, engine, setEngine };
}
