#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_dir/common.sh"

origins_file=""
origin_filters=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --origins-file)
      validate_required_flag_value "--origins-file" "${2-}"
      origins_file="$2"
      shift 2
      ;;
    --origin-filter|--origin-host)
      validate_required_flag_value "$1" "${2-}"
      origin_filters+=("$2")
      shift 2
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

validate_required_flag_value "--origins-file" "$origins_file"

if [[ "${#origin_filters[@]}" -eq 0 ]]; then
  die "At least one --origin-filter (or --origin-host) value is required"
fi

if [[ ! -r "$origins_file" ]]; then
  die "Origins file not readable: $origins_file"
fi

while IFS= read -r origin_row || [[ -n "$origin_row" ]]; do
  [[ -z "${origin_row//[[:space:]]/}" ]] && continue

  repo_path="$(printf '%s\n' "$origin_row" | awk -F '\t' '{ print $1 }')"
  origin_url="$(printf '%s\n' "$origin_row" | awk -F '\t' '{ print $3 }')"
  origin_host="$(printf '%s\n' "$origin_row" | awk -F '\t' '{ print $4 }')"

  for selected in "${origin_filters[@]}"; do
    if origin_matches_filter "$origin_url" "$origin_host" "$selected"; then
      printf '%s\n' "$repo_path"
      break
    fi
  done
done < "$origins_file"
