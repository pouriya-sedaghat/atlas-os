#!/bin/sh
# Builds the geocoding dump for one regional extract, entirely offline.
#
# Runs inside the provisioning image with no network: the extract is mounted read-only, and only
# the work directory is writable. A throwaway PostgreSQL cluster is created in the work directory,
# the geocoding database is imported into it, the search engine's dump is exported, and the
# cluster is removed again. What remains is `dump.jsonl` and `build-report.json`, which names no
# host path.
#
# Every location is configurable so the same script can be exercised outside a container.
set -eu
umask 022

INPUT=${ATLAS_BUILD_INPUT:-/input/region.osm.pbf}
WORK=${ATLAS_BUILD_WORK:-/work}
ENGINE_ARCHIVE=${ATLAS_BUILD_ENGINE_ARCHIVE:-/opt/atlas-os/engine/engine.jar}
VENV=${ATLAS_BUILD_VENV:-/opt/atlas-os/nominatim-venv}
PG_BIN=${ATLAS_BUILD_PG_BIN:-/usr/lib/postgresql/16/bin}
JAVA=${ATLAS_BUILD_JAVA:-java}
THREADS=${ATLAS_BUILD_THREADS:-$(nproc)}
LANGUAGES=${ATLAS_BUILD_LANGUAGES:-fa,en}
PG_PORT=${ATLAS_BUILD_PG_PORT:-5432}

PGDATA="$WORK/pg"
RUN="$WORK/run"
PROJECT="$WORK/project"
DUMP="$WORK/dump.jsonl"
REPORT="$WORK/build-report.json"

log() { printf '%s\n' "{\"event\":\"$1\",\"stage\":\"$2\"}"; }
now_ms() { date +%s%3N; }

# PostgreSQL refuses to run without a user name. When the container runs under an arbitrary
# numeric UID, provide one through nss_wrapper instead of editing the image's passwd file.
if ! id -un >/dev/null 2>&1; then
  printf 'atlas:x:%s:%s:atlas:%s:/bin/sh\n' "$(id -u)" "$(id -g)" "$WORK" >"$WORK/passwd"
  printf 'atlas:x:%s:\n' "$(id -g)" >"$WORK/group"
  NSS_WRAPPER_PASSWD="$WORK/passwd"
  NSS_WRAPPER_GROUP="$WORK/group"
  LD_PRELOAD=${ATLAS_BUILD_NSS_WRAPPER:-libnss_wrapper.so}
  export NSS_WRAPPER_PASSWD NSS_WRAPPER_GROUP LD_PRELOAD
fi
DB_USER=$(id -un)

stop_cluster() {
  if [ -f "$PGDATA/postmaster.pid" ]; then
    "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null 2>&1
  fi
}
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if ! stop_cluster; then
    # A failed stop may leave PostgreSQL using its files, particularly in local mode. Keep
    # the cluster and its socket directory intact for diagnosis and manual recovery.
    echo 'PostgreSQL did not stop; preserving its work directory.' >&2
    if [ "$status" -eq 0 ]; then status=1; fi
    exit "$status"
  fi
  # Only a confirmed stop clears this marker. A crash or SIGKILL leaves it behind so the
  # caller knows it must not discard the staging tree around a potentially live database.
  if ! rm -f "$WORK/cluster-unverified"; then
    echo 'Could not mark PostgreSQL as stopped; preserving its work directory.' >&2
    if [ "$status" -eq 0 ]; then status=1; fi
    exit "$status"
  fi
  if ! rm -rf "$PGDATA" "$RUN" "$PROJECT" "$WORK/passwd" "$WORK/group"; then
    echo 'Failed to remove the stopped PostgreSQL work directory.' >&2
    if [ "$status" -eq 0 ]; then status=1; fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

test -r "$INPUT" || { echo 'The regional extract is not readable.' >&2; exit 66; }
test -r "$ENGINE_ARCHIVE" || { echo 'The search engine archive is missing.' >&2; exit 69; }
rm -f "$DUMP" "$REPORT"
mkdir -p "$RUN" "$PROJECT" "$WORK/tmp"
# Durable evidence before any server starts; every enclosing cleanup honours this marker.
: >"$WORK/cluster-unverified"

started=$(now_ms)
log start cluster
"$PG_BIN/initdb" -D "$PGDATA" -U "$DB_USER" --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
"$PG_BIN/pg_ctl" -D "$PGDATA" -w -l "$WORK/postgresql.log" \
  -o "-c listen_addresses=127.0.0.1 -c port=$PG_PORT -c unix_socket_directories=$RUN -c fsync=off -c full_page_writes=off -c synchronous_commit=off -c max_wal_size=4GB -c checkpoint_timeout=60min" \
  start >/dev/null
cluster_ready=$(now_ms)

log start import
cat >"$PROJECT/.env" <<ENV
NOMINATIM_DATABASE_DSN="pgsql:dbname=nominatim;host=$RUN;port=$PG_PORT;user=$DB_USER"
NOMINATIM_DATABASE_WEBUSER="$DB_USER"
NOMINATIM_IMPORT_STYLE=full
ENV
# --offline: never fetch anything to date the database; --reverse-only and --no-updates skip
# search indexes and update tables the export does not need. No Wikipedia importance, special
# phrases or external postcodes are loaded: none of them is present, and none is downloaded.
(cd "$PROJECT" && "$VENV/bin/nominatim" import --osm-file "$INPUT" --offline --reverse-only \
  --no-updates --threads "$THREADS")
imported=$(now_ms)

places=$("$PG_BIN/psql" -h "$RUN" -p "$PG_PORT" -U "$DB_USER" -d nominatim -Atc 'SELECT count(*) FROM placex')
database_bytes=$("$PG_BIN/psql" -h "$RUN" -p "$PG_PORT" -U "$DB_USER" -d nominatim -Atc "SELECT pg_database_size('nominatim')")

log start dump
"$JAVA" -Xmx"${ATLAS_BUILD_DUMP_HEAP:-1g}" -Djava.io.tmpdir="$WORK/tmp" -Duser.home="$WORK/tmp" \
  -jar "$ENGINE_ARCHIVE" dump-nominatim-db -export-file "$DUMP" -languages "$LANGUAGES" \
  -host 127.0.0.1 -port "$PG_PORT" -user "$DB_USER" -database nominatim -j "$THREADS"
dumped=$(now_ms)
dump_bytes=$(wc -c <"$DUMP" | tr -d ' ')

stop_cluster
rm -rf "$WORK/tmp"
cat >"$REPORT" <<JSON
{"databaseBytes":$database_bytes,"dumpBytes":$dump_bytes,"places":$places,"stages":{"clusterMilliseconds":$((cluster_ready - started)),"importMilliseconds":$((imported - cluster_ready)),"dumpMilliseconds":$((dumped - imported))},"threads":$THREADS}
JSON
log done build
