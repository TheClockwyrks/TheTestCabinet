---
format: nyxsis-issue
version: 2
id: mkwwaowuuf9kuvps1wmow2pi
zone: DATA
number: 1
title: Make the artifacts service the write-through store over Blob and R2
type: generic
state: done
created: 2026-10-13T21:12:10.380402675Z
done: 2026-10-19T05:09:23.157620215Z
---

The artifacts service locates run trees that other components write. The
documentation makes it the one writer of both object stores, receiving a run
tree as an upload from the driver, holding it in the private Blob container,
and copying what a publish makes public into the R2 bucket:
`apps/docs/src/content/docs/components/artifacts/overview.md`.

## What is missing

- The routes the page's "Routes" section lists, the upload as the driver's
  tar of the run tree, `PUT /public/{key}` and the media publish of the
  "Publishing a run's media" section, authenticated as the "Auth" section
  states.
- The private container and the public bucket configured as the "Object
  stores" and "Deployment" sections state, with Azurite standing in for both
  on the local overlay as
  `apps/docs/src/content/docs/development/running.md` describes.
- The driver uploading the run tree through the service at run end, as
  `apps/docs/src/content/docs/components/driver/overview.md` states.

## Verify

A run on the local stack ends with its tree in the emulator's private
container, served back through the console, and `make gate` passes in the
artifacts and driver checkouts.
