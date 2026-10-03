import { useEffect, useMemo, useState } from "react";
import type { TestType } from "@clockwyrks/run-record";
import type { BackendClient } from "../../../client/clients";
import { useBackend } from "../../../client/context";
import type { VersionInfo } from "../../../client/types";
import { DEFAULT_ENGINE_SLUG } from "../../data/engines";

// Whether a case version can be a ladder rung, as the console works it out before the
// backend is asked to save one.
//
// A ladder's gate reads only the ratings validators decide, so a rung must pin a
// **validator-rated** version: one on the engine manifest format that is not a game
// jam. A legacy version is rated only by a reviewer, so its runs would never carry a
// rating the gate can read, and a performance or game-jam case records no functional
// rating at all. The backend refuses all three when a ladder is saved
// (`components/backend/ladders.md`, "A rung must be validator-rated"); this module is
// what lets the editor say so before the save, beside the version that causes it.

/** The test types a rung may never hold, mirroring the backend's
 *  `RUNG_INELIGIBLE_TEST_TYPES`. */
export const RUNG_INELIGIBLE_TEST_TYPES: ReadonlySet<TestType> =
  new Set<TestType>(["performance", "game-jam"]);

/** Whether a version can be climbed, and if not, why. */
export type RungEligibility =
  /** Validator-rated: a ladder can climb it. */
  | { kind: "eligible" }
  /** On the legacy manifest format: rated only by a reviewer. */
  | { kind: "legacy" }
  /** A performance or game-jam case, which records no functional rating. */
  | { kind: "ineligibleType"; testType: TestType }
  /** The backend holds no such version. Allowed, exactly as the backend allows it at
   *  author time: the driver reports a missing version better than a guess here. */
  | { kind: "unknown" };

/** Why a legacy version cannot be a rung, as the picker and the rung rows say it. */
export const LEGACY_RUNG_REASON =
  "Legacy version: rated only by a reviewer, so a ladder cannot climb it.";

/** The eligibility of one resolved version, or `unknown` when it did not resolve. */
export function rungEligibility(
  info: Pick<VersionInfo, "engineFormat" | "testType"> | null | undefined,
): RungEligibility {
  if (!info) return { kind: "unknown" };
  if (RUNG_INELIGIBLE_TEST_TYPES.has(info.testType)) {
    return { kind: "ineligibleType", testType: info.testType };
  }
  return info.engineFormat ? { kind: "eligible" } : { kind: "legacy" };
}

/** Whether a version is known to be one a ladder cannot climb. `unknown` and a lookup
 *  still in flight are not: neither is a reason to refuse anything. */
export function isIneligible(e: RungEligibility | undefined): boolean {
  return e?.kind === "legacy" || e?.kind === "ineligibleType";
}

/** The sentence naming why a version cannot be a rung, or null when it can. */
export function ineligibleReason(
  e: RungEligibility | undefined,
): string | null {
  if (e?.kind === "legacy") return LEGACY_RUNG_REASON;
  if (e?.kind === "ineligibleType") {
    return e.testType === "performance"
      ? "A performance case is graded on its own scale and records no functional rating, so a ladder cannot climb it."
      : "A game jam is reviewed on a graded category scale and records no domain rating, so a ladder cannot climb it.";
  }
  return null;
}

/** A case version a lookup is asked about. */
export interface VersionPin {
  slug: string;
  version: string;
}

function pinKey(pin: VersionPin): string {
  return `${pin.slug}@${pin.version}`;
}

// One shared answer per client and version, so the editor's rung list, its add-row,
// and the page's save check asking about the same version cost one request between
// them rather than one each. Keyed by client because two backends can hold two
// different versions under one name.
const cache = new WeakMap<
  BackendClient,
  Map<string, Promise<RungEligibility>>
>();

function lookup(
  client: BackendClient,
  pin: VersionPin,
): Promise<RungEligibility> {
  let byPin = cache.get(client);
  if (!byPin) {
    byPin = new Map();
    cache.set(client, byPin);
  }
  const key = pinKey(pin);
  let found = byPin.get(key);
  if (!found) {
    found = Promise.resolve()
      // The structure is all that is read (format and test type), so the engineless
      // rendering is what is asked for, as the new-run form asks.
      .then(() =>
        client.resolveVersion(pin.slug, pin.version, DEFAULT_ENGINE_SLUG),
      )
      .then(
        (info) => rungEligibility(info),
        (): RungEligibility => ({ kind: "unknown" }),
      );
    byPin.set(key, found);
  }
  return found;
}

/**
 * Resolve whether each of `pins` can be a rung. Returns a reader that answers
 * `undefined` while a version is still being resolved.
 */
export function useVersionEligibility(
  pins: VersionPin[],
): (pin: VersionPin) => RungEligibility | undefined {
  const { client } = useBackend();
  const [known, setKnown] = useState<ReadonlyMap<string, RungEligibility>>(
    () => new Map(),
  );
  // The pins as one stable string, so a fresh array of the same pins each render does
  // not re-run the lookups.
  const wanted = useMemo(
    () => [...new Set(pins.filter((p) => p.slug && p.version).map(pinKey))],
    [pins],
  );
  const wantedKey = wanted.join("\n");

  useEffect(() => {
    if (!client) return;
    let active = true;
    for (const key of wantedKey ? wantedKey.split("\n") : []) {
      const at = key.lastIndexOf("@");
      const pin = { slug: key.slice(0, at), version: key.slice(at + 1) };
      void lookup(client, pin).then((e) => {
        if (!active) return;
        setKnown((prev) => {
          if (prev.get(key)?.kind === e.kind) return prev;
          const next = new Map(prev);
          next.set(key, e);
          return next;
        });
      });
    }
    return () => {
      active = false;
    };
  }, [client, wantedKey]);

  return (pin) => known.get(pinKey(pin));
}
