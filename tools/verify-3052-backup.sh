#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
backup_path="${1:-}"
openssl_bin="${HJ_OPENSSL_BIN:-/opt/homebrew/bin/openssl}"
pg_restore_bin="${HJ_PG_RESTORE_BIN:-/opt/homebrew/opt/libpq/bin/pg_restore}"
node_bin="${HJ_NODE_BIN:-/Users/hourjungle/.nvm/versions/node/v24.14.1/bin/node}"

if [[ -z "$backup_path" || "$backup_path" != /* || ! -f "$backup_path" ]]; then
  echo "用法：tools/verify-3052-backup.sh /絕對路徑/備份檔.enc" >&2
  exit 1
fi
if [[ ! -x "$openssl_bin" ]]; then
  echo "錯誤：找不到 OpenSSL。" >&2
  exit 1
fi

backup_key="$(security find-generic-password -s HJ_3052_BACKUP_ENCRYPTION_KEY -a hourjungle -w 2>/dev/null || true)"
if [[ -z "$backup_key" ]]; then
  echo "錯誤：Keychain 中找不到備份解密金鑰。" >&2
  exit 1
fi

temp_root="$(mktemp -d "${TMPDIR:-/tmp}/hj3052-verify.XXXXXX")"
if [[ -z "$temp_root" || ! -d "$temp_root" ]]; then
  echo "錯誤：無法建立暫存目錄。" >&2
  exit 1
fi
cleanup() {
  rm -rf -- "$temp_root"
}
trap cleanup EXIT

if [[ "$backup_path" == *.rest.tar.gz.enc ]]; then
  decrypted="${temp_root}/backup.tar.gz"
  HJ_TASK_BACKUP_KEY="$backup_key" "$openssl_bin" enc \
    -d \
    -aes-256-cbc \
    -pbkdf2 \
    -in "$backup_path" \
    -out "$decrypted" \
    -pass env:HJ_TASK_BACKUP_KEY
  tar -tzf "$decrypted" >/dev/null
  export_dir="${temp_root}/export"
  mkdir -p "$export_dir"
  tar -xzf "$decrypted" -C "$export_dir"
  "$node_bin" "${script_dir}/verify-3052-rest-directory.mjs" "$export_dir"
elif [[ "$backup_path" == *.dump.enc ]]; then
  if [[ ! -x "$pg_restore_bin" ]]; then
    echo "錯誤：找不到 pg_restore。" >&2
    exit 1
  fi
  decrypted="${temp_root}/backup.dump"
  HJ_TASK_BACKUP_KEY="$backup_key" "$openssl_bin" enc \
    -d \
    -aes-256-cbc \
    -pbkdf2 \
    -in "$backup_path" \
    -out "$decrypted" \
    -pass env:HJ_TASK_BACKUP_KEY
  "$pg_restore_bin" --list "$decrypted" >/dev/null
  echo "BACKUP_CONTENT_VERIFIED=true"
else
  echo "錯誤：不支援的備份格式。" >&2
  exit 1
fi

echo "ENCRYPTION_VERIFIED=true"
manifest_path="${backup_path}.manifest.txt"
restore_verified="false"
if [[ -f "$manifest_path" ]]; then
  manifest_value="$(awk -F= '$1 == "restore_test_verified" { print $2; exit }' "$manifest_path")"
  if [[ "$manifest_value" == "true" ]]; then
    restore_verified="true"
  fi
fi
echo "RESTORE_TEST_VERIFIED=$restore_verified"
