#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_dir/common.sh"

month=""
repos_file=""
author_aliases=()

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
    --author-alias)
      validate_required_flag_value "--author-alias" "${2-}"
      author_aliases+=("$2")
      shift 2
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

validate_required_flag_value "--month" "$month"
validate_required_flag_value "--repos-file" "$repos_file"

if [[ "${#author_aliases[@]}" -eq 0 ]]; then
  die "At least one --author-alias value is required"
fi

if [[ ! -r "$repos_file" ]]; then
  die "Repos file not readable: $repos_file"
fi

parse_month_bounds "$month"

while IFS= read -r repo_path || [[ -n "$repo_path" ]]; do
  [[ -z "${repo_path//[[:space:]]/}" ]] && continue

  if ! repo_root="$(resolve_repo_root "$repo_path")"; then
    continue
  fi

  repo_name="$(extract_repo_name "$repo_root")"
  origin_url="$(lookup_origin_url "$repo_root")"

  commit_count=0
  first_commit_at=""
  last_commit_at=""

  if ! commits_output="$(stream_commits_in_month "$repo_root" "$MONTH_START_EPOCH" "$NEXT_MONTH_START_EPOCH")"; then
    warn "Skipping repo path: $repo_path (git log failed)"
    continue
  fi

  while IFS=$'\t' read -r commit_sha commit_epoch commit_at author_name author_email subject; do
    [[ -z "${commit_sha:-}" ]] && continue
    is_revert_subject "$subject" && continue
    author_alias_matches "$author_name" "$author_email" "${author_aliases[@]}" || continue

    if [[ "$commit_count" -eq 0 ]]; then
      first_commit_at="$commit_at"
    fi

    last_commit_at="$commit_at"
    commit_count=$((commit_count + 1))
  done <<<"$commits_output"

  if [[ "$commit_count" -gt 0 ]]; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$(escape_tsv_field "$repo_root")" \
      "$(escape_tsv_field "$repo_name")" \
      "$(escape_tsv_field "$origin_url")" \
      "$commit_count" \
      "$(escape_tsv_field "$first_commit_at")" \
      "$(escape_tsv_field "$last_commit_at")"
  fi
done < "$repos_file"
