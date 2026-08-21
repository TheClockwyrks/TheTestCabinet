import { useMemo } from "react";
import type { ValidationMedia } from "../../../data/galleryContext";
import {
  ReplayCanvas,
  ReplayTransport,
  useRecording,
  type LoadedRecording,
} from "../replay/ReplayPlayer";
import { timelineFor, useReplayClock } from "../replay/useReplayClock";
import exec from "../RunExec.module.scss";
import styles from "../replay/ReplayPlayer.module.scss";

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
// last frame and says so, rather than blanking: a build that stopped drawing
// early is itself the finding, and a blank pane reads as a player that broke.
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
            <figcaption className={exec.mediaPaneLabel}>Reference</figcaption>
            <ReplayPane
              side={baseline}
              frame={clock.frame}
              frames={timeline.length}
              label={`Reference ${media.name}`}
              missing="The case ships no reference recording for this output."
            />
          </figure>
        )}
        <figure className={exec.mediaPane}>
          <figcaption className={exec.mediaPaneLabel}>This run</figcaption>
          <ReplayPane
            side={actual}
            frame={clock.frame}
            frames={timeline.length}
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
 * One side of the pair: the recording, once it is there, or what became of it.
 *
 * `frames` is the length of the whole pair's timeline rather than this side's, so
 * a recording shorter than its partner can say where it runs out — the pane goes on
 * showing its last frame from there, which is what the canvas does with a frame
 * index past its end.
 */
function ReplayPane({
  side,
  frame,
  frames,
  label,
  missing,
}: {
  side: LoadedRecording;
  frame: number;
  frames: number;
  label: string;
  /** What to say when there is no recording on this side at all. */
  missing: string;
}) {
  if (side.error !== null) {
    return <p className={exec.mediaMissing}>{side.error}</p>;
  }
  if (side.loading) {
    return <p className={exec.mediaMissing}>Loading the replay…</p>;
  }
  const { recording } = side;
  if (recording === null) {
    return <p className={exec.mediaMissing}>{missing}</p>;
  }
  if (recording.frames.length === 0) {
    return (
      <p className={exec.mediaMissing}>This recording captured no frames.</p>
    );
  }
  const short = recording.frames.length < frames;
  return (
    <>
      <ReplayCanvas recording={recording} frame={frame} label={label} />
      {short && (
        <p className={styles.note}>
          This recording ends at frame {recording.frames.length} of {frames}
          {frame >= recording.frames.length
            ? " — it is holding on its last frame."
            : "; it holds on its last frame from there."}
        </p>
      )}
    </>
  );
}
