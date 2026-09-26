import {
  DEFAULT_ENGINE_SLUG,
  engineName,
  resolveEngineSlug,
} from "../../data/engines";

// How a **pinned case** reads on the scheduling surface, and what one is written as.
// The case-side twin of `comboLabels`: a plan's cases, a matrix block, a review-queue
// row, a ladder's rungs and the pills in both editors all name the same pin, and a pin
// is four fields rather than three now that it carries an engine. Naming them in one
// place is what stops one screen distinguishing two engines and the next collapsing
// them into a single line the reviewer cannot tell apart.
//
// Structural, like `comboLabels`: every function takes the fields the wire types share
// (`ReviewPlanCase`, `LadderRung`, `LadderRungInput`, `CoverageCell`, `LadderCell`,
// `CoverageQueueEntry`, `LadderProgressRung`), so none of them has to be converted
// first.

/** The pin fields a case is identified and labelled from, in whichever shape it arrived. */
export interface PinnedCaseLike {
  /** The test-case slug. */
  slug: string;
  /** The pinned, exact version. */
  version: string;
  /** The variant. */
  variant: string;
  /**
   * The engine, or absent/null for the engineless run. A cell and a queue entry carry
   * it already resolved; a pin and a rung carry what the reviewer chose.
   */
  engine?: string | null;
}

/**
 * The pin's engine resolved: the slug it names, or `none` where it names nothing.
 *
 * Mirrors the server's `ReviewPlanCase::engine_slug`. Absent and `none` are the same
 * pin — the engineless run every case supports, and exactly what a plan authored
 * before the pin carried an engine asked for — so they must never read, key, or
 * de-duplicate as two.
 */
export function caseEngine(pin: PinnedCaseLike): string {
  return resolveEngineSlug(pin.engine);
}

/**
 * The engine half of a pin as it is **written**: omitted for the engineless run, the
 * named slug otherwise.
 *
 * Omitted rather than sent as `none` because the two are the same pin to the server,
 * and a plan authored today should be byte-identical on the wire to one authored
 * before the engine was part of a pin at all.
 */
export function pinnedEngine(engine: string): { engine?: string } {
  return engine === DEFAULT_ENGINE_SLUG ? {} : { engine };
}

/**
 * Whether two pins are the same pinned case, so adding one twice is refused.
 *
 * The engine is compared resolved, for the same reason the server keys a cell on it:
 * one case at one version and variant on two engines is two pins whose runs are not
 * comparable, while a pin naming `none` and a pin naming nothing are one.
 */
export function samePinnedCase(a: PinnedCaseLike, b: PinnedCaseLike): boolean {
  return (
    a.slug === b.slug &&
    a.version === b.version &&
    a.variant === b.variant &&
    caseEngine(a) === caseEngine(b)
  );
}

/**
 * The engine as a label spells it, or the empty string when there is nothing to say.
 *
 * **The rule every surface follows: name the engine only when it is not the engineless
 * `none`.** Every pin has an engine, so spelling `none` out would add a word to every
 * case on every screen to distinguish the ordinary case from nothing — noise on the
 * many labels that carry it, and no help on the few that need it. A named engine is
 * the exception and is what actually has to be told apart, so it is the thing that
 * shows.
 */
export function caseEngineLabel(pin: PinnedCaseLike): string {
  const slug = caseEngine(pin);
  return slug === DEFAULT_ENGINE_SLUG ? "" : engineName(slug);
}

/**
 * What a pin narrows a case to: `variant · version`, plus the engine when it is named.
 *
 * The muted qualifier beside a heading that has already said which case it is — a
 * matrix block's title, a review-queue row's link.
 */
export function caseQualifier(pin: PinnedCaseLike): string {
  const engine = caseEngineLabel(pin);
  const head = `${pin.variant} · ${pin.version}`;
  return engine ? `${head} · ${engine}` : head;
}

/**
 * The whole pin on one line: `case · variant · version[ · engine]`.
 *
 * The form used wherever the pin stands alone — a case pill, a rung row, a cell label
 * in a combination-grouped block — because in those places nothing else on screen says
 * which case, variant or engine the runs belong to.
 *
 * The display name is passed in rather than resolved here: it comes from a hook over
 * the host's catalog, and a label that reached for it would only be callable from a
 * component.
 */
export function caseLabel(name: string, pin: PinnedCaseLike): string {
  return `${name} · ${caseQualifier(pin)}`;
}
