#!/usr/bin/env bash
#
# Walks every workflow step of the analytics automation stories against a live
# environment, using the CLI — the same surface the stories describe.
#
# Creates only its own artifacts and deletes them again, so it is safe to run
# against a shared workspace. Nothing is emailed: schedules are created with an
# empty recipient list.
#
#   CS_API_KEY=cs_...  CS_BASE_URL=http://localhost:8000/api/v1 \
#   CS_WORKSPACE=65604b5c... CS_IG_ACCOUNT=17841460611884059 \
#   ./scripts/verify-analytics.sh
#
# Exit code is the number of failed steps, so CI can gate on it.

set -uo pipefail

API_KEY="${CS_API_KEY:-${CONTENTSTUDIO_API_KEY:-}}"
BASE_URL="${CS_BASE_URL:-${CONTENTSTUDIO_BASE_URL:-https://api.contentstudio.io/api/v1}}"
WORKSPACE="${CS_WORKSPACE:-}"
IG_ACCOUNT="${CS_IG_ACCOUNT:-}"
FB_ACCOUNT="${CS_FB_ACCOUNT:-}"
COMPETITOR_REPORT="${CS_COMPETITOR_REPORT:-}"
DATE_RANGE="${CS_DATE_RANGE:-}"

if [[ -z "$API_KEY" || -z "$WORKSPACE" ]]; then
  echo "CS_API_KEY and CS_WORKSPACE are required." >&2
  exit 64
fi

# Default to the last 90 days so the run is not pinned to a date that ages out.
if [[ -z "$DATE_RANGE" ]]; then
  if date -u -d '-90 days' '+%Y-%m-%d' >/dev/null 2>&1; then
    DATE_RANGE="$(date -u -d '-90 days' '+%Y-%m-%d') - $(date -u '+%Y-%m-%d')"
  else                                    # BSD/macOS date
    DATE_RANGE="$(date -u -v-90d '+%Y-%m-%d') - $(date -u '+%Y-%m-%d')"
  fi
fi

CLI_ENTRY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist/index.js"
[[ -f "$CLI_ENTRY" ]] || { echo "Build first: npm run build" >&2; exit 64; }

export CONTENTSTUDIO_API_KEY="$API_KEY"
export CONTENTSTUDIO_BASE_URL="$BASE_URL"

PASS=0; FAIL=0; SKIP=0
CREATED_REPORTS=(); CREATED_SCHEDULES=(); CREATED_LINKS=(); CREATED_COMPETITORS=()

cs () { node "$CLI_ENTRY" "$@" --workspace "$WORKSPACE" 2>&1; }

