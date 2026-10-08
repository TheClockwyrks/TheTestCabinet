import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import type { ModelSpec } from "@clockwyrks/run-record";
import { parseGlb, type PartMesh } from "@clockwyrks/voxel-runtime";
import { Suspense, lazy, useEffect, useState } from "react";

import { MediaView } from "./MediaView";
import { prefersReducedMotion, supportsWebGL } from "./webgl";
import {
  previewedFiles,
  type SuiteAssetPreviewKind,
} from "../data/suite-asset-files";
import { GuardedVoxelViewer } from "../pages/runs/[runId]/GuardedVoxelViewer";

// How a test suite's bundled asset is played, one kind at a time.
//
// A suite asset is the same produced thing a run emits — a meshed voxel model, a
// particle system, a sheet, a score — so it is played through the same runtimes
// and the same viewers the run surfaces use rather than through a second
// implementation of any of them. What this component adds is the resolution from
// an `asset.toml`'s declared file list to the viewer that covers it: the suite
// format declares files, not a rig, so the geometry of a model is read out of the
// `.glb` each declared mesh is, exactly as the run viewer reads it.
//
// The caller supplies a URL per declared file, because only it knows how the bytes
// are served — The Spec Cabinet through its own byte route, the console through the
// backend's. A kind with nothing to play renders nothing, and the caller lists the
// files instead.

// `three` (and the drei/runtime bindings) are heavy, so each viewer is its own
// chunk, fetched only when a WebGL-capable browser actually mounts it.
const ParticleViewer = lazy(
  () => import("../pages/runs/[runId]/ParticleViewer"),
);
const BlenderCharacterViewer = lazy(
  () => import("../pages/runs/[runId]/BlenderCharacterViewer"),
);

