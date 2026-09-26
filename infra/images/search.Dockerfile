# Serving image for one per-slot search engine host.
#
# It carries exactly what serving needs: the compiled host, a glibc Java 21 runtime, and the
# pinned engine archive. No database, no import tooling, no package manager and no source. The
# engine listens on loopback only inside the container; the host is the only thing on the
# internal network. The same image verifies a freshly built database during an explicit, offline
# preparation.
#
# Every input is pinned: both base images by digest, the engine archive by SHA-256 and size, and
# the Node dependency graph by the frozen lockfile.
ARG NODE_IMAGE=node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b
ARG JRE_IMAGE=eclipse-temurin:21.0.12_8-jre-noble@sha256:7739f0ffce786528961eea6bf46d9610ee968ac6127c9b2e93494757bdecce9f

FROM ${NODE_IMAGE} AS toolchain
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
WORKDIR /workspace

FROM toolchain AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc -b packages/atlas-os packages/core apps/search-host --pretty false

FROM build AS search-host-deploy
RUN pnpm --filter @atlas-os/search-host deploy --prod --legacy /prod/search-host

FROM ${JRE_IMAGE} AS engine-archive
ADD https://github.com/komoot/photon/releases/download/1.3.0/photon-1.3.0.jar /engine.jar
RUN echo "a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5  /engine.jar" | sha256sum -c - \
  && test "$(stat -c %s /engine.jar)" = "98219380"

FROM ${JRE_IMAGE} AS jre

FROM ${NODE_IMAGE} AS search-runtime
ENV NODE_ENV=production \
  JAVA_HOME=/opt/java/openjdk \
  ATLAS_SEARCH_ENGINE_JAVA=/opt/java/openjdk/bin/java \
  ATLAS_SEARCH_ENGINE_ARCHIVE=/opt/atlas-os/engine/engine.jar \
  ATLAS_SEARCH_WORK_ROOT=/var/lib/atlas-engine
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
COPY --from=engine-archive /engine.jar /opt/atlas-os/engine/engine.jar
COPY infra/images/search/licenses/ /opt/atlas-os/engine/licenses/
# The only writable path the host needs. A fresh named volume mounted here inherits this owner.
RUN chmod 0444 /opt/atlas-os/engine/engine.jar \
  && mkdir -p /var/lib/atlas-engine \
  && chown 10001:10001 /var/lib/atlas-engine \
  && chmod 0700 /var/lib/atlas-engine
WORKDIR /app
COPY --from=search-host-deploy /prod/search-host/ ./
USER 10001:10001
CMD ["node", "dist/index.js"]
