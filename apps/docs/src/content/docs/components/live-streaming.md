---
title: Live Streaming
---

Some of the work a run does happens **inside the run container** — most visibly
the drawing an [asset-generation](/testing/asset-generation/overview/) run does
through the [`draw` binary](/testing/asset-generation/sprite-binaries/). When a person is
watching that run, we want to show them the progress *as it happens*, not just the
finished result. This page describes the general pattern The Test Cabinet uses to
stream live data out of a sandboxed in-container process, back to the host
[runner](/components/architecture/#runners-and-reporters), and onward to a viewer —
and how to add a new instance of it. The asset-generation
[live preview](/testing/asset-generation/sprite-binaries/#live-preview) is the first.

## Why a dedicated channel

Two obvious channels don't work for streaming live progress out of a run:

- **The container filesystem is not host-visible mid-run.** A run's working tree
  lives on an anonymous container volume and is only copied out when the run
  finishes (see [Execution](/components/core/execution/)). The host cannot read a
  file the in-container process is still updating.
- **A subprocess's stdout is mediated by the harness.** Anything the model runs
  inside the container is executed *by the agent harness*, which decides what of
  that output it forwards (and may truncate it). Bytes a tool prints are not a
  reliable channel back to the core.

So instead the host opens a small network listener and the in-container process
connects back to it directly, bypassing both the filesystem and the harness.

## The pattern

```
in-container binary ──TCP──▶ host listener (core) ──▶ Sink
                                                       ├─▶ worker: event-stream line
                                                       └─▶ desktop: Tauri event
                                                              └─▶ frontend live view
```

1. **The host opens a listener.** When a [run](/components/architecture/#a-run) is
   being watched, the core binds an **ephemeral TCP port** on the run host for the
   lifetime of that run and mints an opaque **per-run token**. The listener is tied
   to the run: it is torn down when the run ends. Binding an ephemeral port per run
   means concurrent runs never collide, and the token means a stray connection from
   another run is rejected.

2. **The endpoint is seeded into the container.** The host writes its
   `host:port` and token into the configuration the in-container binary reads (for
   the drawing tool, the `live` block of `draw.config.json`). The host address is
   `host.docker.internal`, and the container is started with
   `--add-host host.docker.internal:host-gateway` so a process inside it can reach
   the host — both Docker and Podman resolve `host-gateway` to a host-reachable
   address. The mapping is added **only** when a viewer is present.

3. **The in-container process streams updates.** As it works, the binary connects
   back to the seeded endpoint and sends each update — a framed message carrying the
   token plus a small payload. This is **best-effort**: it uses short timeouts and
   swallows every error, so the work it is reporting on never fails because the
   listener is slow or gone. The streamed data is a *view* of the run's progress,
   never its authoritative output (which is collected and validated the usual way).

4. **The listener decodes and hands off to a `Sink`.** The core validates the
   token, decodes the payload into a typed value, and passes it to a sink trait the
   runner implements. The sink takes `&self` so it can be shared with the listener
   task that runs concurrently with the harness session.

5. **The runner relays it over its existing live channel.** Every runner already
   streams a run's [harness events](/components/core/events/) to its viewer; the
   live payload rides the same rail rather than inventing a new transport:

   - The [driver](/components/driver/overview/) interleaves it on the run's
     event stream it relays to the backend as a tagged line a subscriber tells
     apart from a `HarnessEvent` by its `type`.
   - The [Tauri app](/components/tauri/overview/) emits it on a per-run Tauri event
     (a sibling of the run's event channel).

   The shared [UI library](/components/ui/overview/) consumes both through one extra
   subscription handler and renders the live view.

### Design properties

- **Opt-in per run.** The listener is opened only when a viewer supplies a sink, so
  a plain `tcab run` or `tcab validate` opens no port and seeds no endpoint; the
  in-container binary simply finds no live config and does nothing.
- **Scoped to the run type that needs it.** Even a watched run only opens the
  listener for the relevant run type (today, asset-generation), so an end-to-end
  run never opens a port.
- **Best-effort and non-essential.** Dropped or skipped updates are fine — the
  authoritative output is the collected working tree, not the stream.
- **Not persisted.** Live payloads are a real-time view only; they are not written
  into the run record. The worker keeps the latest payload per key so a viewer that
  reconnects mid-run sees the current state, but nothing about them survives the
  run.

### Caveats

- **The listener binds `0.0.0.0`.** The container reaches the host on the
  host-gateway address, not loopback, so the listener must be reachable on the
  host's external interfaces — which also exposes the port on the local network for
  the run's duration. The token gates content, and only non-authoritative view data
  crosses it, but it is a real exposure to weigh if the host is untrusted.
- **TCP, deliberately.** A host-bound TCP port works uniformly across Docker and
  Podman and on Windows (where the runner runs under WSL). A host Unix-domain socket
  bind-mounted into the container would avoid opening a port and would survive a
  network-isolated container, but its Docker-Desktop-on-Windows support is murkier;
  TCP is the portable default.
- **Podman `host-gateway`.** Podman resolves `host-gateway` natively, but under
  `podman machine` (macOS/Windows hosts) the internal hostname is handled by the
  VM's resolver rather than `/etc/hosts`.

## Adding a new instance

To stream a different kind of live progress, reuse the seams above rather than
adding a new transport:

1. **In the in-container binary**, read an optional live endpoint from its seeded
   config and send a framed, token-tagged update at each step, best-effort.
2. **In the core**, define the payload type and a `Sink` trait for it, and have the
   run lifecycle start the listener (tying it to the run), seed the endpoint, and
   add the host mapping when a sink is supplied.
3. **In each runner**, implement the sink: the worker relays it on the run's event
   stream as a tagged line; the desktop shell emits it on a per-run Tauri event.
4. **In the UI**, add the subscription handler and render the live view.

The asset-generation [live preview](/testing/asset-generation/sprite-binaries/#live-preview)
is a worked example of every step.
