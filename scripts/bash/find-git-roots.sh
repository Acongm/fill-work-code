#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_dir/common.sh"

search_roots=()
since_date=""
until_date=""
primary_only=0
deduplicate_origins=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --search-root)
      validate_required_flag_value "--search-root" "${2-}"
      search_roots+=("$2")
      shift 2
      ;;
    --since)
      validate_required_flag_value "--since" "${2-}"
      since_date="$2"
      shift 2
      ;;
    --until)
      validate_required_flag_value "--until" "${2-}"
      until_date="$2"
      shift 2
      ;;
    --primary-only)
      primary_only=1
      shift
      ;;
    --deduplicate-origins)
      deduplicate_origins=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "${#search_roots[@]}" -eq 0 ]]; then
  if [[ -d "${HOME}/IdeaProject" ]]; then
    search_roots+=("${HOME}/IdeaProject")
  fi

  if [[ -d "${HOME}/IdeaProjects" ]]; then
    search_roots+=("${HOME}/IdeaProjects")
  fi
fi

if [[ "${#search_roots[@]}" -eq 0 ]]; then
  exit 0
fi

root_already_seen() {
  local candidate="$1"
  local existing
  if [[ "${#valid_roots[@]}" -eq 0 ]]; then
    return 1
  fi
  for existing in "${valid_roots[@]}"; do
    if [[ "$candidate" == "$existing" ]]; then
      return 0
    fi
  done
  return 1
}

valid_roots=()
for search_root in "${search_roots[@]}"; do
  [[ -d "$search_root" ]] || continue
  search_root="$(cd "$search_root" && pwd -P)"
  echo "[progress] 扫描目录: ${search_root}" >&2
  echo "[progress] 开始遍历 .git（发现后将逐条输出）…" >&2

  scanned_git_entries=0
  found_in_root=0
  while IFS= read -r git_entry; do
    [[ -z "$git_entry" ]] && continue
    scanned_git_entries=$((scanned_git_entries + 1))
    if (( scanned_git_entries % 20 == 0 )); then
      echo "[progress] 遍历中… 已检查 ${scanned_git_entries} 个 .git 路径（本目录已发现 ${found_in_root} 个仓库）" >&2
    fi

    repo_dir="$(dirname "$git_entry")"
    root="$(git -C "$repo_dir" rev-parse --show-toplevel 2>/dev/null || true)"
    if [[ -z "$root" ]]; then
      continue
    fi
    if root_already_seen "$root"; then
      continue
    fi

    valid_roots+=("$root")
    found_in_root=$((found_in_root + 1))
    echo "[progress] 发现仓库 #${found_in_root}: ${root}" >&2
  done < <(
    find "$search_root" \( -type d -name .git -o -type f -name .git \) -print 2>/dev/null
  )

  echo "[progress] 目录扫描完成: ${search_root}（检查 ${scanned_git_entries} 个 .git，新增 ${found_in_root} 个仓库根）" >&2
done

if [[ "${#valid_roots[@]}" -eq 0 ]]; then
  exit 0
fi

selected=()
while IFS= read -r repo; do
  [[ -z "$repo" ]] && continue

  skip=0
  if [[ "${#selected[@]}" -gt 0 ]]; then
    for chosen in "${selected[@]}"; do
      if [[ "$repo" == "$chosen" || "$repo" == "$chosen"/* ]]; then
        skip=1
        break
      fi
    done
  fi

  if [[ "$skip" -eq 0 ]]; then
    selected+=("$repo")
  fi
done < <(
  printf '%s\n' "${valid_roots[@]}" \
    | awk '!seen[$0]++ { print length($0) "\t" $0 }' \
    | sort -n -k1,1 -k2,2 \
    | cut -f2-
)

filtered=()
if [[ -n "$since_date" && -n "$until_date" ]]; then
  echo "[progress] 按 commit 时间 ${since_date} ~ ${until_date} 过滤 ${#selected[@]} 个仓库…" >&2
  for repo in "${selected[@]}"; do
    if repo_has_commits_in_range "$repo" "$since_date" "$until_date"; then
      filtered+=("$repo")
      echo "[progress] ✓ ${repo}" >&2
    fi
  done
elif [[ -n "$since_date" ]]; then
  marker_file="$(create_since_marker_file "$since_date")"
  trap 'rm -f "${marker_file:-}"' EXIT
  echo "[progress] 按文件活动日期 ${since_date} 过滤 ${#selected[@]} 个仓库…" >&2

  for repo in "${selected[@]}"; do
    if repo_has_filesystem_activity_since "$repo" "$marker_file"; then
      filtered+=("$repo")
      echo "[progress] ✓ ${repo}" >&2
    fi
  done
else
  filtered=("${selected[@]}")
fi

if [[ "$primary_only" -eq 1 && "${#filtered[@]}" -gt 0 ]]; then
  primary=()
  for repo in "${filtered[@]}"; do
    case "$repo" in
      *-tmp/*|*.worktrees/*|*.claude/worktrees/*|*/test/*|*-fork/*) continue ;;
    esac
    primary+=("$repo")
  done
  filtered=("${primary[@]+"${primary[@]}"}")
fi

if [[ "$deduplicate_origins" -eq 1 && "${#filtered[@]}" -gt 0 ]]; then
  dedup_tmp="$(mktemp)"
  for repo in "${filtered[@]}"; do
    origin="$(git -C "$repo" config --get remote.origin.url 2>/dev/null || true)"
    if [[ -z "$origin" ]]; then
      origin="__local__${repo}"
    fi
    printf '%s\t%s\n' "$origin" "$repo"
  done | awk -F '\t' '
    {
      origin = $1; path = $2
      if (!(origin in best) || length(path) < length(best[origin])) {
        best[origin] = path
      }
    }
    END {
      for (o in best) print best[o]
    }
  ' | awk '{ print length($0) "\t" $0 }' | sort -n -k1,1 -k2,2 | cut -f2- > "$dedup_tmp"
  filtered=()
  while IFS= read -r repo; do
    [[ -n "$repo" ]] && filtered+=("$repo")
  done < "$dedup_tmp"
  rm -f "$dedup_tmp"
fi

if [[ "${#filtered[@]}" -gt 0 ]]; then
  printf '%s\n' "${filtered[@]}"
fi
