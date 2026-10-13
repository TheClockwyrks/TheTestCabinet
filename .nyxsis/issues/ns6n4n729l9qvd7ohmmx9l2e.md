---
format: nyxsis-issue
version: 2
id: ns6n4n729l9qvd7ohmmx9l2e
zone: SHELL
number: 1
title: Create the operator client as client-tauri
type: generic
state: open
depends_on:
  - nxs3up9tm7pi706lpgt12xkm
  - zwdbu3cf0k1byv4js6vtj29b
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
