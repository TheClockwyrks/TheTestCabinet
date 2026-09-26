# The **audio store** image: every published audio pack, as data and nothing else.
#
# This is NOT a run image. Nothing executes in it, nothing resolves it for a run, and it
# has no shell, no user and no entrypoint — it is `FROM scratch` with one tree in it. It
# exists so the audio a run is staged with can travel as an image: `deployments/images/
# services.Dockerfile` copies it into the driver at `/opt/tcab-audio`, and a local
# checkout pulls it with `scripts/fetch-audio-store.sh`. Both read the SAME published
# bytes, so a run stages the same palette on a contributor's laptop and in a cluster.
#
# Why an image rather than the build context of the thing that needs it: the store is
# assembled by `scripts/stage-audio-store.mjs`, which downloads the clips out of the
# private audio object store with the read-scoped R2 PRESIGN credentials. Publishing the
# tree once, here, is what keeps those credentials out of every OTHER build: the driver
# image build copies the store out of this image, and a contributor's `./containers/
# build.sh` builds every run image without it. It is the same shape as
# `containers/gg-toolchains/Dockerfile`: built and pushed by `containers/build.sh`,
# deliberately absent from `containers/image-names.sh` (which is the set of images a RUN
# resolves, and this is not one), and fused from its two arch tags BY NAME by the Azure
# pipeline (`scripts/ci/audio-store-image.sh`, then `scripts/ci/manifest.sh`).
#
# The tree is what `crates/core`'s `audio_stage` reads (see that module and
# `apps/docs/src/content/docs/components/core/execution.md`):
#
#   /opt/tcab-audio/
#     objects.lock.json                     every published object, by digest and length
#     clips/<clip-id>.<profile-id>.wav      one file per clip + profile, shared by packs
#     packs/<name>@<version>/pack.toml      the loader manifest; entries point into clips/
#
# The lock travels with the bytes deliberately: staging verifies every clip it carries
# into a container against it, so a store is verifiable wherever it was fetched from.

FROM scratch

# `AUDIO_STAGE_DIR` is the staged tree's path within the build context (the repository
# root), which `containers/build.sh` fills in after running the stager:
#   --build-arg AUDIO_STAGE_DIR=dist/audio-store/tree
# Declared after the `FROM` because a build arg is scoped to the stage that declares it,
# and this is the stage that interpolates it. Its default points nowhere, so a build that
# skips `build.sh` fails at the COPY rather than publishing an empty store. The root
# `.dockerignore` re-includes exactly that directory, and only it, so the stager's
# content-addressed download cache beside it stays out of every build context.
ARG AUDIO_STAGE_DIR=dist/audio-store/unstaged

# `--chmod` because the modes in the image must not depend on the umask of whichever
# machine staged the tree: everything here is read by the driver process and by
# `docker cp`, and a store nobody can read is a run that fails at staging. `--link`
# builds the layer rooted at `scratch` and merges it in, so the layer's digest is a
# function of the content alone — the same reason `containers/gg/Dockerfile` uses it,
# and the reason this image's layer is shared rather than re-stored per pull.
COPY --link --chmod=0755 ${AUDIO_STAGE_DIR} /opt/tcab-audio
