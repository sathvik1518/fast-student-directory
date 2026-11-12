# What "slow" means for this page

Written **before** the measurements, so the numbers cannot be bent to look good afterwards.
The page shows 5,000 students. "Slow" is judged on a Chromium browser with the CPU slowed 4 times (about a mid-range phone), because a fast laptop hides problems.

| # | Question a person would ask | Slow if | Fast enough if |
|---|---|---|---|
| 1 | How long until I can see the list? | more than 1,500 ms | 1,000 ms or less |
| 2 | I typed a letter. How long until the box and list show it? (worst of 5 letters) | more than 200 ms | 100 ms or less |
| 3 | I clicked a student. How long until the card appears? | more than 200 ms | 100 ms or less |
| 4 | How big is the page's own structure? | more than 5,000 elements | 1,500 elements or fewer |
| 5 | How many database queries does the server run for one list? | more than 1 | exactly 1 |
| 6 | How many bytes travel over the network for the list? | more than 100 KB | 100 KB or less |

Why these lines: about 100 ms is where an action stops feeling instant; about 1 second is where a person starts to wonder if the page is working.
These are my choices for this page. They are not an official standard.

## Result of the final run

See `frontend/perf/last-run.md` for the full table (re-create it with `npm run measure` inside `frontend`).

| # | Plain list (before) | Virtual list (after) | Rule met by "after"? |
|---|---|---|---|
| 1 | about 2,100 ms | about 760 ms | yes |
| 2 | about 270 ms | about 35 ms | yes |
| 3 | about 580 ms | about 18 ms | yes |
| 4 | about 25,000 elements | about 120 elements | yes |
| 5 | 5,001 queries (old way) | 1 query | yes |
| 6 | about 313 KB | about 41 KB with gzip | yes |

The numbers come from one sandbox machine (Linux, headless Chromium, CPU slowed 4x). Your machine will give different numbers. Compare the rows with each other, not with these.
