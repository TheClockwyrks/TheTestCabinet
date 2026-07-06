import type { AudioResultView } from "../../../data/galleryContext";
import styles from "./RunDetailPages.module.scss";

/** A `m:ss.mmm`-ish readout of a clip length in milliseconds. */
function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return minutes > 0
    ? `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`
    : `${seconds.toFixed(2)}s`;
}

/**
 * The generated-asset result for an audio asset-generation run
 * (`sfx-synth`/`sfx-sample`/`music`). The emitted `clip.wav` is the scored artifact:
 * it is played with an `<audio>` element (the clip as the reviewer hears it), with the
 * rendered **waveform + spectrogram** (and, for music, the **piano-roll**) preview
 * shown alongside as the honest visual substitute for the sound, plus the format
 * readout and the portable `.mid` score when a `music` run emits one.
 *
 * Imported by {@link AssetResultSection}, which mounts it when the run carries
 * `validation.audio`.
 */
export function AudioResultSection({ view }: { view: AudioResultView }) {
  return (
    <>
      <h3 className={`${styles.section} ${styles.leadHeading}`}>Audio clip</h3>
      <p className={styles.secondary}>
        The emitted clip is the scored artifact — play it against the brief. The
        rendered waveform and spectrogram are the honest visual substitute for the
        sound.
      </p>

      {view.clipUrl ? (
        <audio
          controls
          src={view.clipUrl}
          style={{ width: "100%", maxWidth: 520, display: "block" }}
          aria-label="Audio clip"
        >
          Your browser does not support the audio element.
        </audio>
      ) : (
        <p className={styles.secondary}>The clip could not be served.</p>
      )}

      {view.previewUrl ? (
        <figure style={{ margin: "16px 0 0", textAlign: "center" }}>
          <img
            src={view.previewUrl}
            alt="Waveform and spectrogram"
            style={{
              width: "100%",
              maxWidth: 640,
              background: "var(--tc-panel-2, #1c1c1c)",
              border: "1px solid var(--tc-border, #444)",
              borderRadius: 4,
            }}
          />
          <figcaption className={styles.sequenceSub} style={{ marginTop: 6 }}>
            waveform / spectrogram
          </figcaption>
        </figure>
      ) : null}

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "4px 16px",
          marginTop: 16,
        }}
      >
        <dt>Format</dt>
        <dd>
          {(view.sampleRate / 1000).toFixed(1)} kHz ·{" "}
          {view.channels === 1
            ? "mono"
            : view.channels === 2
              ? "stereo"
              : `${view.channels} ch`}{" "}
          · {formatDuration(view.durationMs)}
        </dd>
        {view.midiUrl ? (
          <>
            <dt>Score</dt>
            <dd>
              <a href={view.midiUrl} target="_blank" rel="noreferrer">
                clip.mid
              </a>
            </dd>
          </>
        ) : null}
      </dl>
      {view.detail ? <p className={styles.secondary}>{view.detail}</p> : null}
    </>
  );
}
