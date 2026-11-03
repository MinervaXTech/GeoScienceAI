# GeoScienceAI Lab: hackathon provenance (DRAFT, 2026-11-03)

**Draft for the author's review before submission.** It says what existed before the Meta AI Developer Hackathon kickoff, what was imported from the author's sibling project, what was built in this repository, and where the Meta APIs are really used. Times are MYT (+0800). Kickoff was 12:24 PM ET on 26 Oct 2026, which is 00:24 MYT on 27 Oct.

## 1. Baseline

Nothing in this repository existed before kickoff. The author started a larger sibling project, OpenPalm AI (`MetaHackathon`, a separate repository), partway through the event, then pivoted to this one because the sibling's scope was too big. Its own provenance draft puts its first commit at 27 Oct 06:12, after kickoff. Commit times only show when files entered a repository, not when the code was first written, so this is the author's account plus that history, not proof.

There is no separate pre-event dependency to install and no baseline tag, because there is no pre-event code.

## 2. Git history of this repository

| Commit | Date | Message |
|---|---|---|
| `4670f7a` | 2026-10-31 23:32 | first commit (README only, 1 line) |
| `e666d3f` | 2026-11-01 00:59 | Refactor code structure for improved readability and maintainability |
| `ae489a7` | 2026-11-03 00:31 | feat: implement useSam and useSamArea hooks with comprehensive testing |
| `a0df4e7` | 2026-11-03 00:45 | feat: enhance session management and message editing capabilities |
| `64ebe13` | 2026-11-03 02:00 | feat: add road reference handling and planning clusters UI |
| `1258df5` | 2026-11-03 14:28 | Add knowledge management features and related tests |

All six commits are inside the event window. The paper knowledge base, PaperRun, the environment library and the Map tab environment viewer were still uncommitted when this draft was written, so they are not yet visible in this history.

## 3. Imported from the sibling project (OpenPalm AI)

These came from `../MetaHackathon`, not written in this repository. They were built inside the event window in that repository. OpenPalm is not being submitted, so this repository is the only submission, and the imported files are disclosed here because they are a different codebase.

| Path | What it is | Source |
|---|---|---|
| `apps/lab/engine/peaks.mjs` | Tree-peak detector | `tree-peaks/peaks.mjs` |
| `apps/lab/engine/algorithms.mjs` | Path comparison algorithms | `path-compare/algorithms.mjs` |
| `apps/lab/engine/project.mjs` | WGS84 to UTM 47N projection | `path-compare/project.mjs` |
| `apps/lab/src/data/upm-candidate-crown-peaks.geojson.json` | Saved candidate crown peaks for the UPM window | OpenPalm output |
| `apps/lab/src/data/upm-chmv2-native.json` | CHMv2 canopy height subset for the UPM window | OpenPalm output |
| `apps/lab/src/data/full-6__A.json`, `full-6__B.json` | Recorded path comparison runs the tests compare against | OpenPalm output |

The three `.mjs` files were copied unchanged on 1 Nov 2026 apart from one import path. The `.d.mts` type files beside them were written for this repository. The Google Maps key uses the same variable name as OpenPalm.

## 4. Built in this repository

- **Map workspace:** saved maps, MapLibre satellite view, SAM 3.1 drawing and area runs, planning points and clusters, route snapshots, comparison view, road reference handling.
- **Muse chat agent:** controls the map, continues earlier sessions, accepts image, text and PDF attachments, and can read papers.
- **Paper knowledge base:** Muse reads a paper in sections, extracts nodes and edges with quotes checked against the text, and stores them in graphify after the user agrees. Collections, a Papers tab, summaries, a replication spec with a gap list.
- **PaperRun:** a Muse pipeline that writes code, runs it in a no network sandbox, repairs it and reviews it, or hands the run to an external coding agent (Codex, Claude Code, Cursor) over a hand written MCP server. Results are compared with the paper by the app, not by the agent. Replication score, rating and next steps.
- **Environment library:** reusable maps digitised from a paper, or generated, that runs can share. Agents can pick from it or add candidates, and the user approves them.

## 5. Meta API use

| Use | Where |
|---|---|
| Muse chat models (Spark 1.3, 1.2, 1.1 and Wonder 1.0) through `https://api.meta.ai/v1/chat/completions` | Map agent, paper reading and extraction, PaperRun code writing, repair, review and spec building |
| Muse Image 1.0 | Generative enhancement in the Muse panel |
| SAM 3.1 through the Meta Model API | Segmentation runs, started explicitly by the user |
| CHMv2 canopy height (Meta/WRI, CC BY 4.0) | Canopy layer for the UPM window, from the saved subset in `src/data` |

All calls use one key, `MODEL_API_KEY`, kept on the dev server. Graphify is used only to store and query the graph. The extraction itself is done by Muse.

## 6. Third party software and AI assistance

- **Libraries:** MapLibre GL, React, geotiff, d3-contour, polygon-clipping, proj4, pngjs, react-markdown, remark-gfm, `@meta-sam/parser`.
- **Services:** Google Map Tiles, Google Earth Engine (OAuth in the browser), a Photon geocoder over OpenStreetMap data.
- **Tools:** graphify (installed separately), poppler's `pdftoppm`, and a Python virtual environment with numpy, scipy, matplotlib and pandas for the PaperRun sandbox.
- **AI assistance:** Claude Code and Codex wrote parts of the code. The graphify integration was first written by Codex, then checked and fixed with Claude Code. The author directed the work and reviewed the results.

## 7. Verification

On 2026-11-03 the suite had 491 tests passing and 1 skipped, and the typecheck and lint were clean. Browser checks were done against the running app for the layouts changed late in the work. Two saved PaperRun runs exist in `apps/lab/paperruns/`, one by Muse and one by an external agent.

## 8. Known limits

- **Replication is early.** On the ACO paper, both runs rate "Early attempt". None of the 17 reported results is within 10% of the paper. Most results are marked not comparable, because the paper only shows its maps and settings as figures. The method is 65% implemented (4 of 13 steps fully, 9 partly).
- **Muse choosing environments** has only run against mocks, not the live model.
- **Environments are drawn on their own.** A digitised grid is not placed on a satellite map.
- **Candidate crown peaks are local maxima of predicted canopy height, not trees.** There is no field accuracy assessment.
- **MCP tools** need the agent to reconnect after the server code changes.

## 9. For the author to confirm before submitting

- That the 1 Nov copy date and the source paths in section 3 match what you did.
- Commit the uncommitted work, then update section 2.
- The one line for the video: what existed before (nothing in this repository; some code and data imported from an unsubmitted sibling project built in the same week) and what was built.
