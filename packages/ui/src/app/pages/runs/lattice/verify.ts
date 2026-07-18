// Proving that what playback draws is the factory the run was graded on.
//
// Playback re-steps the reference engine rather than replaying anything the
// submission emitted, which raises a fair question: how do we know the engine in
// the browser is the same one that graded the run? A vendored wasm that lagged the
// engine would render a *different* factory while the run's recorded numbers said
// otherwise — the one way this feature could quietly lie.
//
// The run record answers it. A performance run records the checksum its engine
// produced at every scheduled snapshot tick, and a correct run's checksums are the
// reference engine's by definition. So as playback passes each scheduled tick we
// compare its own checksum against the recorded one. Agreement is evidence; a
// disagreement means the playback engine has drifted and the frames cannot be
// trusted. This is the analogue of Foray's replay-drift gate.

/** One scheduled snapshot's recorded checksum, from the run record. */
export interface RecordedCheck {
  tick: number;
  checksum: string;
}

/** Where a mismatch was found — enough to report it concretely. */
export interface ChecksumMismatch {
  tick: number;
  /** What the run recorded at this tick. */
  recorded: string;
  /** What the playback engine produced there. */
  replayed: string;
}

/** How verification currently stands. */
export type VerificationStatus =
  /** The run recorded no checksums, so there is nothing to verify against. */
  | "unverifiable"
  /** Scheduled ticks remain unreached; everything so far agrees. */
  | "pending"
  /** Every recorded tick was reached and agreed. */
  | "verified"
  /** A reached tick disagreed — the playback engine has drifted. */
  | "drifted";

export interface VerificationState {
  status: VerificationStatus;
  /** Scheduled checks confirmed so far. */
  matched: number;
  /** Scheduled checks in total. */
  total: number;
  /** The first disagreement, if any. */
  mismatch: ChecksumMismatch | null;
}

/**
 * A running check over a playback pass. Feed it every tick the engine produces;
 * ticks that are not scheduled snapshots are ignored.
 *
 * A run that recorded no checksums (one graded before they were recorded) reports
 * `unverifiable` and never becomes `verified` — silence is not evidence, and
 * claiming otherwise would be worse than admitting the gap.
 */
export class ChecksumVerifier {
  private readonly byTick: Map<number, string>;
  private readonly seen = new Set<number>();
  private mismatch: ChecksumMismatch | null = null;

  constructor(recorded: readonly RecordedCheck[]) {
    this.byTick = new Map(recorded.map((c) => [c.tick, c.checksum]));
  }

  /** Observe one replayed tick. Only scheduled snapshot ticks are checked. */
  observe(tick: number, checksum: string): void {
    const recorded = this.byTick.get(tick);
    if (recorded === undefined) return;
    if (recorded !== checksum) {
      // Keep the FIRST disagreement: later ticks diverge as a consequence, so the
      // earliest one is the informative one.
      this.mismatch ??= { tick, recorded, replayed: checksum };
      return;
    }
    this.seen.add(tick);
  }

  /** Forget what has been observed, for a replay from the start. */
  reset(): void {
    this.seen.clear();
    this.mismatch = null;
  }

  state(): VerificationState {
    const total = this.byTick.size;
    const matched = this.seen.size;
    let status: VerificationStatus;
    if (this.mismatch) status = "drifted";
    else if (total === 0) status = "unverifiable";
    else if (matched === total) status = "verified";
    else status = "pending";
    return { status, matched, total, mismatch: this.mismatch };
  }
}
