# Fix the x86_64 gg link in the service image build stage

`deployments/images/services.Dockerfile`'s `gg-build` stage links a static-musl `gg` that
segfaults on x86_64. The failure is reproducible: the stage completes the release build
and the copy, and `/gg reference --out /gg-reference` then exits 139 with no Rust panic,
no stack-overflow message and no linker diagnostic. The aarch64 build of the same stage,
at the same commit, projects the documents in about four seconds.

CI no longer depends on that stage, so the segfault now blocks only local builds. Two
paths build `--target backend` or `--target driver` on a developer machine, and both fail
the same way on x86_64:

- `make -C deployments/local images`, which builds both and feeds the k3d stack.
- `docker compose -f deployments/local/compose.yml up backend`, the two-service
  control-plane stack documented in that file's own header. It builds `--target backend`,
  so it runs this stage, and it offers no pointer to this issue.

Restore both.

## The stage has no CI coverage

Before `scripts/ci/gg-prebuilt.sh`, the `service_backend_{amd64,arm64}` and
`service_driver_{amd64,arm64}` jobs all built this stage on every `master` and `staging`
run, which is how this segfault was found. They now replace it with
`--build-context gg-build=<dir>`, and nothing else in `azure-pipelines.yml` builds it.

So a commit that breaks the stage merges fully green. Editing
`scripts/ci/install-gg-build-toolchains.sh`, `scripts/ci/install-gg-toolchains.sh` or
`scripts/build-gg-static.sh`, or bumping the stage's `rust:1-bookworm` or
`node:24-bookworm-slim` pins, would each do it. The break then surfaces only when someone
runs one of the two local paths on an aarch64 machine, because on x86_64 both are already
broken.

Decide the coverage as part of this issue. One arm64 step running
`docker buildx build --target backend … -o type=cacheonly` with `TCAB_PREBUILT_GG` unset
would exercise the stage without pushing, at the cost of a full gg link. The alternative is
to retire the stage and have the local paths consume a prebuilt gg as CI does.

## What is known

The Rust inputs are identical between the stage and the gates job that links a working
x86_64 binary from the same commit: the same 342 crates at the same versions, rustc
1.97.1, the same `RUSTFLAGS`, and target specs that agree in every field governing the CRT
and the static-PIE decision (`crt-objects-fallback = "musl"`, `crt-static-default = true`,
`static-position-independent-executables = true`, `linker-flavor = "gnu-cc"`).

What differs is the distribution toolchain behind `musl-gcc`, which
`scripts/build-gg-static.sh` routes the link through. The stage is
`docker.io/library/rust:1-bookworm`, so Debian 12's gcc 12, binutils 2.40 and musl 1.2.3.
The gates job builds inside `ci/images/rust.Dockerfile`, which is Ubuntu 26.04 with a much
newer set, and produces a binary that projects the documents and passes every `gg
selfcheck` arm in four run images.

`crates/gg` reads no embedded artifact unsafely — every one is a `&[u8]` or `&str` const
from `include_bytes!`/`include_str!` — so a segfault in a release build of safe Rust
points at the link rather than at the code.

## Reproducing it

An x86_64 machine is required; the devcontainer is aarch64 and has no amd64 emulation. The
Images stage runs only on `master` and `staging`, so a branch build exercises nothing here
either.

```sh
docker build --platform linux/amd64 --target driver \
  -f deployments/images/services.Dockerfile .
```

The diagnostics on that stage's RUN report the architecture, the stack limit, the linked
binary's size and mode, and whether `/gg --version` succeeds before the projection is
attempted. `scripts/build-gg-static.sh` prints the binary's size and SHA-256, so the two
links of one commit can be compared; the gates job's x86_64 binary is 786012736 bytes.

## Candidate fixes

Link with rustc's own self-contained musl CRT rather than through the distribution
`musl-gcc`: drop `CARGO_TARGET_<T>_LINKER` and `CC_<t>` from `scripts/build-gg-static.sh`,
or link with `rust-lld`. This is the most likely cure and the riskiest change, because
that script also produces the binary on the path that works — the published artifact, the
run images' self-check and the `gg-releases` upload all come out of it. Validate it on an
x86_64 machine before it lands.

Match the stage's environment to the one that works: base it on `ubuntu:26.04` with a
rustup install, mirroring `ci/images/rust.Dockerfile`. This costs the shared
`rust:1-bookworm` base layer it has with the `build` stage and adds a rustup install to
the image build, and it treats the symptom rather than naming the defect.
