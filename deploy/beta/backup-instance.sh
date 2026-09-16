#!/bin/sh
# Usage: sudo sh backup-instance.sh alice /mnt/offline-staging/alice-TIMESTAMP FULL_COMMIT NONSECRET_CONFIG_JSON
# Destination must be new/empty. Encrypt/copy/verify off-host separately before rollout.
set -eu
name=$1
destination=$2
release=$3
config=$4
umask 077
case "$name" in ''|*[!a-z0-9-]*) echo 'Invalid instance' >&2; exit 2;; esac
unit="guided-reader@$name.service"
current="/opt/guided-reader/instances/$name/current"
data="/var/lib/guided-reader/$name"
PYTHONPATH="$current/src" "$current/.venv/bin/python" -m reader_service.release verify --root "$current"
[ "$(cat "$current/RELEASE_COMMIT")" = "$release" ] || { echo "Release mismatch" >&2; exit 1; }
systemctl stop "$unit"
if systemctl is-active --quiet "$unit" || [ "$(systemctl show "$unit" -p MainPID --value)" != 0 ]; then
    echo 'Service is not stopped; no backup made' >&2; exit 1
fi
if [ "$(systemctl show "$unit" -p Result --value)" != success ]; then
    echo 'Shutdown failed or timed out; inspect unit, no backup/restart claimed' >&2; exit 1
fi
trap 'systemctl start "$unit"' EXIT
PYTHONPATH="$current/src" "$current/.venv/bin/python" -m reader_service.backup backup --source "$data" --destination "$destination" --release "$release" --config "$config"
PYTHONPATH="$current/src" "$current/.venv/bin/python" -m reader_service.backup verify --source "$destination"
