---
title: Assets
---

A game names a path and the engine decides the URL. Every path resolves under
one fixed asset root, `assets/`, and every load the engine performs on the
game's behalf is recorded.

## One root

Resolution is the concatenation of the root and the path the game supplied, so a
build states where a file sits relative to the root and never constructs a URL.
The rule is enforced rather than assumed: a path with a leading slash, a `..`
segment, or a URI scheme names a location outside the root and is refused.

One root has two consequences. A build's asset requests all land inside the
run's produced tree, where they can be inspected alongside the code that asked
for them. And a driver reading the log can say exactly which files a build
wanted and which of them existed.

## Resolving and loading are separate

Loading fetches the asset, reads its body in full, and records the attempt.
Resolving is the pure half: it computes the URL and touches neither the network
nor the log, so a game that hands a URL to an `<img>` element or a stylesheet
does not invent a log entry for a load the engine never performed. The log
stays a record of what the engine actually did.

## The asset log

Each load appends exactly one entry, oldest first, naming the path the game
asked for, the URL it resolved to, and whether the body arrived. A refused path
is recorded with an empty URL, which is the unambiguous signature of a path the
engine rejected rather than a file that resolved and was missing. The log is
handed out as a copy, so a caller cannot edit the record of what the build
requested.

## The record

A failed load records the attempt and reports the cause to the game, which still
needs to know its texture never arrived. The frame loop continues either way, so
the log is the evidence that separates a build whose asset never arrived from a
build whose drawing is wrong.

A driver reading the log attributes a blank playfield to the specific file that
was asked for and did not arrive.
