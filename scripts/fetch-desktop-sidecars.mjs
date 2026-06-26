// Download the k3d + kubectl sidecar binaries the desktop app bundles.
//
// The shipped desktop app stands up its own k3d cluster (see
// `crates/desktop/src/cluster.rs`) and so ships `k3d` and `kubectl` as Tauri
// **externalBin** sidecars: at runtime they sit beside the app executable, where
// the shell resolves and runs them (falling back to `PATH` in development).
//
// Tauri requires one binary per target triple, named `<name>-<triple>[.exe]`, so
// this fetches the right OS/arch build of each tool into
// `crates/desktop/binaries/`. The release workflow runs this for the matrix triple
// before `cargo tauri build` (which is invoked with a `--config` that adds the
// `externalBin` entries); the committed `tauri.conf.json` deliberately omits them
// so a plain `cargo tauri build`/`tauri dev` needs no downloaded binaries.
//
// Usage:
//   node scripts/fetch-desktop-sidecars.mjs <rust-target-triple>
//   node scripts/fetch-desktop-sidecars.mjs            # defaults to the host triple
//
// Pin the tool versions via env (K3D_VERSION / KUBECTL_VERSION) for reproducible
// installers; both default to a known-good release below.

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { arch as hostArch, platform as hostPlatform } from "node:os";

const K3D_VERSION = process.env.K3D_VERSION ?? "v5.7.5";
const KUBECTL_VERSION = process.env.KUBECTL_VERSION ?? "v1.31.3";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "crates", "desktop", "binaries");

// Map a Rust target triple to the OS/arch tokens k3d and kubectl name their
// release assets with, plus whether the platform suffixes `.exe`.
const TARGETS = {
  "x86_64-unknown-linux-gnu": { os: "linux", arch: "amd64", exe: false },
  "aarch64-unknown-linux-gnu": { os: "linux", arch: "arm64", exe: false },
  "x86_64-apple-darwin": { os: "darwin", arch: "amd64", exe: false },
  "aarch64-apple-darwin": { os: "darwin", arch: "arm64", exe: false },
  "x86_64-pc-windows-msvc": { os: "windows", arch: "amd64", exe: true },
};

// Resolve the host's Rust target triple when none is given, so a developer can run
// the script bare to build a local bundle.
function hostTriple() {
  const os = {
    linux: "unknown-linux-gnu",
    darwin: "apple-darwin",
    win32: "pc-windows-msvc",
  }[hostPlatform()];
  const arch = { x64: "x86_64", arm64: "aarch64" }[hostArch()];
  if (!os || !arch) {
    throw new Error(`unsupported host ${hostPlatform()}/${hostArch()}`);
  }
  return `${arch}-${os}`;
}

async function download(url, dest, executable) {
  process.stdout.write(`  ${url}\n`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, bytes);
  if (executable) await chmod(dest, 0o755);
}

async function main() {
  const triple = process.argv[2] ?? hostTriple();
  const target = TARGETS[triple];
  if (!target) {
    throw new Error(
      `unknown target triple \`${triple}\`. Known: ${Object.keys(TARGETS).join(", ")}`,
    );
  }
  const { os, arch, exe } = target;
  const suffix = exe ? ".exe" : "";

  await mkdir(outDir, { recursive: true });
  console.log(`Fetching desktop sidecars for ${triple} → ${outDir}`);

  // k3d ships a single self-contained binary per OS/arch as a GitHub release asset.
  await download(
    `https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-${os}-${arch}${suffix}`,
    join(outDir, `k3d-${triple}${suffix}`),
    !exe,
  );

  // kubectl is served from the Kubernetes release CDN under <os>/<arch>/kubectl.
  await download(
    `https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/${os}/${arch}/kubectl${suffix}`,
    join(outDir, `kubectl-${triple}${suffix}`),
    !exe,
  );

  console.log("Done.");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
