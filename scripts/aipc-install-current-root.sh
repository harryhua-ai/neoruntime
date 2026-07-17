#!/bin/bash
# Rebuild the rootfs-local AIPC integration from the persistent /data release.
#
# The OS image owns only the generic aipc-app-bootstrap launcher. Everything
# that can change with an AIPC release (units, helpers, binaries, compatibility
# fields and configuration drop-ins) is restored by this application-owned,
# slot-agnostic installer.

set -euo pipefail

DATA_ROOT="${AIPC_INSTALL_ROOT:-/data/aipc}"
ROOTFS_PREFIX="${AIPC_ROOTFS_PREFIX:-}"
SYSTEMCTL="${AIPC_SYSTEMCTL:-systemctl}"
SYSCTL="${AIPC_SYSCTL:-sysctl}"
LDCONFIG="${AIPC_LDCONFIG:-ldconfig}"
ACTIVATE="${AIPC_ACTIVATE:-1}"
TAG="aipc-current-root"

root_path() { printf '%s%s' "$ROOTFS_PREFIX" "$1"; }
log() { echo "[$TAG] $*"; }
warn() { echo "[$TAG] WARN: $*" >&2; }
fail() { echo "[$TAG] ERROR: $*" >&2; exit 1; }

MANIFEST="$DATA_ROOT/app-manifest.json"
UNIT_SOURCE="$DATA_ROOT/systemd"
OS_RELEASE_FILE="$(root_path /etc/aipc-os-release)"
COMPAT_CHECK="$DATA_ROOT/libexec/aipc-compat-check"

[[ -f "$MANIFEST" ]] || fail "missing persistent app manifest: $MANIFEST"
[[ -d "$UNIT_SOURCE" ]] || fail "missing canonical systemd units: $UNIT_SOURCE"
[[ -f "$OS_RELEASE_FILE" ]] || fail "OS compatibility stub is missing: $OS_RELEASE_FILE"
[[ -x "$COMPAT_CHECK" ]] || fail "missing compatibility checker: $COMPAT_CHECK"

json_number() {
    sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$1" | head -1
}

json_string() {
    sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1
}

# Compatibility capabilities are OS-owned. The application may validate them
# but must never rewrite them from its own requirements.
grep -Eq '^MACHINE=.+$' "$OS_RELEASE_FILE" || fail "OS compatibility metadata has no MACHINE"
grep -Eq '^AIPC_COMPAT_LEVEL=[1-9][0-9]*$' "$OS_RELEASE_FILE" || \
    fail "OS compatibility metadata has invalid AIPC_COMPAT_LEVEL"
grep -Eq '^DATA_SCHEMA=[1-9][0-9]*$' "$OS_RELEASE_FILE" || \
    fail "OS compatibility metadata has invalid DATA_SCHEMA"
[[ -n "$(json_string "$MANIFEST" machine)" && -n "$(json_number "$MANIFEST" required_compat_level)" && \
   -n "$(json_number "$MANIFEST" target_data_schema)" ]] || \
    fail "persistent app manifest has incomplete compatibility metadata"

if [[ -z "$ROOTFS_PREFIX" ]]; then
    AIPC_OS_COMPATIBILITY_FILE="$OS_RELEASE_FILE" \
    AIPC_APP_MANIFEST="$MANIFEST" \
    "$COMPAT_CHECK"
fi

