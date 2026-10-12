# The web track's CI image: what the gates in the `web` job of
# azure-pipelines.yml reach for.
#
# This is not the devcontainer, which adds the coding agents, CUDA and a shell
# configured for a person to the same base, none of which a gate invokes. It is
# built on the toolchain image the template publishes, the one the
# devcontainer is built on, with the browser engines copied from the playwright
# image the devcontainer copies, so Node, uv, kubectl, the engines and the
# system libraries they link against are the ones a developer's container
# holds, at the same paths, with nothing installed here. See
# ci/images/README.md.
#
# The image references come from the `x-devcontainer-build-args` anchor in
# .devcontainer/docker-compose.yml, extracted by ci/images/build-args.sh and
# passed in as the build arguments below. A global `ARG` is read by a `FROM`
# alone.
#
# Built for linux/amd64 only: Azure's hosted agents are amd64.
# scripts/ci/ci-image.sh builds and pushes this file.
ARG TOOLCHAIN_IMAGE
ARG PLAYWRIGHT_IMAGE
FROM ${PLAYWRIGHT_IMAGE} AS playwright
FROM ${TOOLCHAIN_IMAGE}

# The browser engines, in the account's Playwright cache, as the devcontainer
# holds them.
COPY --from=playwright / /

# A root build, taking root back from the toolchain image's account, and the
# steps do not run as root. Azure runs `useradd -m -u 1001 vsts_azpcontainer`
# against a container job and execs every step as that user, whatever the
# image's default user is and whatever `--user` the container resource asks
# for. HOME below is still this image's, so a step runs as uid 1001 with
# HOME=/root, and every tool keeping a cache under HOME writes there. That is
# why /root is widened at the end of this file.
USER root
ENV HOME=/root \
	USER=root \
	LANG=C.UTF-8

# Where uv keeps the tools it installed and the CPython it fetched for them,
# which the toolchain image put under the account's home: pre-commit, and the
# interpreter `uv run --project ci` resolves, so the gate runner's environment
# is built from what the image holds rather than downloaded on the first step
# of every run.
ENV UV_TOOL_DIR=/home/dev/.local/share/uv/tools \
	UV_PYTHON_INSTALL_DIR=/home/dev/.local/share/uv/python

# The engines are read where the playwright image put them rather than from
# HOME's cache, which is root's here. Playwright reads this variable when a
# test asks for an engine, so ci/gates/web-browser-test.py resolves them
# through `executablePath()` unchanged.
ENV PLAYWRIGHT_BROWSERS_PATH=/home/dev/.cache/ms-playwright

# The PATH has to be complete here. A pipeline step reads no rc file, and
# nothing reconstructs a PATH on its way into the job container, so anything a
# gate calls is on this line or it does not exist. ~/.local/bin is where the
# toolchain image links node, npm, npx, uv, pre-commit and kubectl.
ENV PATH=/home/dev/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

# A step reaches the toolchain's directories without a copy of them in a layer
# of this image: the account's home is opened to every user to enter and read,
# which a layer records without the files beneath it.
RUN chmod o+rx /home/dev

# git refuses a repository owned by another uid, and running as root is not an
# exemption. Every gate reaches git — the runner shells out to
# `git rev-parse --show-toplevel` before any gate does anything else — and the
# checkout belongs to the agent, not to this image.
RUN git config --system --add safe.directory '*'

# HOME for every step, and not writable by the uid that runs them until this
# line. Recursive, because a directory the build created under it is one a
# step reaches for, and widening /root alone leaves that one root-owned, which
# is a permission error one directory deeper rather than none. `a+rwX` adds
# execute to the directories and not to the files in them, and it is a+ rather
# than an owner because the uid is Azure's to choose and this image holds
# nothing secret.
RUN chmod -R a+rwX /root
