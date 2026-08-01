---
title: "Replay"
---

Deterministic session replay: record enough of a gg run to **replay it exactly**
afterward. This is a **debugging tool only** — it is not part of a normal run's
result surface and is not intended for everyday use. It exists because a surprising
outcome across a deep [agent tree](/gg/subagents/) is otherwise very hard to chase
down.

:::note
This page describes replay as the capability stands today. Its redesign — a
content-addressed record format, always-on capture, and a reconstruction that
drives the real turn loop — is specified under
[gg analysis](/gg/analysis/overview/): see
[replay records](/gg/analysis/replay-records/) and
[playback](/gg/analysis/playback/).
:::

The [telemetry](/gg/telemetry/) stream is already most of the capture; replay
additionally pins the non-deterministic inputs so a run reconstructs step for step:

- the **model I/O** — each agent's prompts and responses, and
- the **tool results** — what each tool call actually returned.

A replay driver then re-runs the session from that record, letting a developer step
through exactly what each agent saw and did. This is the same instinct as The Test
Cabinet's [Foray](/testing/adversarial/foray/architecture/) replays, applied to gg.

Because replay capture is additive to the telemetry schema, the schema is shaped
with replay in mind: the reserved per-agent identity fields the telemetry already
carries are what let a captured record reconstruct a deep agent tree step for step.
