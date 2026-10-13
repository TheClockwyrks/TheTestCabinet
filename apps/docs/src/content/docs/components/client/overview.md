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

## Sign-in

Sign-in happens inside the WebView. The origin is behind Cloudflare Access, so
opening it leads to the Microsoft login page, and the Access cookie the edge
sets persists in the WebView across launches. The shell holds no credential of
its own and adds nothing to a request. See [Identity](/components/auth/overview/).

## What the shell handles

The shell carries the console's affordances that a WebView does not supply:

- A new-window open, such as a published run's playable build or a share link,
  opens in the platform's browser.
- A download, such as a run's archive, is written through the platform's
  download path.
- The clipboard is reached through the shell, so copying a share link works on
  every platform.
- When the app returns from the background, the shell has the console reconnect
  its event stream, so a run watched before the app was suspended resumes
  updating.

## Targets and distribution

The client targets Windows, Linux, macOS and Android. Bundles are unsigned on
every platform, and a tag's pipeline run publishes them as pipeline artifacts.
The repository is the `shell` kind, so its CI runs in the `android` image track
the kit renders for that kind; see
[Repositories](/development/repositories/).