/** The part name a mesh file stands for: its file stem, with no directory. */
function partName(file: string): string {
  const name = file.split("/").pop() ?? file;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** A single-part rig whose one part carries the whole mesh — what a declared
 * `.glb` is on its own, the same rig the live run view poses a static model with. */
function staticRig(part: string): ModelSpec {
  return { parts: [{ name: part, pivot: [0, 0, 0] }], joints: [] };
}

/** Whether the browser will paint WebGL and the user has not asked it not to.
 * Decided once per mounted viewer, when it first renders: neither GUI renders on
 * a server, so the probe always has a document to create its canvas in. */
function useWebGL(): boolean {
  const [enabled] = useState(() => supportsWebGL() && !prefersReducedMotion());
  return enabled;
}

/** A failed fetch's message, held against the URL it was for, so a viewer whose
 * URL changes stops reporting the old one's failure without resetting it. */
interface Failure {
  url: string;
  message: string;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const STAGE: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  height: 320,
  background: "var(--tc-panel-2, #1c1c1c)",
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
  overflow: "hidden",
};

/** What a viewer says while its bytes are on the way, or when they did not load. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...STAGE, display: "grid", placeItems: "center" }}>
      <span>{children}</span>
    </div>
  );
}

/** One declared mesh, decoded from its `.glb` and posed as a static model. */
function MeshPreview({ url, label }: { url: string; label: string }) {
  const enabled = useWebGL();
  const [mesh, setMesh] = useState<PartMesh | null>(null);
  const [failed, setFailed] = useState<Failure | null>(null);
  const failure = failed?.url === url ? failed.message : null;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        return response.arrayBuffer();
      })
      .then((bytes) => {
        if (active) setMesh(parseGlb(bytes));
      })
      .catch((error: unknown) => {
        if (active) setFailed({ url, message: failureMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [enabled, url]);

  if (!enabled) return <Note>live preview unavailable</Note>;
  if (failure !== null)
    return (
      <Note>
        could not load {label}: {failure}
      </Note>
    );
  return mesh === null ? (
    <Note>loading…</Note>
  ) : (
    <div style={STAGE}>
      <GuardedVoxelViewer
        meshes={mesh}
        rig={staticRig(partName(label))}
        mode="auto-rotate"
        fallbackUrl={null}
        label={label}
      />
    </div>
  );
}

/** The declared particle system, simulated by the particle runtime. */
function ParticlePreview({ url, label }: { url: string; label: string }) {
  const enabled = useWebGL();
  const [system, setSystem] = useState<ParticleSystem | null>(null);
  const [failed, setFailed] = useState<Failure | null>(null);
  const failure = failed?.url === url ? failed.message : null;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        return response.json() as Promise<ParticleSystem>;
      })
      .then((parsed) => {
        if (active) setSystem(parsed);
      })
      .catch((error: unknown) => {
        if (active) setFailed({ url, message: failureMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [enabled, url]);

  if (!enabled) return <Note>live preview unavailable</Note>;
  if (failure !== null)
    return (
      <Note>
        could not load {label}: {failure}
      </Note>
    );
  return system === null ? (
    <Note>loading…</Note>
  ) : (
    <div style={STAGE}>
      <Suspense fallback={<Note>loading…</Note>}>
        <ParticleViewer system={system} blend="additive" label={label} />
      </Suspense>
    </div>
  );
}

/** The declared glTF, played through the native glTF player. */
function BlenderPreview({ url, label }: { url: string; label: string }) {
  const enabled = useWebGL();
  return enabled ? (
    <div style={STAGE}>
      <Suspense fallback={<Note>loading…</Note>}>
        <BlenderCharacterViewer
          url={url}
          animationName={null}
          loop
          mode="auto-rotate"
          label={label}
        />
      </Suspense>
    </div>
  ) : (
    <Note>live preview unavailable</Note>
  );
}

/**
 * The preview for one bundled asset, or `null` when none of its declared files is
 * something this build can play — in which case the caller lists the files, which
 * is the whole of what there is to say about them.
 *
 * `urlFor` resolves a declared path to the URL its bytes are served at, and
 * answers `null` for a path the asset folder does not hold: a declared file with
 * nothing behind it is a diagnostic against the asset, reported where the asset is
 * edited rather than staged here as a broken viewer.
 */
export function SuiteAssetPreview({
  kind,
  name,
  files,
  urlFor,
}: {
  /** The asset's `kind`, which selects the runtime its files are played through. */
  kind: SuiteAssetPreviewKind;
  /** The asset's display name, used to label each viewer. */
  name: string;
  /** The paths the manifest declares, relative to the asset folder. */
  files: readonly string[];
  /** The URL one declared path's bytes are served at, or null for one missing. */
  urlFor: (file: string) => string | null;
}) {
  /** The files this kind's viewer covers that actually have bytes behind them. */
  const resolved = (): [string, string][] =>
    previewedFiles(kind, files).flatMap((file) => {
      const url = urlFor(file);
      return url === null ? [] : [[file, url] as [string, string]];
    });

  if (kind === "sprite" || kind === "sprite-sheet") {
    const images = resolved();
    return images.length === 0 ? null : (
      <div className="asset-previews">
        {images.map(([file, url]) => (
          <figure key={file} className="asset-preview">
            <MediaView kind="image" url={url} alt={`${name} — ${file}`} />
            <figcaption>{file}</figcaption>
          </figure>
        ))}
      </div>
    );
  }

  if (kind === "voxel" || kind === "blender") {
    const meshes = resolved();
    return meshes.length === 0 ? null : (
      <div className="asset-previews">
        {meshes.map(([file, url]) => (
          <figure key={file} className="asset-preview">
            {kind === "blender" ? (
              <BlenderPreview url={url} label={`${name} — ${file}`} />
            ) : (
              <MeshPreview url={url} label={file} />
            )}
            <figcaption>{file}</figcaption>
          </figure>
        ))}
      </div>
    );
  }

  if (kind === "particle") {
    const systems = resolved();
    return systems.length === 0 ? null : (
      <div className="asset-previews">
        {systems.map(([file, url]) => (
          <figure key={file} className="asset-preview">
            <ParticlePreview url={url} label={`${name} — ${file}`} />
            <figcaption>{file}</figcaption>
          </figure>
        ))}
      </div>
    );
  }

  const clips = resolved();
  return clips.length === 0 ? null : (
    <div className="asset-previews">
      {clips.map(([file, url]) => (
        <figure key={file} className="asset-preview">
          <audio controls src={url} aria-label={`${name} — ${file}`} />
          <figcaption>{file}</figcaption>
        </figure>
      ))}
    </div>
  );
}
