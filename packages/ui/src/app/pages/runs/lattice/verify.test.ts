import { describe, expect, it } from "vitest";
import { ChecksumVerifier, type RecordedCheck } from "./verify";

const RECORDED: RecordedCheck[] = [
  { tick: 100, checksum: "fnv1a64:aaaaaaaaaaaaaaaa" },
  { tick: 200, checksum: "fnv1a64:bbbbbbbbbbbbbbbb" },
];

describe("ChecksumVerifier", () => {
  it("starts pending and confirms as each scheduled tick is reached", () => {
    const v = new ChecksumVerifier(RECORDED);
    expect(v.state()).toMatchObject({ status: "pending", matched: 0, total: 2 });

    v.observe(100, "fnv1a64:aaaaaaaaaaaaaaaa");
    expect(v.state()).toMatchObject({ status: "pending", matched: 1, total: 2 });

    v.observe(200, "fnv1a64:bbbbbbbbbbbbbbbb");
    expect(v.state()).toMatchObject({
      status: "verified",
      matched: 2,
      total: 2,
      mismatch: null,
    });
  });

  it("ignores ticks that are not scheduled snapshots", () => {
    const v = new ChecksumVerifier(RECORDED);
    for (let tick = 1; tick < 100; tick++) v.observe(tick, "fnv1a64:whatever");
    expect(v.state()).toMatchObject({ status: "pending", matched: 0 });
  });

  it("reports drift with both checksums when a reached tick disagrees", () => {
    // The failure this exists to catch: a vendored playback engine that no longer
    // matches the engine that graded the run.
    const v = new ChecksumVerifier(RECORDED);
    v.observe(100, "fnv1a64:0000000000000000");
    const state = v.state();
    expect(state.status).toBe("drifted");
    expect(state.mismatch).toEqual({
      tick: 100,
      recorded: "fnv1a64:aaaaaaaaaaaaaaaa",
      replayed: "fnv1a64:0000000000000000",
    });
  });

  it("keeps the first disagreement, since later ones follow from it", () => {
    const v = new ChecksumVerifier(RECORDED);
    v.observe(100, "fnv1a64:1111111111111111");
    v.observe(200, "fnv1a64:2222222222222222");
    expect(v.state().mismatch?.tick).toBe(100);
  });

  it("stays drifted even if every other tick agrees", () => {
    const v = new ChecksumVerifier(RECORDED);
    v.observe(100, "fnv1a64:0000000000000000");
    v.observe(200, "fnv1a64:bbbbbbbbbbbbbbbb");
    expect(v.state().status).toBe("drifted");
  });

  it("calls a run with no recorded checksums unverifiable, never verified", () => {
    // A run graded before checksums were recorded cannot be checked. Reporting it
    // as verified would be claiming evidence we do not have.
    const v = new ChecksumVerifier([]);
    expect(v.state()).toMatchObject({
      status: "unverifiable",
      matched: 0,
      total: 0,
    });
    v.observe(100, "fnv1a64:aaaaaaaaaaaaaaaa");
    expect(v.state().status).toBe("unverifiable");
  });

  it("clears on reset so a replay starts from no evidence", () => {
    const v = new ChecksumVerifier(RECORDED);
    v.observe(100, "fnv1a64:0000000000000000");
    expect(v.state().status).toBe("drifted");
    v.reset();
    expect(v.state()).toMatchObject({ status: "pending", matched: 0, mismatch: null });
  });

  it("does not double-count a tick observed twice", () => {
    const v = new ChecksumVerifier(RECORDED);
    v.observe(100, "fnv1a64:aaaaaaaaaaaaaaaa");
    v.observe(100, "fnv1a64:aaaaaaaaaaaaaaaa");
    expect(v.state().matched).toBe(1);
  });
});
