# Drop the desktop app

Remove the Tauri desktop app and everything that exists only to build, ship, or
document it, so the web console is the only console and the release route no
longer carries desktop artifacts.

## Current state

The desktop app is a Rust shell in `crates/desktop` and a React UI in
`apps/desktop`. It stands up its own k3d cluster from
`deployments/k8s/overlays/app`, which pulls published service images by the
`TCAB_DESKTOP_IMAGE_TAG` baked in at release time. It is built by
`scripts/build-desktop-linux.sh`, `scripts/build-desktop-macos.sh`, and
`scripts/ci/desktop-build.sh`, validated by the `desktop` job in
`azure-pipelines.yml`, and packaged by the `desktop` job in
`.github/workflows/release.yml`.

The Cargo workspace lists the crate as a member, gives it its own dev profile,
and pins the Tauri dependencies for it. The npm workspace lists `apps/desktop`.
Around 44 documentation pages refer to the Tauri app or the desktop app, the
`components/tauri` section has its own sidebar entry in `apps/docs/astro.config.mjs`,
and `CLAUDE.md` carries its component row.

Nothing in day-to-day use of The Test Cabinet runs through the desktop app.

## Design

Delete `crates/desktop`, `apps/desktop`, `deployments/k8s/overlays/app`, the two
`scripts/build-desktop-*.sh` scripts, and `scripts/ci/desktop-build.sh`. Remove
the `desktop` job from `azure-pipelines.yml`, the workspace member, the desktop
dev profile, and the Tauri dependency pins from `Cargo.toml`, and the
`apps/desktop` entry from the root `package.json` workspaces. Update the
run-record generator comments in `Cargo.toml` that list desktop among the build
kinds.

Remove every `TCAB_DESKTOP_IMAGE_TAG` reference: `build-service-images.yml`,
`release.yml`, the cutting-a-release guide, and the build scripts. Remove the
desktop references in `scripts/ci/build-context.sh`, `rust-lint.sh`,
`rust-test.sh`, and `scripts/ci/README.md`, and the mention in the
`containers/blender` Dockerfile.

Delete the `components/tauri` documentation section and its sidebar entry, and
the component row in `CLAUDE.md`. Rewrite each page that mentions the Tauri app or
the desktop app so the web console is the console it describes. The `canExecute`
flag in `packages/ui` stays, because the gallery mounts the shared application
with it false.

The changelog entry for the removal is written by
[the release issue](cut-v0-7-0-through-the-azure-release-route.md).

## Done when

- [ ] `crates/desktop`, `apps/desktop`, `deployments/k8s/overlays/app`, and the
      desktop build scripts are gone.
- [ ] `cargo build --workspace` and `npm run build` succeed with no desktop
      member or workspace.
- [ ] `git grep -i tauri` and `git grep TCAB_DESKTOP_IMAGE_TAG` match nothing
      outside `apps/docs/src/content/docs/changelogs/`.
- [ ] The docs site builds with no `components/tauri` section and no page that
      describes a desktop console.
- [ ] `CLAUDE.md` lists no desktop component.
- [ ] Gates green.
