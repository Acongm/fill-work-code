#!/usr/bin/env bash

die() {
  echo "$*" >&2
  exit 1
}

warn() {
  echo "$*" >&2
}

escape_tsv_field() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '%s' "$value"
}

validate_required_flag_value() {
  local flag_name="$1"
  local flag_value="${2-}"

  if [[ -z "$flag_value" ]]; then
    die "Missing value for ${flag_name}"
  fi
}

validate_date_flag() {
  local flag_name="$1"
  local date_value="$2"

  if [[ ! "$date_value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    die "Invalid date format for ${flag_name}: ${date_value}"
  fi
}

date_to_epoch() {
  local date_string="$1"

  if date -u -d "$date_string" +%s >/dev/null 2>&1; then
    date -u -d "$date_string" +%s
    return
  fi

  if date -u -j -f '%Y-%m-%d %H:%M:%S' "$date_string" +%s >/dev/null 2>&1; then
    date -u -j -f '%Y-%m-%d %H:%M:%S' "$date_string" +%s
    return
  fi

  die "Unable to parse date: $date_string"
}

parse_month_bounds() {
  local month="$1"
  validate_required_flag_value "--month" "$month"

  if [[ ! "$month" =~ ^[0-9]{4}/(0[1-9]|1[0-2])$ ]]; then
    die "Invalid month format: $month"
  fi

  local year="${month%%/*}"
  local month_num="${month##*/}"
  local next_year next_month

  MONTH_START="${year}-${month_num}-01"

  if [[ "$month_num" == "12" ]]; then
    next_year=$((10#$year + 1))
    next_month="01"
  else
    next_year="$year"
    next_month="$(printf '%02d' "$((10#$month_num + 1))")"
  fi

  NEXT_MONTH_START="${next_year}-${next_month}-01"
  MONTH_START_EPOCH="$(date_to_epoch "${MONTH_START} 00:00:00")"
  NEXT_MONTH_START_EPOCH="$(date_to_epoch "${NEXT_MONTH_START} 00:00:00")"
}

extract_repo_name() {
  local repo_root="$1"
  basename "$repo_root"
}

lookup_origin_url() {
  local repo_root="$1"
  git -C "$repo_root" config --get remote.origin.url 2>/dev/null || true
}

parse_origin_host() {
  local origin_url="${1-}"
  local remainder=""
  local host=""

  if [[ -z "$origin_url" ]]; then
    printf '%s\n' "(none)"
    return 0
  fi

  case "$origin_url" in
    *://*)
      remainder="${origin_url#*://}"
      remainder="${remainder#*@}"
      host="${remainder%%/*}"
      host="${host%%:*}"
      ;;
    *@*:* )
      remainder="${origin_url#*@}"
      host="${remainder%%:*}"
      ;;
    *)
      host=""
      ;;
  esac

  if [[ -z "$host" ]]; then
    printf '%s\n' "(unknown)"
    return 0
  fi

  printf '%s\n' "$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"
}

resolve_repo_root() {
  local repo_path="$1"
  local repo_root=""

  if repo_root="$(git -C "$repo_path" rev-parse --show-toplevel 2>/dev/null)"; then
    printf '%s\n' "$repo_root"
    return 0
  fi

  warn "Skipping repo path: $repo_path"
  return 1
}

normalize_comparison_token() {
  local value="${1-}"
  printf '%s' "$value" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]'
}

author_alias_matches() {
  local author_name="$1"
  local author_email="$2"
  shift 2

  local haystack alias lower_haystack lower_alias
  local normalized_haystack normalized_alias

  lower_haystack="$(
    printf '%s %s' "$author_name" "$author_email" | tr '[:upper:]' '[:lower:]'
  )"
  normalized_haystack="$(
    normalize_comparison_token "${author_name}${author_email}"
  )"

  for alias in "$@"; do
    [[ -z "$alias" ]] && continue
    lower_alias="$(printf '%s' "$alias" | tr '[:upper:]' '[:lower:]')"
    if [[ "$lower_haystack" == *"$lower_alias"* ]]; then
      return 0
    fi

    normalized_alias="$(normalize_comparison_token "$alias")"
    if [[ -n "$normalized_alias" && "$normalized_haystack" == *"$normalized_alias"* ]]; then
      return 0
    fi
  done

  return 1
}

create_since_marker_file() {
  local since_date="$1"
  local marker_file=""

  validate_date_flag "--since" "$since_date"

  marker_file="$(mktemp)"
  touch -t "${since_date//-/}0000" "$marker_file"
  printf '%s\n' "$marker_file"
}

repo_has_filesystem_activity_since() {
  local repo_root="$1"
  local marker_file="$2"
  local first_match=""

  first_match="$(
    find "$repo_root" -name .git -prune -o -newer "$marker_file" -print -quit
  )"

  if [[ -n "$first_match" ]]; then
    return 0
  fi

  return 1
}

