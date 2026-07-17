#!/bin/sh

set -eu

SWU=""
DEST=""
MACHINE="hailo15-ne503"
BSP_VERSION="unknown"
RECOVERY_VERSION="1.0.0"
KEY_ID=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        --swu) SWU="$2"; shift 2 ;;
        --dest) DEST="$2"; shift 2 ;;
        --machine) MACHINE="$2"; shift 2 ;;
        --bsp-version) BSP_VERSION="$2"; shift 2 ;;
        --recovery-version) RECOVERY_VERSION="$2"; shift 2 ;;
        --key-id) KEY_ID="$2"; shift 2 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done

if [ -z "$SWU" ] || [ ! -f "$SWU" ]; then
    echo "Recovery source SWU not found: ${SWU:-<empty>}" >&2
    exit 1
fi
if [ -z "$DEST" ]; then
    echo "--dest is required" >&2
    exit 2
fi

ROOTFS="swupdate-image-${MACHINE}.ext4.gz"
mkdir -p "$DEST"
tmp="${DEST}/.tmp.$$"
mkdir -p "$tmp"
trap 'rm -rf "$tmp"' EXIT

cpio -i --quiet --to-stdout fitImage < "$SWU" > "$tmp/fitImage"
cpio -i --quiet --to-stdout "$ROOTFS" < "$SWU" > "$tmp/$ROOTFS"
gzip -t "$tmp/$ROOTFS"

if ! gzip -dc "$tmp/$ROOTFS" 2>/dev/null | grep -a -q AIPC_LOCAL_RECOVERY_V1; then
    echo "Recovery rootfs in $SWU does not support AIPC_LOCAL_RECOVERY_V1" >&2
    exit 1
fi

# Validate the actual PID 1 script, not only the protocol marker. Bash process
# substitution requires /dev/fd and caused a recovery kernel-panic loop on the
# minimal Hailo ramdisk when PID 1 exited with /dev/fd/63 missing.
if ! command -v debugfs >/dev/null 2>&1; then
    echo "debugfs is required to validate the Recovery init script" >&2
    exit 1
fi
gzip -dc "$tmp/$ROOTFS" >"$tmp/recovery.ext4"
debugfs -R "dump /sbin/init.initscripts-hailo-swupdate $tmp/recovery-init" \
    "$tmp/recovery.ext4" >/dev/null 2>&1 || {
        echo "Recovery rootfs does not contain the expected SWUpdate init" >&2
        exit 1
    }
if grep -Eq '(^|[[:space:]])exec[[:space:]]*>[[:space:]]*>[(]' "$tmp/recovery-init"; then
    echo "Recovery init uses unsafe process substitution for PID 1 logging" >&2
    exit 1
fi
if ! grep -q 'Starting an emergency shell instead of exiting PID 1' "$tmp/recovery-init"; then
    echo "Recovery init lacks the PID 1 emergency-shell guard" >&2
    exit 1
fi
bash -n "$tmp/recovery-init"

fit_sha="$(sha256sum "$tmp/fitImage" | awk '{print $1}')"
root_sha="$(sha256sum "$tmp/$ROOTFS" | awk '{print $1}')"
fit_size="$(stat -c %s "$tmp/fitImage")"
root_size="$(stat -c %s "$tmp/$ROOTFS")"

cat > "$tmp/manifest.json" <<EOF
{
  "format": 1,
  "machine": "$MACHINE",
  "bsp_version": "$BSP_VERSION",
  "recovery_version": "$RECOVERY_VERSION",
  "local_update_protocol": "AIPC_LOCAL_RECOVERY_V1",
  "secure_boot_key_id": "$KEY_ID",
  "fit_image": {
    "file": "fitImage",
    "sha256": "$fit_sha",
    "size": $fit_size
  },
  "rootfs": {
    "file": "$ROOTFS",
    "sha256": "$root_sha",
    "size": $root_size
  }
}
EOF

mv "$tmp/fitImage" "$DEST/fitImage"
mv "$tmp/$ROOTFS" "$DEST/$ROOTFS"
mv "$tmp/manifest.json" "$DEST/manifest.json"
chmod 0644 "$DEST/fitImage" "$DEST/$ROOTFS" "$DEST/manifest.json"

echo "Prepared bundled recovery: $DEST"
