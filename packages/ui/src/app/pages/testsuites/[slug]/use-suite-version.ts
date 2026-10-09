import type { SuiteVersionIdentity } from "@clockwyrks/backend-api";
import { useCallback } from "react";
import { useSearchParams } from "react-router";

// The query-string key the anchored suite version is carried in. Deliberately
// the same `version` key a case detail anchors its coordinate with (see
// `useSelectedCoordinate`): the two mean the same thing — which version of the
// thing on screen is being looked at — so the reading is the same wherever a
// version rides a URL.
const VERSION_PARAM = "version";

/**
 * The version a suite detail page is anchored to — the one coordinate every tab
 * describes — and how to change it.
 */
export interface SuiteVersionCoordinate {
  /** The anchored version, carrying its leading `v`. Empty only while the
   * listing has resolved no version at all. */
  version: string;
  /** Whether the anchored version is one the suite actually holds. A version
   * the suite does not declare is not silently re-read as the newest: a URL
   * naming a version that does not exist is a not-found, the way an unknown
   * slug is. */
  known: boolean;
  /** Every version the suite holds, newest first — the order a selector reads. */
  versions: readonly SuiteVersionIdentity[];
  /** The anchored version's identity, when the suite holds it. */
  identity: SuiteVersionIdentity | undefined;
  /** The suite's newest version, which is what "the suite" means unqualified. */
  newestVersion: string;
  /** Whether the anchored version is the newest one. */
  isNewest: boolean;
  setVersion: (version: string) => void;
}

/**
 * Resolve the suite version the visitor has anchored the page to, from the
 * `?version=` query string, against the versions the listing says the suite
 * holds.
 *
 * Nothing selected reads as the newest version, which is the suite as a reader
 * means it unqualified. A selection the suite does not hold is reported as
 * unknown rather than quietly re-read as the newest, so a stale deep link says
 * so instead of showing a different version under the name of the one asked
 * for.
 *
 * The write replaces the history entry so flipping versions does not pile up
 * back-button stops, and drops the parameter at the newest version so the
 * ordinary URL stays clean.
 */
export function useSuiteVersion(
  versions: readonly SuiteVersionIdentity[],
): SuiteVersionCoordinate {
  const [params, setParams] = useSearchParams();
  // The listing serves versions oldest first; a reader reads newest first.
  const newestFirst = reversed(versions);
  const newestVersion = newestFirst[0]?.version ?? "";
  const requested = params.get(VERSION_PARAM);
  const version = requested ?? newestVersion;
  const identity = newestFirst.find((entry) => entry.version === version);

  const setVersion = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const search = new URLSearchParams(prev);
          if (next === newestVersion) {
            search.delete(VERSION_PARAM);
          } else {
            search.set(VERSION_PARAM, next);
          }
          return search;
        },
        { replace: true },
      );
    },
    [setParams, newestVersion],
  );

  return {
    version,
    known: identity !== undefined,
    versions: newestFirst,
    identity,
    newestVersion,
    isNewest: version === newestVersion,
    setVersion,
  };
}

// `items` newest first, given oldest first: a reversed copy, leaving the
// caller's array as it was.
function reversed<T>(items: readonly T[]): T[] {
  const out: T[] = [];
  for (const item of items) out.unshift(item);
  return out;
}
