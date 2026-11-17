# Local tests — gta6-twitch-ccu-forecast-01

Run 2026-11-17 ~16:50 WIB, Node v24.22.1, from the work dir:
`mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts`

## Practice runs (p00–p03)

| Case | Game | Hour-1 print | Valid output | Median ratio h2 / h19 / h24 |
| --- | --- | --- | --- | --- |
| p00 | Marvel's Wolverine | 23,357 | yes | 0.94 / 1.55 / 1.34 |
| p01 | Red Dead Redemption 2 | 116,550 | yes | 0.94 / 1.55 / 1.34 |
| p02 | God of War Ragnarök | 269,517 | yes | 0.94 / 1.55 / 1.34 |
| p03 | Marvel's Spider-Man 2 | 119,087 | yes | 0.94 / 1.55 / 1.34 |

- Shape validation: 4/4 outputs are valid JSON with exactly `{"hours": [...]}`, 23 rows,
  hours 2–24 each once, five quantiles per row, all > 0 and ≤ 1e9, non-decreasing.
  Output size ~1.4–1.6 KB per file, far under the 65,536-byte cap.
- Median ratios are identical across cases (same Tier A pool of 9 launches in every
  practice case); only the level (hour-1 print) differs.
- Independent Python replication of the Tier A pool's trimmed-mean log-ratios matches
  the program's medians exactly (h2 0.935, h19 1.553, h24 1.340).
- Determinism: two full runs write byte-identical output (`diff -r` clean).
- Runtime: ~0.4–0.6 s for all four cases in one run (~0.1–0.15 s per case),
  far under the 8 s per-case cap.
- Post-revision re-run (pickPool rewrite + header note): outputs byte-identical.
- Starter (house baseline) run for reference: flat medians at the hour-1 print
  every hour (e.g. p00: 23,357 at h2 and h19); this entry forecasts a rise to
  ~1.55× hour-1 by h19 and a fade to ~1.34× by h24, with a wide honest spread
  (p00 h19: q05 13,721 / q50 36,281 / q95 95,936).

## Leave-one-out pinball-loss estimates (comparables' release days)

Method: each comparable's release day treated as a pseudo-case, forecast from its
own hour-1 print using the other comparables; mean pinball loss over all hours ×
levels. Parameters used: 10% trimmed mean centre, shrink 0.85, IQR/1.349 spread
× 1.2, tiered pool (Tier A: midnight-local, not early-access-contaminated,
not tier-weak, hour-1 ≥ 50k; ≥ 8 launches required).

| Test set | This model | Persistence baseline |
| --- | --- | --- |
| Midnight-local launches (n=11) | 0.322 | 0.363 |
| Big launches, hour-1 ≥ 100k (n=16) | 0.256 | 0.261 |
| All full-day comparables (n=37) | 0.80 | 0.93 |

The house baseline scores ~0.387 on the practice cases (stated in the kit);
the practice launches are midnight-local console launches, the set where this
model scores ~0.32. Caveat: the final is a single case (GTA VI itself) — the
LOO numbers are an expectation over similar launches, not a guarantee for one
day. The model beats the baseline where the shape is predictable and ties it
where it is not; it never scores worse than the baseline on any tested set.

## Tested and rejected

- Excluding launches with a simultaneous PC unlock from Tier A (Elden Ring,
  Cyberpunk 2077): LOO got WORSE — midnight set 0.337 vs 0.322, big set 0.332
  vs 0.256. Kept them in the pool.
- Pooling all comparables (no tiering): LOO 0.38–0.41 on the midnight set,
  worse than the baseline. Tiering is what makes the model work.
- Empirical per-hour quantiles instead of lognormal (trimmed-mean centre +
  IQR spread): no improvement (0.332 vs 0.322 midnight; 0.229 vs 0.231 big
  — a wash). Kept the lognormal form.
