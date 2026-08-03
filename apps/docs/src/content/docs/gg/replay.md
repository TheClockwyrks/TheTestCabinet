---
title: "Replay"
---

Deterministic session replay: every gg run records enough of itself to **replay it
exactly** afterward. It exists because a surprising outcome across a deep
[agent tree](/gg/subagents/) is otherwise very hard to chase down — and a surprising
outcome is by definition not one anybody predicted, which is why capture is no longer
something you switch on beforehand.

:::note
Capture is **always on**. It used to be an opt-in capability; the
[content-addressed record format](/gg/analysis/replay-records/) made a session cost
well under a megabyte to record, and at that price the switch bought nothing. The
`replay` capability still exists, but it now escalates a run to **full fidelity**
rather than deciding whether the run is recorded at all.

The reconstruction half of the redesign — a playback that drives the real turn loop
instead of walking the record — is specified under
[gg analysis](/gg/analysis/overview/): see [playback](/gg/analysis/playback/).
:::

The [telemetry](/gg/telemetry/) stream is already most of the capture; replay
additionally pins the non-deterministic inputs so a run reconstructs step for step:

- the **model I/O** — each agent's prompts and responses,
- the **tool results** — what each tool call actually returned, and
- the **prompt frame** — the window as gg built it, with each item's slot, retention,
  turn and paged region, which is recoverable from no other artifact.

A replay driver then re-runs the session from that record, letting a developer step
through exactly what each agent saw and did. This is the same instinct as The Test
Cabinet's [Foray](/testing/adversarial/foray/architecture/) replays, applied to gg.

Because replay capture is additive to the telemetry schema, the schema is shaped
with replay in mind: the reserved per-agent identity fields the telemetry already
carries are what let a captured record reconstruct a deep agent tree step for step.

## The two fidelities

| Input | Standard — every run | Full — the `replay` capability |
| --- | --- | --- |
| Model I/O and model errors, tool outcomes, orchestrator `git`, the cancel probe, the deadline clock, the prompt frame | recorded | recorded |
| Latency clock reads | — | recorded |
| Startup filesystem loads (skills, memories, autoloaded files, templates) | digested | verbatim |
| Payload truncation | may apply | never |

The escalation is read from **any** agent in the
[configuration](/gg/configurations/), not just the root: enabling it on the one
profile whose turns are under suspicion is the natural thing to do, and it is what
the capability is for. The fidelity a run captured at is recorded on the record
itself, so an absent full-only input reads as "this run was not recorded that
closely" rather than as "the session did not have one".

A per-run byte ceiling (`replayMaxBytes`, among the run's
[execution limits](/gg/execution-limits/)) bounds the worst case — 256 MiB unless a
configuration says otherwise; the console's editor offers it as **Replay journal (MiB)**
and writes the byte count itself. Crossing it stops capture and marks the record
truncated: **capture degrades, it never fails the run it observes.**

## Replaying from the command line

Two binaries reconstruct records, and they say the same things because they share one
front end.

```sh
tcab gg-replay <RUN_ID>                     # fetch the record from the backend
tcab gg-replay --record <FILE>              # or read one off disk
tcab gg-replay <RUN_ID> --steps steps.json  # also write the per-agent step-through
gg replay --record <FILE>                   # gg reconstructing a record itself
```

A record is read however it was obtained: a run tree's copy is `replay.json.gz`,
`GET /runs/{id}/replay` serves plain JSON, and both shapes — in either format version —
are accepted, so nothing has to be unpacked or converted first.

`--record` names a **file** and the run id is a **positional**, which is not an
arbitrary split: the flag shipped first, and quietly respelling an existing invocation
breaks every script that used it. The same reasoning is why `gg --config <PATH>` — the
only way `core` has ever launched gg — stays valid now that gg has subcommands, as an
implied `gg run`.

### `--gg`, and reconstructing with the build that recorded

`tcab gg-replay --gg <VERSION|PATH>` hands the whole reconstruction to a *different* gg —
a published release resolved by version (downloaded once and cached), or a binary already
on disk — and `tcab` becomes a pass-through for its output.

This is the escape hatch for the direction `formatVersion` cannot rescue. A record from a
**newer** gg is refused outright, and a record from a much **older** one may pin inputs the
current build no longer models; the build that wrote a record can always read it, and the
record's own `recorder` block names it — which is why the banner prints that version before
delegating. It is also why `gg replay` exists on every release rather than only in `tcab`:
the delegation *is* `gg replay --record <FILE>`, so a build that cannot be asked to replay
cannot be delegated to.

`--gg` never guesses. A spec that names a path which does not exist is an error rather than
a version, because reinterpreting a typo'd path as a release is how a 404 ends up being
reported as the wrong problem.

## Reading a record in the console

Every finished gg run links to its **Replay** view, from the run's gg tab and from the
live monitor's terminal outcome. It walks the record turn by turn — one step per model
call of one agent — with the agents to filter by, arrow keys to step, and a jump slider.

Each step shows what the agent **saw** and what it **did**, using the same message rows
the [Requests](/gg/context-visibility/) view renders, so a message reads identically
whether you reached it from the telemetry stream or from the record. Three things are
only on this view:

- the **Context column**, from the turn's [prompt frame](/gg/analysis/replay-records/) —
  each message's band, whether it is pinned or ephemeral, the session turn it was pushed
  on, and a view's selector — a paged file view as `path@offset+limit`, an
  [agent view](/gg/responses-as-code/#showing-yourself-things) as its bare label. It is the
  only place gg's window construction is visible after the fact;
- **images**, resolved out of the blob pool and shown inline rather than as descriptors —
  the telemetry stream deliberately records an image's media type and size and never its
  bytes;
- everything the turn consumed **besides** the model call: the tool outcomes, the
  orchestrator's own `git`, a completion gate's validation commands, the cancel probe and
  the deadline clock.

Two notices lead the view where they apply, and both are statements about the *capture*
rather than about the run. A record written before format v2 walks behind an
**older-gg banner** — it pins model I/O and tool results and nothing else, so the Context
column is empty, and saying so is what keeps a gap in the recording from reading as a
gap in the run. A **truncated** record says why capture stopped and where it still holds
(the byte ceiling above, a killed session, a damaged journal). A record from a **newer** gg is refused outright rather than walked: it can
carry inputs the console has never heard of, and a partial walk would look complete.