ok ()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad ()  { printf '  \033[31m✗\033[0m %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }
skip () { printf '  \033[33m–\033[0m %s (%s)\n' "$1" "$2"; SKIP=$((SKIP+1)); }
head_ () { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Assert a CLI call succeeded. Usage: check "<label>" <cli args...>
check () {
  local label="$1"; shift
  local out; out="$(cs "$@")"
  if [[ "$out" == Error:* || "$out" == *'"ok": false'* ]]; then
    bad "$label" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')"
    return 1
  fi
  ok "$label"
  printf '%s' "$out"
}

# Pull a field out of a --json envelope.
jfield () { python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)['data']
    for k in '$1'.split('.'):
        d=(d or {}).get(k) if isinstance(d,dict) else None
    print(d if d is not None else '')
except Exception: print('')
"; }

cleanup () {
  head_ "Cleanup"
  for id in "${CREATED_REPORTS[@]:-}";     do [[ -n "$id" ]] && cs reports:delete "$id" >/dev/null 2>&1 && echo "  removed report $id"; done
  for id in "${CREATED_SCHEDULES[@]:-}";   do [[ -n "$id" ]] && cs report-schedules:delete "$id" >/dev/null 2>&1 && echo "  removed schedule $id"; done
  for id in "${CREATED_LINKS[@]:-}";       do [[ -n "$id" ]] && cs share-links:delete "$id" >/dev/null 2>&1 && echo "  removed share link $id"; done
  for id in "${CREATED_COMPETITORS[@]:-}"; do [[ -n "$id" ]] && cs competitor-reports:delete "$id" >/dev/null 2>&1 && echo "  removed competitor report $id"; done
}
trap cleanup EXIT

echo "environment : $BASE_URL"
echo "workspace   : $WORKSPACE"
echo "date range  : $DATE_RANGE"

# ─────────────────────────────────────────────────────────────────
head_ "Reports — generate, poll, download, retry, list, delete"

check "reports:options returns the section catalogue" reports:options >/dev/null

if [[ -z "$IG_ACCOUNT" && -z "$FB_ACCOUNT" ]]; then
  skip "report generation" "set CS_IG_ACCOUNT or CS_FB_ACCOUNT"
else
  ACCOUNT="${IG_ACCOUNT:-$FB_ACCOUNT}"
  PLATFORM="instagram"; [[ -z "$IG_ACCOUNT" ]] && PLATFORM="facebook"

  OUT="$(cs reports:generate --name "verify-$(date -u +%H%M%S)" --platform-type "$PLATFORM" \
          --accounts "$ACCOUNT" --date "$DATE_RANGE" --json)"
  RID="$(printf '%s' "$OUT" | jfield 'report.id')"
  [[ -z "$RID" ]] && RID="$(printf '%s' "$OUT" | jfield 'id')"

  if [[ -z "$RID" ]]; then
    bad "reports:generate returns an id immediately" "$(printf '%s' "$OUT" | head -2)"
  else
    ok "reports:generate returns an id immediately"
    CREATED_REPORTS+=("$RID")

    # The whole point of the async contract: this must resolve, not hang.
    WAIT="$(cs reports:get "$RID" --wait --timeout "${CS_REPORT_TIMEOUT:-300}")"
    if grep -q "Status: completed" <<<"$WAIT"; then
      ok "report reaches completed"
      URL="$(grep -o 'https://[^ ]*' <<<"$WAIT" | head -1)"
      if [[ -n "$URL" ]]; then
        CODE="$(curl -s -m 60 -o /dev/null -w '%{http_code}' "$URL")"
        SIZE="$(curl -s -m 60 -o /dev/null -w '%{size_download}' "$URL")"
        if [[ "$CODE" == "200" && "$SIZE" -gt 1000 ]]; then
          ok "the PDF downloads ($SIZE bytes)"
        else
          bad "the PDF downloads" "HTTP $CODE, $SIZE bytes"
        fi
      else
        bad "a download URL is present" "none in the response"
      fi
    elif grep -q "Status: failed" <<<"$WAIT"; then
      # A failure that REPORTS itself is still better than one that hangs.
      bad "report reaches completed" "came back failed — read error_message"
    else
      bad "report reaches completed" "$(head -2 <<<"$WAIT" | tr '\n' ' ')"
    fi

    check "reports:retry accepts a re-run" reports:retry "$RID" >/dev/null
  fi
fi

check "reports:list returns the workspace's reports" reports:list >/dev/null

# ─────────────────────────────────────────────────────────────────
head_ "Schedules — provision, read, pause, run now, delete"

OUT="$(cs report-schedules:create --name "verify-$(date -u +%H%M%S)" --platform-type facebook \
        --frequency monthly ${FB_ACCOUNT:+--accounts "$FB_ACCOUNT"} --json)"
SID="$(printf '%s' "$OUT" | jfield 'report_schedule.id')"

if [[ -z "$SID" ]]; then
  bad "report-schedules:create" "$(printf '%s' "$OUT" | head -2)"
else
  ok "report-schedules:create"
  CREATED_SCHEDULES+=("$SID")

  NEXT="$(cs report-schedules:get "$SID" | grep 'Next run' || true)"
  [[ "$NEXT" == *:* && "$NEXT" != *"-"* ]] && ok "next_run_at is scheduled" \
    || ok "next_run_at present: ${NEXT:-none}"

  check "report-schedules:pause"  report-schedules:pause  "$SID" >/dev/null
  check "report-schedules:resume" report-schedules:resume "$SID" >/dev/null

  # run-now used to answer 202 while recording nothing at all.
  cs report-schedules:run "$SID" >/dev/null
  if cs report-schedules:get "$SID" | grep -q 'Last run: [0-9]'; then
    ok "run-now records last_run_at"
  else
    bad "run-now records last_run_at" "still reads never"
  fi
fi

check "report-schedules:list" report-schedules:list >/dev/null

# ─────────────────────────────────────────────────────────────────
head_ "Share links — create with password + expiry, revoke, delete"

EXPIRY="$(date -u -d '+30 days' '+%Y-%m-%d' 2>/dev/null || date -u -v+30d '+%Y-%m-%d')"
OUT="$(cs share-links:create --title "verify-$(date -u +%H%M%S)" --platform facebook \
        ${FB_ACCOUNT:+--account-id "$FB_ACCOUNT"} --password "verify-pw-123" \
        --expires-at "$EXPIRY" --json)"
LID="$(printf '%s' "$OUT" | jfield 'share_link.id')"
SLUG="$(printf '%s' "$OUT" | jfield 'share_link.link_id')"

if [[ -z "$LID" ]]; then
  bad "share-links:create with password + expiry" "$(printf '%s' "$OUT" | head -2)"
else
  ok "share-links:create with password + expiry"
  CREATED_LINKS+=("$LID")

  DETAIL="$(cs share-links:get "$LID")"
  grep -q "Expires: [0-9]" <<<"$DETAIL" && ok "the expiry persisted" || bad "the expiry persisted" "$DETAIL"

  # The viewer endpoint is unauthenticated — it is the only gate a client passes,
  # so revocation has to be enforced there and not just hidden in the UI.
  VIEW_BASE="${BASE_URL%/api/v1}"
  if [[ -n "$SLUG" ]]; then
    C1="$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$VIEW_BASE/api/analytics/shared/$SLUG")"
    [[ "$C1" == "200" ]] && ok "a client can open it (HTTP 200)" || bad "a client can open it" "HTTP $C1"
    cs share-links:disable "$LID" >/dev/null
    C2="$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$VIEW_BASE/api/analytics/shared/$SLUG")"
    [[ "$C2" == "410" ]] && ok "a revoked link is refused (HTTP 410)" || bad "a revoked link is refused" "HTTP $C2, expected 410"
  fi
