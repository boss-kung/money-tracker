# Performance evidence — 2026-10-04

These probes exercise the static app in Chrome headless against the local
worktree. Service workers and external requests are disabled so the numbers
describe app code and DOM work, not network variability.

Run them from the repository root while serving the checkout on port 8765:

```sh
python3 -m http.server 8765
node reports/performance-2026-10-04/mt-perf-boot.cjs
node reports/performance-2026-10-04/mt-perf-nav-save.cjs
```

## Startup

`mt-perf-boot.cjs` seeds 1,000 and 5,000 transactions, with and without
credit-card benefit rules, and takes three runs for each case. The result is
the `app.firstRender.done` mark from the app boot timeline.

| Dataset | Rules | Median first render | Maximum long task |
| ---: | :---: | ---: | ---: |
| 1,000 | off | 260.0 ms | 87 ms |
| 1,000 | on | 262.9 ms | 86 ms |
| 5,000 | off | 384.8 ms | 184 ms |
| 5,000 | on | 380.5 ms | 183 ms |

All 12 samples completed without page errors. The boot log confirms that the
first dashboard render completes before the deferred reward reconciliation and
optional feature groups run.

## Navigation and save

`mt-perf-nav-save.cjs` seeds the current month with 1,000 and 5,000 rows,
navigates to the transaction page, loads one additional transaction window,
then commits the transaction collection through the dirty-key save path.

| Dataset | Navigation sync / visible | Save sync / visible | Rows rendered initially / after load-more |
| ---: | ---: | ---: | ---: |
| 1,000 | 5.1 / 105.9 ms | 3.8 / 34.0 ms | 40 / 80 |
| 5,000 | 6.4 / 108.9 ms | 14.0 / 33.4 ms | 40 / 80 |

The transaction count remains 1,000 or 5,000 in each sample, while the DOM
only grows by one 40-row window at a time.
