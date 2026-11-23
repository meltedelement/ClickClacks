#!/usr/bin/env bash
# A full balance check: every weapon, every transformation, and sampled
# builds of upgrades + transformations on every weapon, all against each
# other. Takes a while (times below are a 6-core laptop on 6 workers).
# Everything lands in one folder:
#
#   sweeps/massive-<seed>/
#     1-weapons.txt / .json          plain weapons, every pairing and mirror
#     2-transformations.txt / .json  every transformation vs every other (and its matchups)
#     3-sweep.jsonl                  raw sweep results (resumable)
#     3-sweep-report.txt / .json     outlier upgrades, transformations, stacks and weapons per tier
#
# Usage (from games/weapon-balls/):
#   npm run balance:all                          # "big": about 50 min
#   SIZE=quick npm run balance:all               # about 10 min, noisier
#   SIZE=huge npm run balance:all                # about 1 h 15 min, least noise
#   SEED=7 npm run balance:all                   # another seed: a second opinion, its own folder
#   JOBS=4 npm run balance:all                   # fewer worker threads (default: one per physical core)
#   SIZE=smoke SEED=smoke npm run balance:all    # a couple of minutes, just checks it all runs
#
# Safe to stop and restart with the same SEED and SIZE: finished stages are
# skipped (delete a stage's .json to redo it) and the sweep resumes where it
# stopped. Set FRESH=1 to throw the folder's results away and start over.
set -euo pipefail

cd "$(dirname "$0")/.."

SEED="${SEED:-1}"
SIZE="${SIZE:-big}"
OUT="sweeps/massive-${SEED}"
JOBS_ARG=()
[ -n "${JOBS:-}" ] && JOBS_ARG=(-j "$JOBS")

case "$SIZE" in
  smoke)
    # A couple of minutes: only checks that every stage runs.
    WEAPON_GAMES=20; TRANSFORM_GAMES=2
    SWEEP_ARGS=(--tiers 1/0,3/1 -b 1 -p 2 -g 1 --stack-levels 1)
    ;;
  quick)
    WEAPON_GAMES=1000; TRANSFORM_GAMES=100
    SWEEP_ARGS=(--tiers 1/0,3/0,6/1,10/2 -b 6 -p 6 -g 2)
    ;;
  big)
    WEAPON_GAMES=4000; TRANSFORM_GAMES=300
    SWEEP_ARGS=(--tiers 1/0,3/0,3/1,6/1,10/2,14/3 --stack-levels 1,3,5 -b 10 -p 8 -g 4)
    ;;
  huge)
    WEAPON_GAMES=8000; TRANSFORM_GAMES=500
    SWEEP_ARGS=(--tiers 1/0,3/0,3/1,6/1,10/2,14/3 --stack-levels 1,3,5 -b 12 -p 10 -g 4)
    ;;
  *)
    echo "Unknown SIZE \"$SIZE\": use quick, big or huge (or smoke to test the script)." >&2
    exit 1
    ;;
esac

if [ -n "${FRESH:-}" ]; then rm -rf "$OUT"; fi
mkdir -p "$OUT"

stage() { printf '\n=== %s ===\n\n' "$1"; }
started=$(date +%s)

stage "Sweep plan ($SIZE, seed $SEED)"
node tools/sweep.js -n -s "$SEED" "${SWEEP_ARGS[@]}"

stage "1/3  Plain weapons, $WEAPON_GAMES matches per pairing, mirrors included"
if [ -f "$OUT/1-weapons.json" ]; then
  echo "Done already: $OUT/1-weapons.txt"
else
  node tools/balance.js -g "$WEAPON_GAMES" -m -s "$SEED" "${JOBS_ARG[@]}" \
    --json "$OUT/1-weapons.json.tmp" | tee "$OUT/1-weapons.txt"
  mv "$OUT/1-weapons.json.tmp" "$OUT/1-weapons.json"
fi

stage "2/3  Every transformation vs every other, $TRANSFORM_GAMES matches per pairing"
if [ -f "$OUT/2-transformations.json" ]; then
  echo "Done already: $OUT/2-transformations.txt"
else
  node tools/balance.js -T -g "$TRANSFORM_GAMES" -s "$SEED" "${JOBS_ARG[@]}" \
    --json "$OUT/2-transformations.json.tmp" | tee "$OUT/2-transformations.txt"
  mv "$OUT/2-transformations.json.tmp" "$OUT/2-transformations.json"
fi

stage "3/3  Upgrade + transformation sweep (resumes if interrupted)"
node tools/sweep.js -s "$SEED" "${SWEEP_ARGS[@]}" "${JOBS_ARG[@]}" -o "$OUT/3-sweep.jsonl"
node tools/sweep.js -r "$OUT/3-sweep.jsonl" --json "$OUT/3-sweep-report.json" | tee "$OUT/3-sweep-report.txt"

elapsed=$(( $(date +%s) - started ))
stage "Finished in $((elapsed / 3600))h $((elapsed % 3600 / 60))m"
echo "Results are in $OUT/:"
ls -1 "$OUT"
