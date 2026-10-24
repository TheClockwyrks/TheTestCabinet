---
title: "Assets"
---

The Spec Cabinet integrates with The Test Cabinet's asset generation features
and code, so a suite's assets are authored, imported, and edited in the same
place the rest of the suite is.

Assets are authored in a draft and ship with every version exported from that
draft. The on-disk format for an asset and its metadata is owned by
[Assets](/test-suites/assets/).

## Specifications

Every asset carries a specification whose requirements are all non-functional.
All specification details are editable from within The Spec Cabinet's UI.

## Importing Assets

Users may also opt to import assets produced by a run rather than authoring them
in place. A draft's assets are commonly imported before the draft is complete,
since a suite needs its full stack test case and asset specifications to produce
them but needs the assets to offer an end to end test case.

Importing requires the local k3d cluster for The Test Cabinet to be up, and
proceeds in the following order:

1. Preview the draft, which ingests its complete test case definitions into the
   local Test Cabinet. See [Previews](/the-spec-cabinet/test-suites/#previews).
2. Run the preview's full stack test case one or more times.
3. Import a completed run into The Spec Cabinet from the k3d cluster.
4. Extract the assets from the imported run and save them into the draft.

## Generating Test Cases

The Spec Cabinet exposes support for auto-generating a test case definition from
any asset in a draft. This allows users to quickly and easily create new asset
generation test cases for a test suite. These cases can be batch-generated to
produce an asset generation test case for every asset in the draft, or generated
on an asset-by-asset basis.

Generation writes a test case definition file whose `type` is the test case type
matching the asset's kind, carrying that type's own
[asset table](/test-suites/test-case-definition/) with an `id` naming the asset
it was generated from.
