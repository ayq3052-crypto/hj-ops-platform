#!/bin/zsh
set -euo pipefail

umask 077

script_dir="${0:A:h}"
repo_dir="${script_dir:h}"
backup_dir="${HJ_BACKUP_DIR:-/Users/hourjungle/Documents/HJ-backups/3052}"
db_host="${HJ_DB_HOST:-aws-1-ap-southeast-2.pooler.supabase.com}"
db_port="${HJ_DB_PORT:-6543}"
db_user="${HJ_DB_USER:-postgres.khpgrfpnvgzkfjmxhuny}"
db_name="${HJ_DB_NAME:-postgres}"
project_ref="${HJ_SUPABASE_PROJECT_REF:-khpgrfpnvgzkfjmxhuny}"

if [[ "$backup_dir" != /* ]]; then
  echo "錯誤：HJ_BACKUP_DIR 必須是絕對路徑。" >&2
  exit 1
fi
if [[ -e "$repo_dir/.git" && "$backup_dir" == "$repo_dir"* ]]; then
  echo "錯誤：備份目錄不可位於 Git repository 內。" >&2
  exit 1
fi
if [[ "$backup_dir" == "/" || "$backup_dir" == "/Users/hourjungle" ]]; then
  echo "錯誤：備份目錄範圍過大。" >&2
  exit 1
fi

pg_dump_bin="${HJ_PG_DUMP_BIN:-/opt/homebrew/opt/libpq/bin/pg_dump}"
pg_restore_bin="${HJ_PG_RESTORE_BIN:-/opt/homebrew/opt/libpq/bin/pg_restore}"
openssl_bin="${HJ_OPENSSL_BIN:-/opt/homebrew/bin/openssl}"
node_bin="${HJ_NODE_BIN:-/Users/hourjungle/.nvm/versions/node/v24.14.1/bin/node}"
rclone_bin="${HJ_RCLONE_BIN:-/opt/homebrew/bin/rclone}"
jq_bin="${HJ_JQ_BIN:-/usr/bin/jq}"
drive_remote="${HJ_BACKUP_DRIVE_REMOTE:-hj3052-gdrive}"
drive_folder="${HJ_BACKUP_DRIVE_FOLDER:-HJ3052-Backups}"
if [[ ! -x "$openssl_bin" ]]; then
  echo "錯誤：找不到 OpenSSL，禁止建立未加密的客戶資料備份。" >&2
  exit 1
fi
if [[ ! -x "$node_bin" ]]; then
  echo "錯誤：找不到 Node.js，無法執行備份核對。" >&2
  exit 1
fi

backup_key="$(security find-generic-password -s HJ_3052_BACKUP_ENCRYPTION_KEY -a hourjungle -w 2>/dev/null || true)"
if [[ -z "$backup_key" ]]; then
  backup_key="$("$openssl_bin" rand -base64 48)"
  security add-generic-password \
    -U \
    -s HJ_3052_BACKUP_ENCRYPTION_KEY \
    -a hourjungle \
    -w "$backup_key" >/dev/null
fi

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
lock_dir="${backup_dir}/.backup-in-progress"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "已有一份 3052 備份正在執行，本次安全略過。" >&2
  exit 0
fi
temp_root="$(mktemp -d "${TMPDIR:-/tmp}/hj3052-backup.XXXXXX")"
if [[ -z "$temp_root" || ! -d "$temp_root" ]]; then
  echo "錯誤：無法建立暫存目錄。" >&2
  exit 1
fi
cleanup() {
  local exit_status=$?
  rm -rf -- "$temp_root"
  rmdir "$lock_dir" 2>/dev/null || true
  if (( exit_status != 0 )); then
    /usr/bin/osascript -e 'display notification "本機可能已有備份，但雲端上傳或核對未完成，請檢查備份紀錄。" with title "3052 備份失敗"' >/dev/null 2>&1 || true
  fi
  return "$exit_status"
}
trap cleanup EXIT

timestamp="$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S)"
backup_mode=""
plain_archive=""
archive_name=""

db_password="${HJ_DB_PASSWORD:-}"
if [[ -z "$db_password" ]]; then
  db_password="$(security find-generic-password -s HJ_SUPABASE_DB_PASSWORD -w 2>/dev/null || true)"
fi

if [[ -n "$db_password" && -x "$pg_dump_bin" && -x "$pg_restore_bin" ]]; then
  dump_path="${temp_root}/3052-public.dump"
  if PGPASSWORD="$db_password" "$pg_dump_bin" \
    --host="$db_host" \
    --port="$db_port" \
    --username="$db_user" \
    --dbname="$db_name" \
    --schema=public \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-acl \
    --file="$dump_path" 2>"${temp_root}/pg-dump-error.log"; then
    "$pg_restore_bin" --list "$dump_path" >/dev/null
    backup_mode="pg_dump"
    plain_archive="$dump_path"
    archive_name="3052-public-${timestamp}.dump.enc"
  fi
fi

if [[ -z "$backup_mode" ]]; then
  access_token="${HJ_SUPABASE_ACCESS_TOKEN:-}"
  service_role_key="${HJ_SUPABASE_SERVICE_ROLE_KEY:-}"
  if [[ -z "$access_token" ]]; then
    access_token="$(security find-generic-password -s HJ_SUPABASE_ACCESS_TOKEN -a "$project_ref" -w 2>/dev/null || true)"
  fi
  if [[ -z "$service_role_key" ]]; then
    service_role_key="$(security find-generic-password -s HJ_SUPABASE_SERVICE_ROLE_KEY -a "$project_ref" -w 2>/dev/null || true)"
  fi
  if [[ -z "$access_token" || -z "$service_role_key" ]]; then
    echo "錯誤：pg_dump 無法登入，且 Keychain 缺少 REST 備份金鑰。" >&2
    exit 1
  fi
  export_dir="${temp_root}/rest-export"
  HJ_SUPABASE_ACCESS_TOKEN="$access_token" \
    HJ_SUPABASE_SERVICE_ROLE_KEY="$service_role_key" \
    HJ_SUPABASE_PROJECT_REF="$project_ref" \
    "$node_bin" "${script_dir}/backup-3052-rest.mjs" "$export_dir"
  "$node_bin" "${script_dir}/verify-3052-rest-directory.mjs" "$export_dir"
  plain_archive="${temp_root}/3052-public-rest.tar.gz"
  tar -czf "$plain_archive" -C "$export_dir" .
  tar -tzf "$plain_archive" >/dev/null
  backup_mode="rest_json"
  archive_name="3052-public-${timestamp}.rest.tar.gz.enc"
fi

archive_path="${backup_dir}/${archive_name}"
checksum_path="${archive_path}.sha256"
manifest_path="${archive_path}.manifest.txt"

HJ_TASK_BACKUP_KEY="$backup_key" "$openssl_bin" enc \
  -aes-256-cbc \
  -pbkdf2 \
  -salt \
  -in "$plain_archive" \
  -out "$archive_path" \
  -pass env:HJ_TASK_BACKUP_KEY
chmod 600 "$archive_path"

checksum="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
printf '%s  %s\n' "$checksum" "$archive_name" >"$checksum_path"
chmod 600 "$checksum_path"

{
  printf 'created_at_taipei=%s\n' "$(TZ=Asia/Taipei date -Iseconds)"
  printf 'archive=%s\n' "$archive_name"
  printf 'sha256=%s\n' "$checksum"
  printf 'mode=%s\n' "$backup_mode"
  printf 'scope=public_schema\n'
  printf 'encrypted=true\n'
  printf 'archive_content_verified=true\n'
  printf 'restore_test_verified=false\n'
} >"$manifest_path"
chmod 600 "$manifest_path"

cloud_upload_verified="false"
if [[ ! -x "$rclone_bin" ]]; then
  echo "錯誤：本機備份已建立，但找不到 rclone，Google Drive 備份失敗。" >&2
  exit 1
fi
if [[ ! -x "$jq_bin" ]]; then
  echo "錯誤：本機備份已建立，但找不到 jq，無法核對雲端備份。" >&2
  exit 1
fi
if ! "$rclone_bin" listremotes --log-level ERROR | grep -qx "${drive_remote}:"; then
  echo "錯誤：本機備份已建立，但 Google Drive 授權不存在。" >&2
  exit 1
fi

"$rclone_bin" mkdir "${drive_remote}:${drive_folder}" --log-level ERROR
for local_path in "$archive_path" "$checksum_path"; do
  "$rclone_bin" copyto \
    "$local_path" \
    "${drive_remote}:${drive_folder}/${local_path:t}" \
    --checksum \
    --log-level ERROR
done

remote_size="$("$rclone_bin" size \
  "${drive_remote}:${drive_folder}/${archive_name}" \
  --json \
  --log-level ERROR | "$jq_bin" -r '.bytes')"
local_size="$(stat -f '%z' "$archive_path")"
if [[ "$remote_size" != "$local_size" ]]; then
  echo "錯誤：Google Drive 備份大小與本機不一致。" >&2
  exit 1
fi

cloud_upload_verified="true"
{
  printf 'cloud_remote=%s\n' "$drive_remote"
  printf 'cloud_folder=%s\n' "$drive_folder"
  printf 'cloud_upload_verified=true\n'
} >>"$manifest_path"
"$rclone_bin" copyto \
  "$manifest_path" \
  "${drive_remote}:${drive_folder}/${manifest_path:t}" \
  --checksum \
  --log-level ERROR

echo "BACKUP_CREATED=$archive_path"
echo "BACKUP_MODE=$backup_mode"
echo "ENCRYPTED=true"
echo "ARCHIVE_CONTENT_VERIFIED=true"
echo "RESTORE_TEST_VERIFIED=false"
echo "CLOUD_UPLOAD_VERIFIED=$cloud_upload_verified"
