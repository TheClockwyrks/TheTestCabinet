import type { ArtifactStorageStatus } from "@clockwyrks/run-record/jobs-api";
import type { InProgressRun } from "./types";

// What a console says about the artifact store's capacity.
//
// The backend watches the store every run's tree is uploaded to. It warns while
// the volume's free space is running low, and stops handing queued runs to the
// dispatcher whenever a tree uploaded now might not be stored: the volume could no
// longer take the runs already in flight, the artifact service cannot be reached,
// its write check fails, a finished run is still waiting to store its tree, or an
// upload failed and no tree has been stored since. A
// run that finishes with nowhere to put its tree loses its source and build for
// good, so a held queue is the system working as intended, and the console's job
// is to say so plainly: queued runs that never start otherwise read as a broken
// dispatcher.
//
// The wording lives here, framework-free, so the notice and the held run's
// tooltip state the same reason in the same words.

/** How loudly a notice reads: `warn` is advisory, `hold` means runs are stopped. */
export type StorageNoticeTone = "warn" | "hold";

export interface StorageNotice {
  tone: StorageNoticeTone;
  /** The one-line statement of what is happening. */
  title: string;
  /** What it means for the operator's runs and what ends it. */
  detail: string;
}

const GIB = 1024 ** 3;

/** A byte count as gibibytes, to one decimal and without a trailing `.0`. */
export function formatGib(bytes: number): string {
  const rounded = Math.round((bytes / GIB) * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} GiB`;
}

/** "1 finished run is" / "3 finished runs are", for the runs waiting to store. */
function waitingRuns(count: number): string {
  return count === 1 ? "1 finished run is" : `${count} finished runs are`;
}

/** `detail` with the error the backend reported behind the hold appended. */
function withError(detail: string, error: string | undefined): string {
  const text = error?.trim();
  return text ? `${detail} Reported: ${text}` : detail;
}

/** How many runs are waiting to store, as a sentence, or nothing when none are. */
function waitingSentence(status: ArtifactStorageStatus): string {
  const count = status.runsWaitingToStore ?? 0;
  return count > 0
    ? ` ${waitingRuns(count)} waiting to store ${count === 1 ? "its" : "their"} artifacts.`
    : "";
}

// The condition holding the queue. A backend that predates `holdReason` reports a
// hold through its state alone, which names the same condition.
function holdReasonOf(
  status: ArtifactStorageStatus,
): NonNullable<ArtifactStorageStatus["holdReason"]> | null {
  if (!status.runsOnHold) return null;
  if (status.holdReason) return status.holdReason;
  switch (status.state) {
    case "blocked":
      return "low-space";
    case "unwritable":
      return "unwritable";
    case "unavailable":
      return "unreadable";
    default:
      return null;
  }
}

/**
 * The notice a console shows for `status`, or null when the store needs no
 * attention: it has room and takes writes, or it is unmonitored.
 *
 * A held queue reads "New runs are on hold" with the condition holding it, the
 * number of finished runs waiting to store their artifacts, and the error the
 * backend reported behind the hold. The thresholds are quoted rather than the free
 * space. A status arrives when the state changes, so its free-space figure ages,
 * while a threshold stays true for as long as the notice is up.
 */
export function storageNotice(
  status: ArtifactStorageStatus | null | undefined,
): StorageNotice | null {
  if (!status) return null;
  switch (holdReasonOf(status)) {
    case "low-space":
      return {
        tone: "hold",
        title: "New runs are on hold: artifact storage is full",
        detail: `Less than ${formatGib(status.stopBytes)} is free, which is kept for the runs already in flight.${waitingSentence(status)} Queued runs start once space is freed. Publishing is unaffected.`,
      };
    case "unreadable":
      return {
        tone: "hold",
        title: "New runs are on hold: the artifact service cannot be reached",
        detail: withError(
          `A run that finished now could not store its output.${waitingSentence(status)} Queued runs start once the artifact service answers again. Publishing is unaffected.`,
          status.detail,
        ),
      };
    case "unwritable":
      return {
        tone: "hold",
        title: "New runs are on hold: the artifact store cannot be written to",
        detail: withError(
          `The artifact service's write check is failing, so a run that finished now could not store its output.${waitingSentence(status)} Queued runs start once the check passes. Publishing is unaffected.`,
          status.detail,
        ),
      };
    case "uploads-waiting":
      return {
        tone: "hold",
        title:
          "New runs are on hold: finished runs are waiting to store their artifacts",
        detail: withError(
          `${waitingRuns(Math.max(status.runsWaitingToStore ?? 0, 1))} retrying an upload the artifact store did not take. Queued runs start once the waiting runs have stored their artifacts. Publishing is unaffected.`,
          status.detail,
        ),
      };
    case "write-check-pending":
      return {
        tone: "hold",
        title:
          "New runs are on hold: the artifact store is being checked after failed uploads",
        detail: withError(
          "No run is waiting to store its artifacts any longer. Queued runs start with the next passing write check, within seconds. Publishing is unaffected.",
          status.detail,
        ),
      };
    case "proving-store":
      return {
        tone: "hold",
        title:
          "New runs start one at a time: an upload failed and the artifact store has not stored a run since",
        detail: withError(
          "The artifact store reads healthy, and did while the upload failed, so one run at a time is started to find out. The rest of the queue starts once a run's artifacts have been stored. Publishing is unaffected.",
          status.detail,
        ),
      };
    case null:
      break;
  }
  if (status.state === "low") {
    return {
      tone: "warn",
      title: "Artifact storage is running low",
      detail: `Less than ${formatGib(status.warnBytes)} is free. New runs go on hold under ${formatGib(status.stopBytes)}.`,
    };
  }
  return null;
}

/**
 * Why a waiting run is being held, when the artifact store is the reason, or null
 * when the queue is not on hold. A `pending` run is also held by its harness's
 * parallelism cap or its jam's turn, so a null here says nothing about those.
 */
export function storageHoldReason(
  status: ArtifactStorageStatus | null | undefined,
): string | null {
  const notice = storageNotice(status);
  return notice?.tone === "hold" ? notice.title : null;
}

// Worst first, for a console connected to more than one backend.
const SEVERITY: Readonly<Record<StorageNoticeTone, number>> = {
  hold: 0,
  warn: 1,
};

/** The most severe notice among `statuses`, or null when none calls for one. */
export function worstStorageNotice(
  statuses: Iterable<ArtifactStorageStatus>,
): StorageNotice | null {
  let worst: StorageNotice | null = null;
  for (const status of statuses) {
    const notice = storageNotice(status);
    if (!notice) continue;
    if (!worst || SEVERITY[notice.tone] < SEVERITY[worst.tone]) worst = notice;
  }
  return worst;
}

/**
 * What a run's live monitor says while the run is `storing`, or null in any other
 * phase. The run itself is over: without this a monitor shows a live run whose
 * feed has gone quiet, which reads as a hang.
 */
export function storingRunNotice(
  run: Pick<InProgressRun, "state" | "detail"> | null | undefined,
): string | null {
  if (run?.state !== "storing") return null;
  return withError(
    "The run has finished and is waiting to store its artifacts. It keeps trying until the artifact store takes them, and new runs are on hold meanwhile. Nothing is lost while it waits; stopping the run now discards what it built.",
    run.detail ?? undefined,
  );
}