# 范围采集：按 commit 时间判断仓库是否有活动（避免 --after/--before 同日为空）
# 匹配 origin 过滤项：纯主机名比 host；否则在完整 remote URL 上做子串匹配（忽略大小写）
origin_matches_filter() {
  local origin_url="$1"
  local origin_host="$2"
  local filter="$3"
  local url_lower host_lower filter_lower

  filter_lower="$(printf '%s' "$filter" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$filter_lower" ]]; then
    return 1
  fi

  url_lower="$(printf '%s' "$origin_url" | tr '[:upper:]' '[:lower:]')"
  host_lower="$(printf '%s' "$origin_host" | tr '[:upper:]' '[:lower:]')"

  if [[ "$filter_lower" =~ ^[a-z0-9.-]+$ ]]; then
    if [[ -n "$host_lower" && "$host_lower" == "$filter_lower" ]]; then
      return 0
    fi
    if [[ -n "$url_lower" && "$url_lower" == *"$filter_lower"* ]]; then
      return 0
    fi
    return 1
  fi

  if [[ -n "$url_lower" && "$url_lower" == *"$filter_lower"* ]]; then
    return 0
  fi

  return 1
}

repo_fetch_recent_refs() {
  local repo_root="$1"
  local branch=""

  git -C "$repo_root" fetch origin --depth=64 --quiet 2>/dev/null || true
  for branch in main master develop; do
    git -C "$repo_root" fetch origin "${branch}:refs/remotes/origin/${branch}" --depth=64 --quiet 2>/dev/null || true
  done
}

repo_has_commits_in_range() {
  local repo_root="$1"
  local since_date="$2"
  local until_date="$3"
  local head=""

  validate_date_flag "--since" "$since_date"
  validate_date_flag "--until" "$until_date"

  head="$(
    git -C "$repo_root" log --all --no-merges \
      --since="${since_date} 00:00:00" --until="${until_date} 00:00:00" \
      -1 --format=%H 2>/dev/null || true
  )"

  if [[ -n "$head" ]]; then
    return 0
  fi

  # 默认分支可能不是 main；补拉远程分支后再查一次（避免漏掉 main 上的周末提交）
  repo_fetch_recent_refs "$repo_root"
  head="$(
    git -C "$repo_root" log --all --no-merges \
      --since="${since_date} 00:00:00" --until="${until_date} 00:00:00" \
      -1 --format=%H 2>/dev/null || true
  )"

  if [[ -n "$head" ]]; then
    return 0
  fi

  return 1
}

stream_commits_in_month() {
  local repo_root="$1"
  local start_epoch="$2"
  local next_start_epoch="$3"

  git -C "$repo_root" log --all --reverse --date-order --no-merges --format='%H%x09%ct%x09%cI%x09%an%x09%ae%x09%s' \
    | awk -F '\t' -v start="$start_epoch" -v end="$next_start_epoch" '
    $2 ~ /^[0-9]+$/ && $2 >= start && $2 < end { print }
  '
}

is_revert_subject() {
  local subject="$1"
  [[ "$subject" == Revert\ * ]]
}

collect_changed_files_for_commit() {
  local repo_root="$1"
  local commit_sha="$2"

  git -C "$repo_root" diff-tree --root --no-commit-id --no-renames --name-only -r "$commit_sha" \
    | sed '/^$/d' \
    | sort -u \
    | awk '{ print }'
}

escape_tsv_list() {
  sed -e 's/\\/\\\\/g' -e $'s/\t/\\\\t/g' -e $'s/\r/\\\\r/g' -e 's/,/\\,/g' | paste -sd ',' -
}

top_dirs_from_changed_files() {
  awk -F/ '
    {
      if (NF == 1) {
        dirs["(root)"] = 1
      } else {
        dirs[$1] = 1
      }
    }
    END {
      for (dir in dirs) {
        print dir
      }
    }
  ' \
    | sort \
    | escape_tsv_list
}

serialize_changed_files_from_stdin() {
  escape_tsv_list
}
