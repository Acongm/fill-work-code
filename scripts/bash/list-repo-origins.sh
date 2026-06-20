#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_dir/common.sh"

repos_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
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

validate_required_flag_value "--repos-file" "$repos_file"

if [[ ! -r "$repos_file" ]]; then
  die "Repos file not readable: $repos_file"
fi

while IFS= read -r repo_path || [[ -n "$repo_path" ]]; do
  [[ -z "${repo_path//[[:space:]]/}" ]] && continue

  if ! repo_root="$(resolve_repo_root "$repo_path")"; then
    continue
  fi

  repo_name="$(extract_repo_name "$repo_root")"
  origin_url="$(lookup_origin_url "$repo_root")"
  origin_host="$(parse_origin_host "$origin_url")"

  printf '%s\t%s\t%s\t%s\n' \
    "$(escape_tsv_field "$repo_root")" \
    "$(escape_tsv_field "$repo_name")" \
    "$(escape_tsv_field "$origin_url")" \
    "$(escape_tsv_field "$origin_host")"
done < "$repos_file"