# Recreate rootfs-local executable links. The real files live on /data and
# survive both A/B slot switches and single-copy rootfs replacement.
USR_BIN_DIR="$(root_path /usr/bin)"
USR_LIBEXEC_DIR="$(root_path /usr/libexec)"
mkdir -p "$USR_BIN_DIR" "$USR_LIBEXEC_DIR"
for file in "$DATA_ROOT"/bin/*; do
    [[ -f "$file" && -x "$file" ]] || continue
    name="$(basename -- "$file")"
    case "$name" in *.py) continue ;; esac
    ln -sfn "$file" "$USR_BIN_DIR/$name"
done
for file in "$DATA_ROOT"/libexec/*; do
    [[ -f "$file" && -x "$file" ]] || continue
    name="$(basename -- "$file")"
    ln -sfn "$file" "$USR_LIBEXEC_DIR/$name"
done

# Restore application-owned rootfs configuration removed by an OS rewrite.
SYSTEM_CONF_DIR="$(root_path /etc/systemd/system.conf.d)"
JOURNAL_CONF_DIR="$(root_path /etc/systemd/journald.conf.d)"
SYSCTL_DIR="$(root_path /etc/sysctl.d)"
SECURITY_DIR="$(root_path /etc/aipc)"
LDCONFIG_DIR="$(root_path /etc/ld.so.conf.d)"
mkdir -p "$SYSTEM_CONF_DIR" "$JOURNAL_CONF_DIR" "$SYSCTL_DIR" "$SECURITY_DIR" "$LDCONFIG_DIR"

for file in "$DATA_ROOT"/etc/systemd/system.conf.d/*.conf; do
    [[ -f "$file" ]] && cp -f "$file" "$SYSTEM_CONF_DIR/"
done
for file in "$DATA_ROOT"/etc/systemd/journald.conf.d/*.conf; do
    [[ -f "$file" ]] && cp -f "$file" "$JOURNAL_CONF_DIR/"
done
for file in "$DATA_ROOT"/etc/sysctl.d/*.conf; do
    [[ -f "$file" ]] || continue
    cp -f "$file" "$SYSCTL_DIR/"
    if [[ -z "$ROOTFS_PREFIX" && "$ACTIVATE" == "1" ]]; then
        "$SYSCTL" -p "$SYSCTL_DIR/$(basename -- "$file")" >/dev/null 2>&1 || \
            warn "failed to apply $(basename -- "$file")"
    fi
done
if [[ -f "$DATA_ROOT/etc/security/seccomp-default.json" ]]; then
    cp -f "$DATA_ROOT/etc/security/seccomp-default.json" "$SECURITY_DIR/seccomp-default.json"
fi
printf '%s\n' "$DATA_ROOT/lib/hal" >"$LDCONFIG_DIR/aipc.conf"

# Promote and enable the exact unit set staged by this AIPC release. The source
# directory is mirrored during deploy, so removed services do not survive as
# stale units in a later release.
SYSTEMD_DIR="$(root_path /etc/systemd/system)"
mkdir -p "$SYSTEMD_DIR"
shopt -s nullglob
units=("$UNIT_SOURCE"/*.service "$UNIT_SOURCE"/*.timer "$UNIT_SOURCE"/*.target)
(( ${#units[@]} > 0 )) || fail "canonical systemd unit set is empty"

for unit in "${units[@]}"; do
    name="$(basename -- "$unit")"
    cp -f "$unit" "$SYSTEMD_DIR/$name"
    if [[ -z "$ROOTFS_PREFIX" && "$ACTIVATE" == "1" ]]; then
        "$SYSTEMCTL" enable "$name" >/dev/null 2>&1 || warn "could not enable $name"
    fi
done

[[ -f "$SYSTEMD_DIR/aipc-platform.target" ]] || fail "aipc-platform.target is missing from canonical units"

if [[ -z "$ROOTFS_PREFIX" && "$ACTIVATE" == "1" ]]; then
    "$LDCONFIG" 2>/dev/null || warn "ldconfig failed"
    "$SYSTEMCTL" daemon-reexec 2>/dev/null || "$SYSTEMCTL" daemon-reload 2>/dev/null || \
        fail "systemd reload failed"
    "$SYSTEMCTL" try-restart systemd-journald.service >/dev/null 2>&1 || true
    # Start only the application boot chain and stable platform target. Starting
    # every copied oneshot would incorrectly trigger maintenance-only services
    # such as aipc-os-updater or aipc-os-reboot.
    boot_units=(
        aipc-restore.service
        aipc-firstboot.service
        aipc-mcu-prep.service
        aipc-autostart.service
        aipc-platform.target
        aipc-os-verify.service
        aipc-logrotate.timer
    )
    "$SYSTEMCTL" start --no-block "${boot_units[@]}" >/dev/null 2>&1 || \
        fail "failed to queue promoted AIPC units"
fi

log "installed ${#units[@]} unit(s) and rebuilt current-root integration"
