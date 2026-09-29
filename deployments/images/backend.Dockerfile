# syntax=docker/dockerfile:1
# The image the workspace template's publish stage pushes as
# `testcabinet.azurecr.io/the-test-cabinet-backend:<commit>`, which the staging and
# prod overlays run as the `the-test-cabinet-backend` Deployment.
#
# It is a retag, not a build. The backend's real image is built natively on each
# architecture from deployments/images/services.Dockerfile (`--target backend`) by the
# project's image jobs in the pipeline's gates stage, and fused into the multi-arch
# `testcabinet.azurecr.io/tcab-backend:<commit>`. That build needs gg's language
# toolchains, which cannot be built under emulation on a hosted agent within the
# publish job's hour. The publish stage runs after the gates stage, so the image this
# names already exists when it builds; with no RUN step, nothing here is emulated.
#
# The template's scripts/ci/build-image.sh passes the commit as the build argument
# below:
#
#   THE_TEST_CABINET_COMMIT="$(git rev-parse HEAD)" \
#     scripts/ci/build-image.sh the-test-cabinet-backend deployments/images/backend.Dockerfile
#
# The argument defaults to `unpinned`, the tag nothing pushes (as in the overlays), so a
# build that is not handed a commit fails to pull rather than retagging a moving tag.
#
# A local cluster does not use it: `make -C deployments/local local-up` builds the
# backend from services.Dockerfile directly.
ARG THE_TEST_CABINET_COMMIT=unpinned
FROM testcabinet.azurecr.io/tcab-backend:${THE_TEST_CABINET_COMMIT}
