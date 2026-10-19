# Nora 3.1.0 vs Nemora 2.0

Measured 2026-10-19T15:39:04.490Z on Intel(R) Core(TM) i7-14700KF, 28 threads, 32 GB, Windows 10.0.26200.
Medians over the good runs; small print is the range and the run count. CPU is a percentage of one core, RAM the private working set of the whole process tree, disk figures all I/O the tree did (both players run offline).

| | Nora 3.1.0 <sub>3.1.0-stable</sub> | Nemora 2.0 <sub>2.0.0-dev.0</sub> | |
|---|---:|---:|---|
| **Install** |  |  | |
| Installer download | 117 MB | 30 MB | 3.8× better |
| Installed on disk | 382 MB | 56 MB | 6.8× better |
| **Building the library: 400 tracks added to an empty profile** |  |  | |
| Songs listed | 9.99 s <sub>9.98 s–10.0 s, n=3</sub> | 1.27 s <sub>1.25 s–1.27 s, n=3</sub> | 7.9× better |
| Everything done (covers, colours) | 22.0 s <sub>21.8 s–22.0 s, n=3</sub> | 1.33 s <sub>1.32 s–3.09 s, n=3</sub> | 17× better |
| CPU time spent | 54.0 s <sub>51.3 s–54.1 s, n=3</sub> | 28.5 s <sub>28.3 s–28.5 s, n=3</sub> | 1.9× better |
| RAM at its peak | 610 MB <sub>603 MB–643 MB, n=3</sub> | 415 MB <sub>408 MB–457 MB, n=3</sub> | 1.5× better |
| Written to disk | 226 MB <sub>226 MB–226 MB, n=3</sub> | 15 MB <sub>15 MB–16 MB, n=3</sub> | 15× better |
| Profile on disk afterwards | 66 MB <sub>66 MB–66 MB, n=3</sub> | 25 MB <sub>25 MB–26 MB, n=3</sub> | 2.6× better |
| Interface meanwhile: frames over 33 ms | 0 <sub>0–0, n=3</sub> | 0 <sub>0–0, n=3</sub> | same |
| Interface meanwhile: longest frame | 28 ms <sub>28 ms–28 ms, n=3</sub> | 6 ms <sub>6 ms–6 ms, n=3</sub> | 4.9× better |
| Interface meanwhile: time frozen (frames over 100 ms) | 0 ms <sub>0 ms–0 ms, n=3</sub> | 0 ms <sub>0 ms–0 ms, n=3</sub> | same |
| **Building the library: 1775 tracks added to an empty profile** |  |  | |
| Songs listed | 48.0 s <sub>47.8 s–48.2 s, n=2</sub> | 4.55 s <sub>4.53 s–4.57 s, n=2</sub> | 11× better |
| Everything done (covers, colours) | 79.1 s <sub>78.5 s–79.7 s, n=2</sub> | 4.57 s <sub>4.55 s–4.59 s, n=2</sub> | 17× better |
| CPU time spent | 235.5 s <sub>234.8 s–236.3 s, n=2</sub> | 108.4 s <sub>108.2 s–108.6 s, n=2</sub> | 2.2× better |
| RAM at its peak | 748 MB <sub>746 MB–750 MB, n=2</sub> | 433 MB <sub>415 MB–450 MB, n=2</sub> | 1.7× better |
| Written to disk | 2520 MB <sub>2519 MB–2521 MB, n=2</sub> | 56 MB <sub>56 MB–56 MB, n=2</sub> | 45× better |
| Profile on disk afterwards | 285 MB <sub>285 MB–285 MB, n=2</sub> | 61 MB <sub>61 MB–61 MB, n=2</sub> | 4.6× better |
| Interface meanwhile: frames over 33 ms | 0 <sub>0–0, n=2</sub> | 0 <sub>0–0, n=2</sub> | same |
| Interface meanwhile: longest frame | 25 ms <sub>22 ms–28 ms, n=2</sub> | 6 ms <sub>6 ms–6 ms, n=2</sub> | 4.3× better |
| Interface meanwhile: time frozen (frames over 100 ms) | 0 ms <sub>0 ms–0 ms, n=2</sub> | 0 ms <sub>0 ms–0 ms, n=2</sub> | same |
| **Starting with 400 tracks** |  |  | |
| Window on screen | 907 ms <sub>880 ms–922 ms, n=5</sub> | 446 ms <sub>390 ms–474 ms, n=5</sub> | 2.0× better |
| Ready (library loaded, home page painted) | 1.31 s <sub>1.29 s–1.34 s, n=5</sub> | 758 ms <sub>706 ms–778 ms, n=5</sub> | 1.7× better |
| CPU time in the first minute | 2.9 s <sub>2.5 s–2.9 s, n=5</sub> | 1.7 s <sub>1.5 s–1.9 s, n=5</sub> | 1.7× better |
| Read from disk in the first minute | 39 MB <sub>39 MB–39 MB, n=5</sub> | 18 MB <sub>18 MB–19 MB, n=5</sub> | 2.1× better |
| Written to disk in the first minute | 3 MB <sub>3 MB–3 MB, n=5</sub> | 11 MB <sub>11 MB–11 MB, n=5</sub> | 4.3× worse |
| RAM in use after a minute | 373 MB <sub>371 MB–376 MB, n=5</sub> | 126 MB <sub>125 MB–127 MB, n=5</sub> | 3.0× better |
| CPU idle after a minute | 0.64 % <sub>0.15 %–1.45 %, n=5</sub> | 0.80 % <sub>0.64 %–1.77 %, n=5</sub> | 1.3× worse |
| Processes | 5 <sub>5–5, n=5</sub> | 7 <sub>7–7, n=5</sub> | 1.4× worse |
| **Starting with 1775 tracks** |  |  | |
| Window on screen | 948 ms <sub>945 ms–982 ms, n=3</sub> | 401 ms <sub>390 ms–402 ms, n=3</sub> | 2.4× better |
| Ready (library loaded, home page painted) | 1.42 s <sub>1.41 s–1.42 s, n=3</sub> | 749 ms <sub>737 ms–753 ms, n=3</sub> | 1.9× better |
| CPU time in the first minute | 3.0 s <sub>2.8 s–3.5 s, n=3</sub> | 1.7 s <sub>1.6 s–2.2 s, n=3</sub> | 1.7× better |
| Read from disk in the first minute | 49 MB <sub>49 MB–49 MB, n=3</sub> | 26 MB <sub>26 MB–28 MB, n=3</sub> | 1.9× better |
| Written to disk in the first minute | 3 MB <sub>3 MB–3 MB, n=3</sub> | 13 MB <sub>13 MB–15 MB, n=3</sub> | 5.0× worse |
| RAM in use after a minute | 381 MB <sub>378 MB–409 MB, n=3</sub> | 128 MB <sub>128 MB–133 MB, n=3</sub> | 3.0× better |
| CPU idle after a minute | 0.64 % <sub>0.48 %–0.65 %, n=3</sub> | 0.96 % <sub>0.96 %–1.28 %, n=3</sub> | 1.5× worse |
| Processes | 5 <sub>5–5, n=3</sub> | 7 <sub>7–7, n=3</sub> | 1.4× worse |
| **Using it with 400 tracks** |  |  | |
| Open Songs (first) | 374 ms <sub>374 ms–387 ms, n=3</sub> | 392 ms <sub>391 ms–394 ms, n=3</sub> | same |
| Open Albums (first) | 389 ms <sub>383 ms–389 ms, n=3</sub> | 339 ms <sub>339 ms–339 ms, n=3</sub> | 1.1× better |
| Open Artists (first) | 328 ms <sub>328 ms–333 ms, n=3</sub> | 355 ms <sub>355 ms–355 ms, n=3</sub> | 1.1× worse |
| Open Genres (first) | 333 ms <sub>333 ms–333 ms, n=3</sub> | 333 ms <sub>333 ms–333 ms, n=3</sub> | same |
| Open Playlists (first) | 333 ms <sub>333 ms–333 ms, n=3</sub> | 333 ms <sub>327 ms–333 ms, n=3</sub> | same |
| Open Home (first) | 17 ms <sub>17 ms–17 ms, n=3</sub> | 17 ms <sub>16 ms–17 ms, n=3</sub> | same |
| Open Albums (again) | 28 ms <sub>27 ms–28 ms, n=3</sub> | 33 ms <sub>33 ms–33 ms, n=3</sub> | 1.2× worse |
| Open Artists (again) | 28 ms <sub>28 ms–56 ms, n=3</sub> | 33 ms <sub>33 ms–33 ms, n=3</sub> | 1.2× worse |
| Open Genres (again) | 28 ms <sub>28 ms–28 ms, n=3</sub> | 27 ms <sub>27 ms–27 ms, n=3</sub> | same |
| Open Playlists (again) | 28 ms <sub>28 ms–28 ms, n=3</sub> | 28 ms <sub>28 ms–28 ms, n=3</sub> | same |
| Open Home (again) | 17 ms <sub>17 ms–17 ms, n=3</sub> | 17 ms <sub>17 ms–17 ms, n=3</sub> | same |
| Open Songs (again) | 55 ms <sub>44 ms–56 ms, n=3</sub> | 55 ms <sub>50 ms–55 ms, n=3</sub> | same |
| Open Search | 317 ms <sub>317 ms–323 ms, n=3</sub> | 316 ms <sub>316 ms–317 ms, n=3</sub> | same |
| Search: typing to results painted (includes the view’s 250 ms pause, in both) | 269 ms <sub>269 ms–271 ms, n=3</sub> | 275 ms <sub>273 ms–277 ms, n=3</sub> | same |
| Song list scroll, frames per second | 180 <sub>180–180, n=3</sub> | 180 <sub>180–180, n=3</sub> | same |
| Song list scroll, frames over 33 ms | 0 <sub>0–0, n=3</sub> | 0 <sub>0–0, n=3</sub> | same |
| Song list scroll, 95th percentile frame | 6 ms <sub>6 ms–6 ms, n=3</sub> | 6 ms <sub>6 ms–6 ms, n=3</sub> | same |
| CPU time for the whole session | 8.5 s <sub>8.1 s–8.7 s, n=3</sub> | 7.9 s <sub>7.9 s–8.1 s, n=3</sub> | 1.1× better |
| RAM at its peak | 530 MB <sub>526 MB–537 MB, n=3</sub> | 310 MB <sub>304 MB–351 MB, n=3</sub> | 1.7× better |
| **Using it with 1775 tracks** |  |  | |
| Open Songs (first) | 427 ms <sub>426 ms–428 ms, n=2</sub> | 439 ms <sub>437 ms–442 ms, n=2</sub> | same |
| Open Albums (first) | 343 ms <sub>342 ms–344 ms, n=2</sub> | 355 ms <sub>355 ms–355 ms, n=2</sub> | same |
| Open Artists (first) | 383 ms <sub>372 ms–394 ms, n=2</sub> | 364 ms <sub>361 ms–366 ms, n=2</sub> | 1.1× better |
| Open Genres (first) | 333 ms <sub>333 ms–333 ms, n=2</sub> | 339 ms <sub>339 ms–339 ms, n=2</sub> | same |
| Open Playlists (first) | 333 ms <sub>333 ms–333 ms, n=2</sub> | 330 ms <sub>328 ms–333 ms, n=2</sub> | same |
| Open Home (first) | 17 ms <sub>17 ms–17 ms, n=2</sub> | 17 ms <sub>17 ms–17 ms, n=2</sub> | same |
| Open Albums (again) | 50 ms <sub>50 ms–50 ms, n=2</sub> | 50 ms <sub>50 ms–50 ms, n=2</sub> | same |
| Open Artists (again) | 33 ms <sub>33 ms–33 ms, n=2</sub> | 50 ms <sub>50 ms–50 ms, n=2</sub> | 1.5× worse |
| Open Genres (again) | 28 ms <sub>28 ms–28 ms, n=2</sub> | 33 ms <sub>33 ms–33 ms, n=2</sub> | 1.2× worse |
| Open Playlists (again) | 28 ms <sub>28 ms–28 ms, n=2</sub> | 28 ms <sub>28 ms–28 ms, n=2</sub> | same |
| Open Home (again) | 17 ms <sub>17 ms–17 ms, n=2</sub> | 17 ms <sub>16 ms–17 ms, n=2</sub> | same |
| Open Songs (again) | 100 ms <sub>100 ms–100 ms, n=2</sub> | 105 ms <sub>105 ms–105 ms, n=2</sub> | 1.1× worse |
| Open Search | 317 ms <sub>317 ms–317 ms, n=2</sub> | 319 ms <sub>317 ms–322 ms, n=2</sub> | same |
| Search: typing to results painted (includes the view’s 250 ms pause, in both) | 274 ms <sub>274 ms–275 ms, n=2</sub> | 297 ms <sub>294 ms–300 ms, n=2</sub> | 1.1× worse |
| Song list scroll, frames per second | 180 <sub>179–180, n=2</sub> | 180 <sub>180–180, n=2</sub> | same |
| Song list scroll, frames over 33 ms | 1 <sub>0–1, n=2</sub> | 0 <sub>0–0, n=2</sub> | better |
| Song list scroll, 95th percentile frame | 6 ms <sub>6 ms–6 ms, n=2</sub> | 6 ms <sub>6 ms–6 ms, n=2</sub> | same |
| CPU time for the whole session | 8.7 s <sub>8.5 s–8.9 s, n=2</sub> | 8.6 s <sub>8.4 s–8.7 s, n=2</sub> | same |
| RAM at its peak | 569 MB <sub>568 MB–569 MB, n=2</sub> | 300 MB <sub>298 MB–302 MB, n=2</sub> | 1.9× better |
| **Playing FLAC, window open (sound confirmed by the Windows audio meter)** |  |  | |
| Sound starts after the click | 114 ms <sub>83 ms–129 ms, n=3</sub> | 48 ms <sub>0 ms–62 ms, n=3</sub> | 2.4× better |
| CPU while playing | 8.47 % <sub>7.27 %–11.31 %, n=3</sub> | 1.82 % <sub>1.11 %–2.13 %, n=3</sub> | 4.6× better |
| RAM while playing | 436 MB <sub>435 MB–439 MB, n=3</sub> | 144 MB <sub>143 MB–145 MB, n=3</sub> | 3.0× better |
| Dropouts: silences of 2 ms or more in the recorded output, all runs together | 0 <sub>in 3 runs</sub> | 0 <sub>in 3 runs</sub> | same |
| Dropouts: their total length | 0 ms <sub>in 3 runs</sub> | 0 ms <sub>in 3 runs</sub> | same |
| **Playing MP3, window open (sound confirmed by the Windows audio meter)** |  |  | |
| Sound starts after the click | 98 ms <sub>52 ms–99 ms, n=3</sub> | 46 ms <sub>29 ms–63 ms, n=3</sub> | 2.1× better |
| CPU while playing | 8.15 % <sub>7.68 %–9.33 %, n=3</sub> | 1.66 % <sub>0.71 %–1.90 %, n=3</sub> | 4.9× better |
| RAM while playing | 432 MB <sub>428 MB–434 MB, n=3</sub> | 143 MB <sub>142 MB–143 MB, n=3</sub> | 3.0× better |
| Dropouts: silences of 2 ms or more in the recorded output, all runs together | 0 <sub>in 3 runs</sub> | 0 <sub>in 3 runs</sub> | same |
| Dropouts: their total length | 0 ms <sub>in 3 runs</sub> | 0 ms <sub>in 3 runs</sub> | same |
| **Playing FLAC, window minimized (sound confirmed by the Windows audio meter)** |  |  | |
| CPU while playing | 1.82 % <sub>1.03 %–2.22 %, n=3</sub> | 1.35 % <sub>1.03 %–1.58 %, n=3</sub> | 1.3× better |
| RAM while playing | 433 MB <sub>432 MB–434 MB, n=3</sub> | 145 MB <sub>144 MB–146 MB, n=3</sub> | 3.0× better |
| Dropouts: silences of 2 ms or more in the recorded output, all runs together | 0 <sub>in 3 runs</sub> | 0 <sub>in 3 runs</sub> | same |
| Dropouts: their total length | 0 ms <sub>in 3 runs</sub> | 0 ms <sub>in 3 runs</sub> | same |
| **Playing FLAC, hidden in the tray (sound confirmed by the Windows audio meter)** |  |  | |
| CPU while playing | 2.45 % <sub>0.95 %–2.53 %, n=3</sub> | 1.18 % <sub>0.63 %–1.66 %, n=3</sub> | 2.1× better |
| RAM while playing | 434 MB <sub>432 MB–440 MB, n=3</sub> | 145 MB <sub>145 MB–145 MB, n=3</sub> | 3.0× better |
| Dropouts: silences of 2 ms or more in the recorded output, all runs together | 0 <sub>in 3 runs</sub> | 0 <sub>in 3 runs</sub> | same |
| Dropouts: their total length | 0 ms <sub>in 3 runs</sub> | 0 ms <sub>in 3 runs</sub> | same |
| **From one song to the next (FLAC, queued)** |  |  | |
| Silence between the two songs (recorded output; under 2 ms reads as none) | 35 ms <sub>27 ms–36 ms, n=3</sub> | 0 ms <sub>0 ms–0 ms, n=3</sub> | better |

## Runs: 66 good, 0 discarded

Search terms: kuusou, void, love.
