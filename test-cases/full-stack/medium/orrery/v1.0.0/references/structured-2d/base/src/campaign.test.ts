import { describe, expect, it } from "vitest";

import { CAMPAIGN_CHALLENGES, EXTRA_CHALLENGES } from "./challenges";
import {
  CAMPAIGN_MAX,
  CAMPAIGN_MIN,
  CONSTELLATION_TARGET,
  NAME_MAX,
  PARTS,
  TRAY_MAX,
} from "./constants";
import { parseChallenge } from "./formats";
import { trayEntries } from "./tray";
import type { Challenge, MoteType, PartKind } from "./types";

/** Every mote type a challenge's reagents mention. */
function reagentTypes(challenge: Challenge): MoteType[] {
  return challenge.reagents.flatMap((molecule) =>
    molecule.motes.map((mote) => mote.type),
  );
}

/** Every mote type a challenge's products mention. */
function productTypes(challenge: Challenge): MoteType[] {
  return challenge.products.flatMap((molecule) =>
    molecule.motes.map((mote) => mote.type),
  );
}

describe("the campaign course (specs/modes/campaign.md)", () => {
  it("holds between CAMPAIGN_MIN and CAMPAIGN_MAX challenges", () => {
    expect(CAMPAIGN_CHALLENGES.length).toBeGreaterThanOrEqual(CAMPAIGN_MIN);
    expect(CAMPAIGN_CHALLENGES.length).toBeLessThanOrEqual(CAMPAIGN_MAX);
  });

  it("carries a name of its own for every challenge", () => {
    const names = CAMPAIGN_CHALLENGES.map((challenge) => challenge.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name.length).toBeGreaterThanOrEqual(1);
      expect(name.length).toBeLessThanOrEqual(NAME_MAX);
    }
    // The Extras are a separate shelf, but a course name shared with one would
    // read as the same challenge twice.
    const extras = new Set(EXTRA_CHALLENGES.map((entry) => entry.name));
    for (const name of names) expect(extras.has(name)).toBe(false);
  });

  it("is well formed under specs/formats.md, challenge by challenge", () => {
    for (const challenge of CAMPAIGN_CHALLENGES) {
      // Every document is parsed at load; re-parsing the parsed form proves
      // the round trip as well as the rules.
      expect(() => parseChallenge(structuredClone(challenge))).not.toThrow();
      expect(challenge.reagents.length).toBeGreaterThan(0);
      expect(challenge.products.length).toBeGreaterThan(0);
      expect(challenge.target).toBe(CONSTELLATION_TARGET);
      expect(new Set(challenge.permitted).size).toBe(
        challenge.permitted.length,
      );
      for (const kind of challenge.permitted) {
        expect(kind).not.toBe("rise");
        expect(kind).not.toBe("set");
      }
    }
  });

  it("keeps every derived tray inside TRAY_MAX", () => {
    for (const challenge of CAMPAIGN_CHALLENGES) {
      expect(trayEntries(challenge).length).toBeLessThanOrEqual(TRAY_MAX);
    }
  });

  it("stands every part kind of PARTS in at least one tray", () => {
    const offered = new Set<PartKind>();
    for (const challenge of CAMPAIGN_CHALLENGES) {
      for (const entry of trayEntries(challenge)) offered.add(entry.kind);
    }
    for (const kind of PARTS) expect(offered.has(kind)).toBe(true);
  });

  it("introduces each part kind in one challenge before crowding it", () => {
    // A kind's FIRST tray is the challenge its answer turns on it, so no
    // challenge introduces more than two kinds nobody has met yet.
    const met = new Set<PartKind>();
    for (const challenge of CAMPAIGN_CHALLENGES) {
      const fresh = challenge.permitted.filter((kind) => !met.has(kind));
      expect(fresh.length).toBeLessThanOrEqual(2);
      for (const kind of challenge.permitted) met.add(kind);
    }
  });

  it("carries a product of an earlier challenge into a later one", () => {
    let carried = false;
    CAMPAIGN_CHALLENGES.forEach((challenge, index) => {
      const delivered = new Set(productTypes(challenge));
      for (const later of CAMPAIGN_CHALLENGES.slice(index + 1)) {
        const seen = [...reagentTypes(later), ...productTypes(later)];
        if (seen.some((type) => delivered.has(type))) carried = true;
      }
    });
    expect(carried).toBe(true);
  });

  it("grows: the last challenge asks for more of the vocabulary than the first", () => {
    const first = CAMPAIGN_CHALLENGES[0];
    const last = CAMPAIGN_CHALLENGES[CAMPAIGN_CHALLENGES.length - 1];
    expect(last.permitted.length).toBeGreaterThan(first.permitted.length);
  });
});

describe("the Extras shelf (specs/challenges.md)", () => {
  it("keeps every derived tray inside TRAY_MAX", () => {
    for (const challenge of EXTRA_CHALLENGES) {
      expect(trayEntries(challenge).length).toBeLessThanOrEqual(TRAY_MAX);
    }
  });
});
