#!/usr/bin/env bash
# Starts an Oggi non posso image the way production runs it and checks it
# works:
#   1. read-only root, no capabilities, /data on a tmpfs owned by the runtime
#      user: it logs the expected version, /healthz answers, the page and an
#      event route are served, an event can be created through the API;
#   2. SIGTERM stops it cleanly;
#   3. a configuration it cannot use stops it with exit code 2 and a message
#      naming the variable.
# Usage: smoke-test.sh IMAGE VERSION [PORT]
set -euo pipefail

image=${1:?usage: smoke-test.sh IMAGE VERSION [PORT]}
version=${2:?usage: smoke-test.sh IMAGE VERSION [PORT]}
port=${3:-18080}
name="onp-smoke-$$"
base="http://127.0.0.1:${port}"

cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() {
  echo "::error::$*"
  docker logs "$name" 2>&1 || true
  exit 1
}

docker run -d --name "$name" \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /data:uid=65532,gid=65532 \
  -p "127.0.0.1:${port}:8080" \
  "$image" >/dev/null

health=""
for _ in $(seq 1 30); do
  if health=$(curl -fsS "${base}/healthz" 2>/dev/null); then
    break
  fi
  sleep 1
done
[ "$health" = "ok" ] || fail "/healthz never answered ok"
echo "healthz: ok"

docker logs "$name" 2>&1 | grep -q "\"msg\":\"listening\",\"version\":\"${version}\"" \
  || fail "the start line does not report version ${version}"
echo "version: ${version}"

page=$(curl -fsS "${base}/") || fail "GET / failed"
case "$page" in
  *"<title>Oggi non posso</title>"*) echo "page: served" ;;
  *) fail "GET / is not the app's page" ;;
esac

code=$(curl -s -o /dev/null -w '%{http_code}' "${base}/e/3f2b8c1e-9a47-4d0b-8e65-1c7a2f9d4b10")
[ "$code" = "200" ] || fail "an event route answered ${code}, want 200 (the app's page)"
echo "event route: served"

created=$(curl -fsS -X POST "${base}/api/events" -H 'Content-Type: application/json' \
  -d '{"title":"Cena di dicembre","organiser_name":"Giulia","days":[{"date":"2030-12-13","slots":["dinner"]}]}') \
  || fail "creating an event failed"
case "$created" in
  *'"participant_token":"p_'*) echo "API: event created" ;;
  *) fail "unexpected answer to POST /api/events: ${created}" ;;
esac

docker stop "$name" >/dev/null
docker logs "$name" 2>&1 | grep -q '"msg":"stopped"' || fail "no clean stop on SIGTERM"
echo "SIGTERM: clean stop"

set +e
out=$(docker run --rm -e ONP_LOG_LEVEL=verbose "$image" 2>&1)
code=$?
set -e
echo "$out"
[ "$code" -eq 2 ] || fail "bad configuration exited with $code, want 2"
case "$out" in
  *ONP_LOG_LEVEL*) echo "bad configuration: exit 2, variable named" ;;
  *) fail "bad configuration message does not name ONP_LOG_LEVEL" ;;
esac

echo "Image ${image} starts, serves and stops as expected."
