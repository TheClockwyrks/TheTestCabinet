---
title: "Self-check"
---

`gg selfcheck` drives every registered language's bootstrap round trip in
whatever environment the binary is running in, and exits non-zero when any arm
fails. Its whole input is the binary and the environment around it: the program
each arm is asked for is that arm's own bootstrap program, the one gg runs to
seed a fresh window.

What each arm is driven through is the whole first code turn. The arm prepares
its bootstrap program through the real preparation step, meaning the real
toolchain resolution and the real compiler; gg instantiates the guest,
evaluates the prepared program, and requires the views that program promised.
Every arm is driven whatever the ones before it did, so one invocation names
every arm that is broken.

```sh
gg selfcheck                    # every registered arm
gg selfcheck --language csharp  # one arm, repeatable
```

A line per arm carries the arm's id, its verdict and what preparation cost, and
a failing arm carries the report beneath it: the compiler's own output for a
program it rejected, and the exit status, the signal and the tail of stderr for
a compiler that could not finish.

## Where it runs

The subcommand exists for the run image. A toolchain is
[self-contained](/gg/languages/compilation/#self-contained-toolchains) or it is
not, and the environment that answers the question is the image a run executes
in, so the gate is `gg selfcheck` inside a built `-gg` variant, run from the
same static binary a run is given.

Four images answer for the whole set. `/opt/gg/toolchains` is one tree copied
identically into every variant, so what differs between them is the environment
that tree has to run in. That is not the same as the parent: there are two
parents, the Debian base every image but one is built from and the Ubuntu the
blender image is built from, but a dozen run images install packages of their own
on top of the base, and a package arrives with its whole dependency closure. The
render images have carried an ICU that way the whole time — the very library the
C# arm was published without — which no Dockerfile of theirs asks for and no
count of parents can see.

So an environment is the image a lineage is rooted at plus every package
installed along the way, and the variants fall into four of them:
`sprite-gg` (the shared base), `base-wasm-gg` (and base-wasm's packages),
`voxel-gg` (and the render images' mesa stack) and `blender-gg` (the Ubuntu
lineage). All four pass before any variant is published, and
`containers/build.sh` re-derives the grouping from the Dockerfiles on every gated
build, so a run image that gains a package stops the build rather than joining
the set unchecked.

## What it settles

- That each arm's toolchain resolves where the image put it, that the shared
  libraries its binaries and its runtimes load are present, and that its
  compiler runs to completion.
- That the guest instantiates and evaluates what the compiler produced, which
  is what makes this a round trip rather than a compile.
- That the views the bootstrap program opened arrived, so a program that
  compiled and ran without reaching gg's surface is a failure here.

## What it leaves to something else

- A session. The check is one bootstrap turn per arm, so what a model does with
  an arm over a run, what that run costs, and how a failure reads to a model
  are answered by a real run and by the gates that drive each arm's failure
  shapes.
- The catalogue a model reads. Whether a surface is spelled, gated and
  described correctly is the capability, register and spelling gates' question,
  and the [reference](/gg/reference/) is where the answer is read. This
  subcommand compiles one program per arm and asserts nothing about names.
- Per-change feedback. The check needs a built image, so it runs post-merge on
  master and staging alongside the image build. What a pull request gets is the
  gates that need no image, which drive the same preparations against the
  toolchains the build machine installed.

## Running it locally

The gate is a flag on the image build rather than a script beside it, because the
question is only worth asking of an image that was just built:

```sh
make -C deployments/local run-images-gg-selfcheck   # build gg, build the four, check them
```

That target builds the static binary with `scripts/build-gg-static.sh` — the same
artifact a deployment copies into a run container — and hands it to
`containers/build.sh --gg-selfcheck`, which is the command CI publishes behind.
Running `build.sh` directly is the same thing with the images named:

```sh
containers/build.sh --gg-selfcheck target/gg-selfcheck/gg \
  sprite-gg base-wasm-gg voxel-gg blender-gg
```

For each image it builds, `build.sh` installs the binary the way a run installs
it — a created container, `docker cp` to `/tmp/gg`, `exec` as the unprivileged
`node` user — and runs the check there, between the build and the push. It copies
rather than mounts on purpose: a bind mount is resolved by the daemon, and this
repository's devcontainer talks to the host's daemon, where an in-container path
names nothing. A build asked to gate a selection that names no representative is
refused rather than passing quietly.

Running `cargo run -p test-cabinet-gg -- selfcheck` in the devcontainer asks the
same question of a different environment, which is what to reach for while
building an arm: it exercises the toolchains
`scripts/ci/install-gg-toolchains.sh` installed on that machine rather than the
tree an image carries.
