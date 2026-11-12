# Last measurement run

5,000 students, Chromium, CPU slowed 4x, median of 3 runs (worst of the 5 letters in each run). Times in milliseconds.

| Way of drawing the list | Page ready | Elements on page | Worst letter: until drawn | Worst letter: list caught up | Rows redrawn typing 5 letters | Click a row: until drawn | Rows redrawn by a click |
|---|---|---|---|---|---|---|---|
| plain | 2117 | 25037 | 268 | 357 | 11594 | 577 | 5568 |
| memo-inline | 2290 | 25037 | 268 | 397 | 11594 | 650 | 5627 |
| memo | 2156 | 25037 | 202 | 214 | 0 | 524 | 1 |
| virtual | 761 | 122 | 35 | 37 | 23 | 18 | 1 |
| virtual-deferred | 701 | 122 | 33 | 45 | 23 | 17 | 1 |

List sent over the network: 312,846 bytes uncompressed, 41,293 bytes with gzip (7.6x smaller).
