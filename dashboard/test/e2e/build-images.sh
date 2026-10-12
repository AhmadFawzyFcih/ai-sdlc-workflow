#!/usr/bin/env bash
# Builds the tiny Linux image the end-to-end test uses for every fake service (Postgres, Redis,
# the Rails-like web app). It is made from this machine's own binaries, so it needs no registry:
# Linux with Docker, PostgreSQL 16 server binaries (/usr/lib/postgresql/16) and Node on PATH.
set -euo pipefail
TAG=${1:-bdtest/base}
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT

copy() { # copy a file (resolving links) to the same path in the image, plus the libraries it needs
  local f="$1" real
  real=$(readlink -f "$f")
  install -D -m 0755 "$real" "$ROOT$f"
  { ldd "$real" 2>/dev/null || true; } | { grep -o '/[^ ]*' || true; } | while read -r lib; do
    [ -e "$ROOT$lib" ] || install -D "$(readlink -f "$lib")" "$ROOT$lib"
  done
}

for b in bash sh env sleep cat ls mkdir rm chmod chown id hostname true setpriv; do copy "$(type -P "$b")"; done
copy "$(type -P node)"
for b in postgres initdb pg_ctl psql pg_dump createdb dropdb pg_isready; do copy "$PGBIN/$b"; done
{ ldd "$PGBIN/postgres" || true; } | { grep -o '/[^ ]*' || true; } | while read -r lib; do copy "$lib"; done
mkdir -p "$ROOT/usr/share/postgresql" "$ROOT/usr/share" "$ROOT/usr/lib/postgresql/16/lib"
cp -a /usr/share/postgresql/16 "$ROOT/usr/share/postgresql/"
cp -a /usr/lib/postgresql/16/lib/. "$ROOT/usr/lib/postgresql/16/lib/"
cp -a /usr/share/zoneinfo "$ROOT/usr/share/"
ln -sf "$(command -v node)" "$ROOT/usr/local/bin/node" 2>/dev/null || true
mkdir -p "$ROOT/etc" "$ROOT/tmp" "$ROOT/var/run/postgresql" "$ROOT/var/lib/postgresql/data" "$ROOT/srv" "$ROOT/root"
[ -e "$ROOT/bin" ] || ln -s usr/bin "$ROOT/bin"
chmod 1777 "$ROOT/tmp"
printf 'root:x:0:0:root:/root:/bin/bash\npostgres:x:999:999:postgres:/var/lib/postgresql:/bin/bash\n' > "$ROOT/etc/passwd"
printf 'root:x:0:\npostgres:x:999:\n' > "$ROOT/etc/group"
printf 'hosts: files dns\n' > "$ROOT/etc/nsswitch.conf"
chown -R 999:999 "$ROOT/var/run/postgresql" "$ROOT/var/lib/postgresql"

cat > "$ROOT/srv/pg-start.sh" <<'SH'
#!/bin/bash
# Postgres like the official image: trust auth, listening on all addresses, running as "postgres".
set -e
export PATH=/usr/lib/postgresql/16/bin:$PATH
D=/var/lib/postgresql/data
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$D" /var/run/postgresql
  chown -R 999:999 "$D" /var/run/postgresql
  exec setpriv --reuid=999 --regid=999 --clear-groups /bin/bash "$0"
fi
if [ ! -s "$D/PG_VERSION" ]; then
  initdb -D "$D" -U "${POSTGRES_USER:-postgres}" --auth=trust --locale=C -E UTF8 >/dev/null
  echo "host all all 0.0.0.0/0 trust" >> "$D/pg_hba.conf"
fi
exec postgres -D "$D" -c listen_addresses='*' -c unix_socket_directories=/var/run/postgresql
SH

cat > "$ROOT/srv/fake-redis.js" <<'JS'
// Answers every connection with its own host name, so tests can tell which Redis they reached.
require('net').createServer((s) => { s.end('ID ' + require('os').hostname() + '\n'); }).listen(6379, '0.0.0.0');
JS

cat > "$ROOT/srv/idle.js" <<'JS'
// A service that just stays up (and listens on PORT if set).
if (process.env.PORT) require('http').createServer((q, r) => r.end(process.env.NAME || 'ok')).listen(Number(process.env.PORT), '0.0.0.0');
setInterval(() => {}, 1 << 30);
JS
chmod +x "$ROOT/srv/pg-start.sh"

cat > "$ROOT/Dockerfile" <<'DF'
FROM scratch
COPY . /
ENV PATH=/usr/lib/postgresql/16/bin:/usr/local/bin:/usr/bin:/bin:/opt/node22/bin
CMD ["/bin/bash"]
DF
docker build -q -t "$TAG:latest" -t "$TAG:dev1" "$ROOT" >/dev/null
echo "built $TAG:latest"
