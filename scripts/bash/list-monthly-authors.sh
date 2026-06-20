#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_dir/common.sh"

month=""
repos_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --month)
      validate_required_flag_value "--month" "${2-}"
      month="$2"
      shift 2
      ;;
    --repos-file)
      validate_required_flag_value "--repos-file" "${2-}"
      repos_file="$2"
      shift 2
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

validate_required_flag_value "--month" "$month"
validate_required_flag_value "--repos-file" "$repos_file"

if [[ ! -r "$repos_file" ]]; then
  die "Repos file not readable: $repos_file"
fi

parse_month_bounds "$month"

while IFS= read -r repo_path || [[ -n "$repo_path" ]]; do
  [[ -z "${repo_path//[[:space:]]/}" ]] && continue

  if ! repo_root="$(resolve_repo_root "$repo_path")"; then
    continue
  fi

  if ! commits_output="$(stream_commits_in_month "$repo_root" "$MONTH_START_EPOCH" "$NEXT_MONTH_START_EPOCH")"; then
    warn "Skipping repo path: $repo_path (git log failed)"
    continue
  fi

  while IFS=$'\t' read -r commit_sha commit_epoch commit_at author_name author_email subject; do
    [[ -z "${commit_sha:-}" ]] && continue
    is_revert_subject "$subject" && continue

    printf '%s\t%s\n' \
      "$(escape_tsv_field "$author_name")" \
      "$(escape_tsv_field "$author_email")"
  done <<<"$commits_output"
done < "$repos_file" | sort -u
