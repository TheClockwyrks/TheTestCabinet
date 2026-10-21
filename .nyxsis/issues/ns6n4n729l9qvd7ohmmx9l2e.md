---
format: nyxsis-issue
version: 3
id: ns6n4n729l9qvd7ohmmx9l2e
zone: SHELL
number: 1
title: Create the operator client as client-tauri
type: generic
state: open
depends_on:
  - nxs3up9tm7pi706lpgt12xkm
  - zwdbu3cf0k1byv4js6vtj29b
  - j10x004gco5coyozcwcqla2b
created: 2026-10-13T21:13:39.032189574Z
---

Operators reach the console through a browser only. The documentation
describes a Tauri v2 shell for Windows, Linux, macOS and Android that opens
the console in a WebView, signs in through Cloudflare Access inside it, and
is built once for prod and once for staging:
`apps/docs/src/content/docs/components/client/overview.md`,
`apps/docs/src/content/docs/development/releasing.md`, section "Releasing
the operator client", and
`apps/docs/src/content/docs/development/repositories.md`, sections "The
kinds" and "The repositories".

## What is missing

- The `client-tauri` repository on Azure, rendered by the repository kit as
  the `shell` kind, depending on `ui-common`, mirrored to GitHub.
- The shell crate and npm workspace, with the two builds and the affordances
  the client page's "What the shell handles" section lists.
- The pipeline building the unsigned bundles for the four targets in the
  kit's `android` image track and publishing them as tag artifacts.

## Verify

The staging bundle on an Android device and on a desktop opens the Microsoft
login page, lands in the console after sign-in, stays signed in across
launches, and `make gate` passes in the repository.

## Progress (branch issue/ns6n4n729l9qvd7ohmmx9l2e)

Done:

- The `android` CI image track: `ci/images/android.Dockerfile` (the Rust image
  plus the template's android image, `ANDROID_IMAGE` in the compose anchor),
  the image pipeline's `androidImage` job, the scripts and their tests. It is
  the project's own track; the template's Tauri answers stay false, and
  `building.md` and `ci/images/README.md` say so.
- The kit: `RUST_TRACKS` puts `client-tauri` on `android`; a shell's
  pipeline gets the `bundle` stage (linux, android, windows, macos jobs,
  artifacts `client-<target>`) running `scripts/ci/bundle.sh`, which builds
  each `tauri.<flavor>.conf.json` flavor.
- `client-tauri` exists on Azure (master, staging, nightly; branch policies),
  pipeline 168 (registry connection, queue and the secure file
  `github-mirror-key-client-tauri` authorized), the public GitHub mirror
  TheClockwyrks/client-tauri with its deploy key, and the submodule. Its
  nightly (aae2edf) holds the shell: prod and staging flavors, the injected
  script (new windows, downloads, clipboard, `tcab:resume`), a per-launch
  command token, the navigation guard, the Android Gradle project. Every gate
  passes locally; the checks job of run 18085 is green.
- ui-common b2e11d3 (nightly): the console reopens its stream on
  `tcab:resume`.
- The repository depends on nothing of the project, as the Repositories page
  states; the "depending on `ui-common`" above is superseded by the docs.

Remaining, after CICD-1 lets the image pipeline run:

1. Run `tcab-ci-images` on this branch's head, write that commit into
   `ci/images/tags.yml` as `ciImageTag`, and run
   `scripts/repos/render.py --update client-tauri` so its pipeline names the
   built android image; the Rust job of run 18085 failed pulling it.
2. Bring client-tauri's nightly through staging to master, then push the tag
   `v0.1.0` (the workspace version is 0.1.0) and check the bundle stage's
   four artifacts. The Android Gradle project (AGP 8.11, Kotlin 1.9.25) and the
   Windows and macOS bundles have not yet been built anywhere.
3. The Verify steps above on a device and a desktop with an operator's
   sign-in. A desktop staging build under xvfb reached the Microsoft sign-in
   page; nothing past sign-in was exercised.
