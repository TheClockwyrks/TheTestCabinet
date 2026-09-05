import { useMemo } from "react";
import { Spinner } from "@clockwyrks/ui";
import type { ValidationMedia } from "../../../data/galleryContext";
import {
  ReplayCanvas,
  ReplayTransport,
  useRecording,
  type LoadedRecording,
} from "../replay/ReplayPlayer";
import { timelineFor, useReplayClock } from "../replay/useReplayClock";
import exec from "../RunExec.module.scss";

// One automated-validation output captured as an ENGINE REPLAY, shown as a
// side-by-side pair: the case's reference implementation beside this run's build.
//
// This is the same comparison the video pair makes, and it is made differently on
// purpose. Two clips are two independent media elements: playing them together
// means resetting `currentTime` on each and accepting that they drift apart, so a
// reviewer comparing frame 200 of one against frame 200 of the other is trusting
// two decoders to have kept step. Two recordings have no decoders and no clocks of
// their own — every frame of a recording is drawn from the state it carries, with
// no dependence on the frames before it — so the pair shares ONE clock and ONE
// frame index, and moving the scrubber puts both panes on the same frame by
// construction. That is what makes this evidence a reviewer can point at: the
// difference on screen is a difference between the two builds, not between two
// playbacks.
//
// Where the two recordings are not the same length the shorter pane clamps to its
// last frame rather than blanking: a build that stopped drawing early is itself
// the finding, and a blank pane reads as a player that broke. Each pane's label
// row carries its own recording's length, so two different figures across the row
// are what say the two builds did not draw for the same span.
export function ValidationReplayPair({ media }: { media: ValidationMedia }) {
  const baseline = useRecording(media.baselineUrl);
  const actual = useRecording(media.actualUrl);

  // One timeline over both recordings — the longer one paces the pair, so none of
  // its frames is unreachable. Memoized on the recordings so the array is built when
  // one arrives rather than on every frame the clock advances.
  const timeline = useMemo(
    () => timelineFor([baseline.recording, actual.recording]),
    [baseline.recording, actual.recording],
  );
  const clock = useReplayClock(timeline);

  const hasBaseline = media.baselineUrl !== null;
  const hasActual = media.actualUrl !== null;

  return (
    <figure className={exec.validationOutput}>
      <figcaption className={exec.validationOutputHeader}>
        <span className={exec.validationOutputName}>{media.name}</span>
      </figcaption>
      <div
        className={`${exec.mediaPanes}${
          hasActual && hasBaseline ? "" : ` ${exec.mediaPanesSingle}`
        }`}
      >
        {hasBaseline && (
          <figure className={exec.mediaPane}>
            <figcaption className={exec.mediaPaneLabel}>
              <span>Reference</span>
              <PaneLength side={baseline} />
            </figcaption>
            <ReplayPane
              side={baseline}
              frame={clock.frame}
              label={`Reference ${media.name}`}
              missing="The case ships no reference recording for this output."
            />
          </figure>
        )}
        <figure className={exec.mediaPane}>
          <figcaption className={exec.mediaPaneLabel}>
            <span>This run</span>
            <PaneLength side={actual} />
          </figcaption>
          <ReplayPane
            side={actual}
            frame={clock.frame}
            label={`This run ${media.name}`}
            missing="This run did not produce this output."
          />
        </figure>
      </div>
      {/* One transport under both panes: it drives the clock, and the clock is what
          each canvas draws from, so play, pause and every scrub move the reference
          and this run together. It is mounted as soon as either side has a
          recording to fetch — its controls disable themselves until one arrives,
          which keeps the row from appearing under the panes mid-load. */}
      {(hasBaseline || hasActual) && <ReplayTransport clock={clock} />}
    </figure>
  );
}

/**
 * How long this side's recording is, sat at the right edge of the pane's label
 * row — flush with the right edge of the viewport under it.
 *
 * It is the only place the pair states a recording's length: a reviewer reads the
 * two figures across the row against each other, and a shorter one is a build that
 * stopped drawing while the other went on. Nothing is shown while the recording is
 * still on its way or when there is none — the pane itself says what became of it.
 */
function PaneLength({ side }: { side: LoadedRecording }) {
  const frames = side.recording?.frames.length ?? 0;
  if (frames === 0) return null;
  return (
    <span className={exec.mediaPaneLength}>
      {frames} {frames === 1 ? "frame" : "frames"}
    </span>
  );
}

/**
 * One side of the pair: the recording, once it is there, or what became of it.
 *
 * A recording shorter than its partner is not annotated here — asked for a frame
 * past its end, the canvas goes on showing its last one, and the length in the
 * label row above is what says where it ran out.
 */
function ReplayPane({
  side,
  frame,
  label,
  missing,
}: {
  side: LoadedRecording;
  frame: number;
  label: string;
  /** What to say when there is no recording on this side at all. */
  missing: string;
}) {
  if (side.error !== null) {
    return <p className={exec.mediaMissing}>{side.error}</p>;
  }
  if (side.loading) {
    return <Spinner variant="flap" label="Loading the replay…" />;
  }
  const { recording, resources } = side;
  // The two arrive together — the recording is not published until its images are
  // decoded — so a recording without resources is a side that has not loaded.
  if (recording === null || resources === null) {
    return <p className={exec.mediaMissing}>{missing}</p>;
  }
  if (recording.frames.length === 0) {
    return (
      <p className={exec.mediaMissing}>This recording captured no frames.</p>
    );
  }
  return (
    <ReplayCanvas
      recording={recording}
      resources={resources}
      frame={frame}
      label={label}
    />
  );
}
