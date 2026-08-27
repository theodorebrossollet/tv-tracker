#!/usr/bin/env bash
# Pulls the last ~40 minutes of Vercel runtime logs for one project and
# appends them to <out_dir>/<date>.jsonl. 40 minutes (not 30) gives
# overlap margin against GitHub Actions' scheduling jitter and Vercel's
# Hobby-plan 1-hour retention window; sort -u collapses the resulting
# duplicate lines between runs.
#
# Requires VERCEL_TOKEN in the environment, scoped to exactly this project.
set -euo pipefail

project="$1"
out_dir="$2"

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "VERCEL_TOKEN not set for $project, skipping." >&2
  exit 1
fi

mkdir -p "$out_dir"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

npx --yes vercel@latest link --token="$VERCEL_TOKEN" --yes --project="$project" --cwd="$work_dir"

capture_file="$work_dir/capture.jsonl"
if ! npx --yes vercel@latest logs --token="$VERCEL_TOKEN" --json --since=40m --until=now --cwd="$work_dir" \
  > "$capture_file" 2>"$work_dir/err.log"; then
  echo "vercel logs failed for $project:" >&2
  cat "$work_dir/err.log" >&2
  exit 1
fi

if [ -s "$capture_file" ]; then
  date_file="$out_dir/$(date -u +%Y-%m-%d).jsonl"
  cat "$capture_file" >> "$date_file"
  sort -u -o "$date_file" "$date_file"
  echo "Captured $(wc -l < "$capture_file") log lines for $project."
else
  echo "No log output for $project this run (nothing logged, or nothing left inside the retention window)."
fi
