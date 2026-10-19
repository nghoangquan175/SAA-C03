#!/usr/bin/env bash
# Sets the login of the site: writes SHA-256(username:password:SALT) to the
# CloudFront KeyValueStore. Every existing session is signed out.
# Usage: infras/scripts/set-password.sh   (prompts; or set SAA_USER / SAA_PASS)
set -euo pipefail
cd "$(dirname "$0")/.."

SALT="saa-quannh-xyz-v1" # must match public/login.js
PROFILE="${AWS_PROFILE:-saa}"
KVS_ARN="$(terraform output -raw kvs_arn)"

USERNAME="${SAA_USER:-}"
PASSWORD="${SAA_PASS:-}"
[ -n "$USERNAME" ] || read -rp "Username: " USERNAME
[ -n "$PASSWORD" ] || { read -rsp "Password: " PASSWORD; echo; }

HASH="$(printf '%s' "$USERNAME:$PASSWORD:$SALT" | sha256sum | cut -d' ' -f1)"
ETAG="$(aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$KVS_ARN" \
  --profile "$PROFILE" --region us-east-1 --query ETag --output text)"
aws cloudfront-keyvaluestore put-key --kvs-arn "$KVS_ARN" --key auth_hash --value "$HASH" \
  --if-match "$ETAG" --profile "$PROFILE" --region us-east-1 >/dev/null

echo "Login updated for '$USERNAME' (takes a few seconds to reach every edge location)."