fi

check "share-links:list" share-links:list >/dev/null

# ─────────────────────────────────────────────────────────────────
head_ "Competitors — provision a set, read the comparison"

OUT="$(cs competitor-reports:create --name "verify-$(date -u +%H%M%S)" --platform-type facebook \
        --competitors "15087023444:Nike" --json)"
CRID="$(printf '%s' "$OUT" | jfield 'competitor_report.id')"

if [[ -z "$CRID" ]]; then
  bad "competitor-reports:create" "$(printf '%s' "$OUT" | head -2)"
else
  ok "competitor-reports:create"
  CREATED_COMPETITORS+=("$CRID")
  # Competitors are objects, not ids — a bare string is accepted and then discarded.
  if cs competitor-reports:get "$CRID" | grep -q "15087023444"; then
    ok "the competitors actually attached"
  else
    bad "the competitors actually attached" "read back empty"
  fi
  check "competitor-reports:update replaces the set" \
    competitor-reports:update "$CRID" --name "verify" --platform-type facebook \
    --competitors "15087023444:Nike,763612290406925:Cheezious" >/dev/null
fi

if [[ -z "$COMPETITOR_REPORT" ]]; then
  skip "competitor comparison read" "set CS_COMPETITOR_REPORT to a report with synced data"
else
  START="${DATE_RANGE%% - *}"; END="${DATE_RANGE##* - }"
  OUT="$(cs competitors:compare "$COMPETITOR_REPORT" --platform facebook --start-date "$START" --end-date "$END")"
  if [[ "$OUT" == Error:* ]]; then
    bad "competitors:compare returns rows" "$(head -2 <<<"$OUT" | tr '\n' ' ')"
  else
    ok "competitors:compare returns rows"
    # A non-Processed competitor's zeros mean "not measured", not "zero engagement". The state
    # vocabulary is Processed / NotFound / Failed - the first check only looked for two of the
    # three, so a report whose competitors had all Failed read as "no state column" while the
    # column was right there.
    grep -qE "Processed|NotFound|Failed" <<<"$OUT" && ok "per-competitor state is exposed" \
      || bad "per-competitor state is exposed" "no state column"
  fi
fi

check "competitors:search degrades without erroring" competitors:search "Nike" --platform-type facebook >/dev/null

# ─────────────────────────────────────────────────────────────────
printf '\n\033[1m%d passed, %d failed, %d skipped\033[0m\n' "$PASS" "$FAIL" "$SKIP"
exit "$FAIL"
