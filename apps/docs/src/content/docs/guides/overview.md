---
title: User Guides
---

User guides are the detailed, end-to-end walkthroughs of the tasks people
perform with The Test Cabinet. Where a [quickstart](/quickstarts/overview/) gives
just the steps for someone who already knows the tool, a user guide states the
prerequisites, the exact commands, and the reasoning behind the design choices
along the way.

If you only need a refresher, the matching quickstart is faster. Reach for the
guide when you are doing the task for the first time, or when you need to know
*why* a step is the way it is.

## Guides

- [First Time Setup](/guides/first-time-setup/) — install the toolchain,
  container runtime, run-container image, browser, and credentials, then make a
  first run.
- [Running the Local Service Stack](/guides/running-the-local-service-stack/) —
  stand up the backend, auth, dispatcher, driver, artifact service, and web
  console on local k3d, and drive runs the way a deployment does.
- [Authoring an End-to-End Test Case](/guides/authoring-an-end-to-end-test-case/)
  — write a new playable-game case or version: its specification, prompt,
  references, and manifest.
- [Authoring an Asset-Generation Test Case](/guides/authoring-an-asset-generation-test-case/)
  — write a new sprite-drawing case or version: its brief, target, operations
  schema, and manifest.
- [Creating an End-to-End Variant](/guides/creating-an-end-to-end-variant/) — add
  a new playable mode to an existing end-to-end version.
- [Creating a Single-Sprite Variant](/guides/creating-a-sprite-variant/)
  — add a brief variation against the shared target of a single-sprite
  asset-generation version (`asset_kind = "sprite"`).
- [Creating a Sprite-Sheet Variant](/guides/creating-a-sprite-sheet-variant/)
  — add a brief variation against the shared target sheet of a sprite-sheet
  asset-generation version (`asset_kind = "sprite-sheet"`).
- [Reviewing Test Run Results](/guides/reviewing-test-run-results/) — play a
  finished run, read its validation signals, and write the required review.
- [Publishing a Test Run Result](/guides/publishing-a-test-run-result/) — release
  a reviewed run to public hosting and the gallery.
- [Rolling Production Service Images](/guides/rolling-prod-service-images/) —
  promote a CI-built service-image sha to the production cluster: re-pin the
  overlay, apply it through the private cluster, and commit.

These guides describe how to *use* The Test Cabinet. To understand how it works
internally, see the [Components](/components/architecture/) section.
