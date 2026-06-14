# Shared base image for The Test Cabinet run containers.
#
# Every per-harness image builds FROM this. It provides the common toolchain a
# run needs and nothing harness specific:
#   - git, because every run executes inside a fresh git repository that is
#     seeded on the host and mounted in.
#   - a Node.js build toolchain, because the test cases ask the model to build
#     web UIs and those builds (Vite/npm and friends) run inside this container.
#   - an unprivileged user whose home is set up so that the per-harness images
#     can install their CLI without needing root.
#
# This image installs no agent harness. See the sibling directories for the
# per-harness images.
FROM node:22-bookworm-slim

# Common system packages:
#   - git: each run is its own fresh repository.
#   - curl, ca-certificates, unzip: used by the curl-based harness installers.
#   - build-essential, python3: let npm build native addons during UI installs.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		build-essential \
		ca-certificates \
		curl \
		git \
		python3 \
		unzip \
	&& rm -rf /var/lib/apt/lists/*

# The node base image ships an unprivileged `node` user (uid 1000); reuse it as
# the run user rather than creating a second uid-1000 account. Set up
# user-writable install locations so the per-harness images can install their
# CLI as `node` with no root.
RUN mkdir -p /home/node/.npm-global /home/node/.local/bin /work \
	&& chown -R node:node /home/node /work

# Point npm's global prefix at a user-writable directory and put the user-level
# install locations on PATH, so both `npm install -g` and curl-based installers
# work as the unprivileged user.
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global \
	PATH=/home/node/.npm-global/bin:/home/node/.local/bin:$PATH

USER node

# The seeded repository is mounted here at run time and is the harness's working
# directory.
WORKDIR /work

# Run containers are long-lived: the testing harness starts the container and
# then execs the agent harness inside it (see crates/core ContainerRuntime).
# Keep the container alive until it is explicitly stopped.
CMD ["sleep", "infinity"]
