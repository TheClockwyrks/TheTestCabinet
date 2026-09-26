---
title: Live Streaming
---

Part of the work a run does happens inside the run container. The most visible
case is the drawing an [asset-generation](/testing/asset-generation/overview/)
run does through its [in-container
binary](/testing/asset-generation/sprite-binaries/). A person watching that run
sees the progress as it happens rather than only the finished result.

This page defines the pattern The Test Cabinet uses to stream live data out of a
sandboxed in-container process, back to the run host, and onward to a viewer.
The asset-generation [live
preview](/testing/asset-generation/sprite-binaries/#live-preview) is the worked
example of every step.

## Channel selection

Streaming live progress out of a run takes a dedicated network channel. A run's
working tree lives on an anonymous container volume that is copied out only when
the run finishes, and a subprocess's standard output is mediated by the agent
harness, which decides what it forwards and may truncate it. The host therefore
opens a network listener that the in-container process connects back to
directly.

## The pattern

```
in-container binary ──TCP──▶ host listener (core) ──▶ driver
                                                       └─▶ backend relay
                                                             └─▶ console
```

1. The host opens a listener. The core binds an ephemeral TCP port on the run
   host for the lifetime of the run and mints an opaque per-run token. The
   listener is tied to the run and is torn down when the run ends. An ephemeral
   port per run keeps concurrent runs from colliding, and the token causes a
   connection from another run to be rejected.

2. The endpoint is seeded into the container. The host writes its `host:port`
   and token into the configuration the in-container binary reads. For the
   drawing tool that is the `live` block of `draw.config.json`. The host address
   is `host.docker.internal`, mapped into the container as described in
   [Containerization](/components/core/execution/#containerization).

3. The in-container process streams updates. As it works, the binary connects
   back to the seeded endpoint and sends each update as a framed message
   carrying the token plus a payload. The send is best-effort, using short
   timeouts and swallowing every error, so the work it reports on succeeds even
   when the listener is slow or gone.

4. The listener decodes and hands off. The core validates the token, decodes the
   payload into a typed value, and passes it to the runner, concurrently with
   the harness session.

5. The runner relays it over the run's live channel. The
   [driver](/components/driver/overview/) posts each payload to the
   [backend](/components/backend/overview/), which keeps the latest payload per
   key and fans it out on the run's live NDJSON stream as a tagged line that a
   subscriber tells apart from a [harness event](/components/core/events/) by
   its `type`. The [UI library](/components/ui/overview/) consumes it and renders
   the live view.

## Properties

- Opened per run type. The core opens the listener for the run types that stream
  progress, currently asset-generation, and only when the runner accepts the
  payloads.
- Best-effort. Dropped or skipped updates are acceptable. The authoritative
  output is the collected working tree.
- Transient. Live payloads are a real-time view and are absent from the run
  record. The backend keeps the latest payload per key so a viewer that connects
  mid-run sees the current state.
- Bounded. The listener caps the size of a frame it will accept and the time it
  will spend reading one, so a malformed or stalled client cannot exhaust memory
  or hold the listener open.

## Transport constraints

- The listener binds `0.0.0.0`. The container reaches the host on the
  host-gateway address rather than loopback, so the listener must be reachable
  on the host's external interfaces. The port is exposed on the local network
  for the run's duration. The token gates content, and only non-authoritative
  view data crosses it.
- TCP. A host-bound TCP port works uniformly across Docker, Podman, and the
  Kubernetes runtime, which makes it the portable default.
- `host-gateway` resolution. Docker and Podman both resolve `host-gateway` to a
  host-reachable address.

## Adding a new instance

To stream a different kind of live progress, reuse the seams above rather than
adding a transport.

1. In the in-container binary, read an optional live endpoint from its seeded
   config and send a framed, token-tagged update at each step, best-effort.
2. In the core, define the payload type and have the run lifecycle start the
   listener, seed the endpoint, and add the host mapping.
3. In the driver, post each payload to the backend for relay on the run's live
   stream.
4. In the UI, render the live view.
