# Provisioning-only image that turns one operator-supplied regional extract into the search
# engine's import dump, and imports that dump into a sealed search database.
#
# It is never part of the serving stack, never started by Compose and never published: it contains
# GPL-licensed tools (the geocoding database builder, osm2pgsql, PostGIS). It runs only during an
# explicit operator preparation, with no network, the extract mounted read-only and only a
# staging work directory writable.
#
# Every input is pinned: the base image by digest, every system package to an exact version from
# one dated, signed Ubuntu snapshot, every Python package by hash, and the engine archive by
# SHA-256 and size.
ARG BASE_IMAGE=eclipse-temurin:21.0.12_8-jre-noble@sha256:7739f0ffce786528961eea6bf46d9610ee968ac6127c9b2e93494757bdecce9f
ARG UBUNTU_SNAPSHOT=20260920T000000Z

FROM ${BASE_IMAGE} AS engine-archive
ADD https://github.com/komoot/photon/releases/download/1.3.0/photon-1.3.0.jar /engine.jar
RUN echo "a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5  /engine.jar" | sha256sum -c - \
  && test "$(stat -c %s /engine.jar)" = "98219380"

FROM ${BASE_IMAGE} AS provisioner
ARG UBUNTU_SNAPSHOT
ENV DEBIAN_FRONTEND=noninteractive
RUN rm -f /etc/apt/sources.list \
  && printf 'Types: deb\nURIs: http://snapshot.ubuntu.com/ubuntu/%s/\nSuites: noble noble-updates noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n' \
    "${UBUNTU_SNAPSHOT}" > /etc/apt/sources.list.d/ubuntu.sources \
  && mkdir -p /etc/postgresql-common/createcluster.d \
  && echo 'create_main_cluster = false' > /etc/postgresql-common/createcluster.d/atlas-os.conf \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    g++=4:13.2.0-7ubuntu1 \
    libicu-dev=74.2-1ubuntu3.1 \
    libnss-wrapper=1.1.15-2 \
    libpq5=16.15-0ubuntu0.24.04.1 \
    osm2pgsql=1.11.0+ds-1 \
    pkg-config=1.8.1-2build1 \
    postgresql-16=16.15-0ubuntu0.24.04.1 \
    postgresql-16-postgis-3=3.4.2+dfsg-1ubuntu3 \
    postgresql-16-postgis-3-scripts=3.4.2+dfsg-1ubuntu3 \
    postgresql-client-16=16.15-0ubuntu0.24.04.1 \
    postgresql-common=257build1.1 \
    python3=3.12.3-0ubuntu2.1 \
    python3-dev=3.12.3-0ubuntu2.1 \
    python3-venv=3.12.3-0ubuntu2.1 \
  && rm -rf /var/lib/apt/lists/*

COPY infra/images/search-build/build-backend.lock infra/images/search-build/requirements.lock /opt/atlas-os/build/
RUN python3 -m venv /opt/atlas-os/nominatim-venv \
  && /opt/atlas-os/nominatim-venv/bin/pip install --no-cache-dir --require-hashes --no-deps \
    -r /opt/atlas-os/build/build-backend.lock \
  && /opt/atlas-os/nominatim-venv/bin/pip install --no-cache-dir --require-hashes --no-deps \
    --no-build-isolation -r /opt/atlas-os/build/requirements.lock \
  && /opt/atlas-os/nominatim-venv/bin/nominatim --version

COPY --from=engine-archive /engine.jar /opt/atlas-os/engine/engine.jar
COPY infra/images/search/licenses/ /opt/atlas-os/engine/licenses/
COPY infra/images/search-build/build-dump.sh /opt/atlas-os/build/build-dump.sh
RUN chmod 0444 /opt/atlas-os/engine/engine.jar && chmod 0555 /opt/atlas-os/build/build-dump.sh

ENV PATH=/usr/lib/postgresql/16/bin:/opt/java/openjdk/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["/bin/sh", "/opt/atlas-os/build/build-dump.sh"]
