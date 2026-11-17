# GTA VI Twitch CCU forecast — make.fun entry

[![make.fun competition](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![make.fun rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/zxpast/gta6-twitch-ccu-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard)
[![make.fun reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/zxpast/gta6-twitch-ccu-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)

Entry for [Forecast GTA VI's launch-day Twitch viewers hour by hour](https://make.fun/bounty/gta6-twitch-ccu-forecast-01) (`gta6-twitch-ccu-forecast-01`).

## What it does

`main.ts` (Node 22, stdlib only, no network) reads one case file
(`makefun/twitch-ccu-case/v1`) and forecasts Twitch concurrent viewers in
the Grand Theft Auto VI category for hours 2–24 of release day
2026-11-19 (UTC), as five quantiles per hour, anchored on the hour-1 print.

Hour 1 is a misleading anchor on its own: at 00:00–01:00 UTC only New
Zealand, central Europe and the UK have unlocked — the US East unlocks in
hour 6 and the US West in hour 9 — so viewership climbs steeply into the
US afternoon. The house baseline (persistence) misses that whole shape.

The forecaster therefore learns the shape from the case's own comparables:
for each past launch it takes the log-ratio `ln(viewers_h / viewers_1)` of
each release-day hour to that launch's hour-1 print, then forecasts each
hour as the hour-1 print times the robust centre of those ratios, with a
spread from how much the launches disagree at that hour. The pool is
tiered to rolling-midnight console launches (tier A: "midnight local",
not early-access-contaminated, hour-1 ≥ 50,000 viewers; falling back to
wider tiers only if a tier holds fewer than 8 launches), because pooling
simultaneous-global or early-access launches roughly doubles the loss.
Per hour the centre is the 10%-trimmed mean of log-ratios shrunk 15%
toward persistence, and the spread is the IQR / 1.349, floored at 0.10
and scaled by 1.2.

## Validation

Leave-one-out pinball-loss tests over the kit's comparables (each
comparable's release day forecast from its own hour-1 print):

| Test set | This entry | Persistence baseline |
| --- | --- | --- |
| Midnight-local launches (n=11) | ~0.32 | ~0.36 |
| Big launches, hour-1 ≥ 100k (n=16) | ~0.26 | ~0.26 |

The entry beats the baseline where the launch shape is predictable
(midnight-local console launches, like GTA VI) and ties it where it is
not. The house baseline scores ~0.387 on the practice cases; on the same
kind of launches this model scores ~0.32. See `TESTS.md` for the full
numbers, including a tested-and-rejected refinement.

## Run locally

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `*.in` in the input directory, writes one `*.out` per case.
Deterministic: two runs write byte-identical output; ~0.4 s for all four
practice cases, far under the 8 s per-case cap.

## License

MIT — see `LICENSE`.
