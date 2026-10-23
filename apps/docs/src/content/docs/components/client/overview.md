---
title: Overview
---

The operator client is a desktop and Android application that opens the
[console](/components/web/overview/) in a WebView. It is the `client-tauri`
repository, a Tauri v2 workspace: a Rust shell crate and an npm workspace that
together build the bundle for each platform. The shell links nothing of the
project at build time, since everything a person uses is the console deployed
at its origin.

## The two builds

The client is built once for prod and once for staging, and the two builds
differ in the one URL the shell loads: `https://console.testcabinet.ai` and
`https://console.staging.testcabinet.ai`. Nothing else varies between them.

Each build is a flavor: a `tauri.<flavor>.conf.json` beside the shell crate's
`tauri.conf.json`, which the Tauri CLI merges over it, sets the console's URL
and nothing else. The base configuration names no console, so every build
names its flavor.

## Sign-in

Sign-in happens inside the WebView. The origin is behind Cloudflare Access, so
opening it leads to the Microsoft login page, and the Access cookie the edge
sets persists in the WebView across launches. The Access and Microsoft login
pages load in the WebView itself, never in the platform's browser. The shell
holds no credential of its own and adds nothing to a request. See
[Identity](/components/auth/overview/).

The shell's affordances reach the console's origin alone. Its script installs
itself on that origin's pages, and its commands are granted to that origin and
to no page of the sign-in flow. A WebView does not always tell which frame a
call came from: Android's runs the shell's script and its IPC in every frame
and reports the main frame's address for a call from any of them. So each
launch draws a random token, which the script holds once it is on the
console's origin and sends with every call, and the shell refuses a call
without it. A frame inside the console, such as a run's playable build, cannot
reach the shell.

## What the shell handles

The shell carries the console's affordances that a WebView does not supply:

- A new-window open, such as a published run's playable build or a share link,
  opens in the platform's browser, and so does a link to a site other than the
  console and its sign-in flow. An open that names no page does nothing. On
  Windows and Android the window itself is kept on the console and its sign-in
  flow, and any other site it would go to opens in the browser instead; a
  frame inside the console, such as a run's playable build, is not held to
  this, and a new window it opens on Android goes to the browser. Linux and
  macOS cannot tell the window's navigation from a frame's, so there the
  links the console's page follows are all the shell judges.
- A download, such as a run's archive, is written through the platform's
  download path: the user's download directory on the desktop and the public
  Downloads folder on Android. Android 7 to 9 ask for the storage permission
  at the first download, and a download goes nowhere if it is refused. A
  download never overwrites a file, nor takes the name of another still under
  way, and the console's page shows where it went.
- The clipboard is reached through the shell, so copying a share link works on
  every platform.
- When the app returns from the background, the shell dispatches the event
  `tcab:resume` on the console's `window`, and the console reconnects its event
  stream, so a run watched before the app was suspended resumes updating. The
  app returns when Android resumes it, when its desktop window is shown again
  after being minimized or hidden, when the machine wakes from sleep, and when
  the console's page becomes visible after it was hidden. One return
  dispatches the event once, however many of these report it.

## Targets and distribution

The client targets Windows, Linux, macOS and Android. No bundle carries a
publisher's signature: the desktop bundles are unsigned, and the Android APK is
signed with the debug key of the machine that built it, which Android requires
before it installs an APK. A tag's pipeline run publishes the bundles as
pipeline artifacts.
The repository is the `shell` kind, so its CI runs in the `android` image track
the kit renders for that kind; see
[Repositories](/development/repositories/).
