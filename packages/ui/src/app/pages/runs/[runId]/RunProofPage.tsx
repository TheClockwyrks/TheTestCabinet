import { Panel, SpecAccordion, type AccordionEntry } from "@test-cabinet/ui";
import type { RunRecord } from "@test-cabinet/run-record";
import { MediaView } from "../../../components/MediaView";
import { useGalleryData } from "../../../data/galleryContext";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { AdversarialReplaySection } from "./AdversarialReplaySection";
import { LatticePlaybackSection } from "./LatticePlaybackSection";
import styles from "./RunDetailPages.module.scss";

// The Proof tab (`/runs/:runId/proof`): the run's evidence of play. For an
// adversarial run that is the set of proof matches — every reference opponent the
// submission was auto-replayed against, each watchable in-browser — which replace
// proof-of-implementation media for that type. For a *performance* run it is the
// factory playback: each scored scenario the engine got right, re-simulated
// in-browser by the same engine that graded the run and checked against the
// checksums the run recorded. For every other run type it is the
// proof-of-implementation media the agent submitted: each declared proof shows its
// submitted image or video, or a clear note when it was not produced or the host
// cannot serve it. Proof is a first-class run artifact, so it is browsable here
// independent of the reviewer flow that pairs each with its reference.
//
// A performance run's correctness + fuel *numbers* remain on the Results tab —
// they are the scored result. What lives here is the evidence you can watch.
export function RunProofPage() {
  return (
    <RunDetailLayout tab="proof">
      {({ run }) => <RunProofBody run={run} />}
    </RunDetailLayout>
  );
}

function RunProofBody({ run }: { run: RunRecord }) {
  const gallery = useGalleryData();

  // An adversarial run's proof is its match replays, not submitted media; render
  // them in place of the proof-of-implementation accordion (which it never has).
  const replay = gallery.replayResultFor(run);
  if (replay && replay.replays.length > 0) {
    return <AdversarialReplaySection run={run} />;
  }

  // A performance run's proof is its factory playback, same idea: something you can
  // watch rather than media the agent submitted. Only a run whose engine got a case
  // right records a playable scenario, so a failing run falls through to the note
  // below — there is nothing honest to show for one.
  const playback = gallery.performancePlaybackFor(run);
  if (playback && playback.scenarios.some((s) => s.scenarioUrl)) {
    return <LatticePlaybackSection run={run} />;
  }

  const proofs = gallery.proofMediaFor(run);

  if (proofs.length === 0) {
    return (
      <Panel>
        <p className={styles.empty}>
          This run&rsquo;s test case requests no proof of implementation.
        </p>
      </Panel>
    );
  }

  const entries: AccordionEntry[] = proofs.map((proof) => ({
    path: proof.name,
    kind: proof.present ? proof.kind : "missing",
    body:
      proof.present && proof.url ? (
        <MediaView kind={proof.kind} url={proof.url} alt={proof.name} />
      ) : (
        <p className={styles.empty}>
          {proof.present
            ? "Proof media is not available here."
            : "The agent did not submit this proof."}
        </p>
      ),
  }));

  return (
    <SpecAccordion
      key={run.id}
      entries={entries}
      emptyLabel="This run submitted no proof of implementation."
    />
  );
}
