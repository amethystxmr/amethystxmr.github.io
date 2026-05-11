#!/usr/bin/env bash
set -euo pipefail

workflow_file="${LLM_CI_WORKFLOW_FILE:-llm-ci.yml}"
branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"

id="$(gh run list --workflow="$workflow_file" --branch="$branch" --limit 1 --json databaseId --jq '.[0].databaseId')"
if [[ -z "$id" || "$id" == "null" ]]; then
  echo "No GitHub Actions run found for workflow ${workflow_file} on branch ${branch}." >&2
  exit 1
fi

exec gh run watch "$id" --exit-status
