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
| `27f7628` | 2026-11-03 21:23 | Add tests for PaperRunView, ReplicationPanel, and useRunningPaperRuns hook |
| `c6b2c06` | 2026-11-04 17:35 | Add Descendance, Workshop, wiki and graph sync, and shared PaperRun code and memory |

All eight commits are inside the event window. The first is a one line README, so commit times show when files entered this repository, not when the code was first written. The last commit holds most of the work described in section 4 after the paper knowledge base: PaperRun's shared code and memory, Descendance, the Workshop, the wiki and graph sync, and auto-sync.

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
- **Descendance, Workshop and wiki:** Descendance explores what a finished replication makes possible, using subagents and a public online search. A Workshop turns the ideas into hypotheses with one code folder, worked from the user's own IDE or agent over a second MCP server. A finished report or workshop is written as markdown pages in a local wiki folder, and added to the knowledge graph as an entry labelled as app-made. Both follow the app by themselves, but only in response to a change and only after an item has been quiet for a while, so work in progress is not pushed. On a day when nothing changed, nothing is pushed. The graph reads one item at a time within a daily limit. All of it is switchable from one header control. A workshop's empty code folder can be set up with a README, one stub per hypothesis and a copy of the replication code.
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
- **Services:** Google Map Tiles, Google Earth Engine (OAuth in the browser), a Photon geocoder over OpenStreetMap data. OpenAlex (papers), GitHub search (repositories), Stack Exchange (Stack Overflow questions) and Hacker News search (Algolia), all public and keyless, for the Descendance tab's online search: only short search queries leave the app, and what comes back is titles, links, short descriptions and counts.
- **Tools:** graphify (installed separately), poppler's `pdftoppm`, and a Python virtual environment with numpy, scipy, matplotlib and pandas for the PaperRun sandbox.
- **AI assistance:** Claude Code and Codex wrote parts of the code. The graphify integration was first written by Codex, then checked and fixed with Claude Code. The author directed the work and reviewed the results.

## 7. Prior art: what is not new

WikiLLM and the knowledge graph are not inventions of this project. They are existing ideas and existing tools that the app uses. This section says which parts are borrowed and which parts were written here.

### WikiLLM (the wiki)

- **The idea is not new.** Keeping a persistent, interlinked set of markdown pages that a language model maintains, instead of re-reading the raw sources for every question, is a pattern usually called "LLM Wiki" or "Wiki LLM". Secondary write-ups attribute it to Andrej Karpathy, in April 2026. The WikiLLM button in this app refers to that pattern. The original post was not read for this declaration, only these write-ups: [Wiki LLM: how Andrej Karpathy's idea works](https://stal.blogspot.com/2026/05/wiki-llm-how-andrej-karpathys-idea.html), [llm wiki (notesbylex)](https://notesbylex.com/llm-wiki), [LLM Wiki: the pattern of a knowledge base written by the model](https://www.noze.it/en/insights/llm-wiki/).
- **This is not a full copy of it.** In the pattern, the model writes and maintains the pages. Here the pages are written by plain code from records the app already stores, with no model call. What is borrowed is the shape: one markdown page per thing, linked to the others, with an index and an append-only log. The model-written upkeep is not implemented.
- **Written here:** how replications, explorations and workshops become pages, the links between them, the labelling of every page with how far its baseline can be trusted, the reader inside the app, and the automatic updating.

### Knowledge graph

- **The tool is not written here.** The graph is built and kept by graphify, the `graphifyy` package, version 0.9.101, pinned. Its package metadata gives the licence as Apache-2.0, the repository as [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) and the homepage as graphify.com. The app calls it to merge the per-entry graphs, cluster them, export a graph page and answer queries. The page shown in the Knowledge graph view is graphify's own page, which loads the vis-network library from unpkg.com.
- **The idea is not new either.** Turning a paper into nodes and relations is established practice. Nothing here claims otherwise.
- **Written here:** the prompts that make Muse extract nodes and edges, the check that a quote counts only if it appears in the paper text (an edge whose quote is not found is kept but marked as inferred, with no quote), the entry format graphify reads, the consent step, entries made from the app's own reports (labelled as such and filed apart from the papers), the automatic updating, and the two full-page views.

### Also used, not made here

The public search services listed in section 6 (OpenAlex, GitHub, Stack Exchange, Hacker News search), the Meta APIs in section 5, and the Model Context Protocol, an open specification, which the two MCP servers implement by hand.

## 8. Verification

On 2026-11-04 the suite had 631 tests passing and 1 skipped, and the typecheck and lint were clean. The new tabs (Descendance, Workshop), the Papers tab entries and the Layers rule were checked in headless Chrome against the running app, with real Muse output for one Descendance exploration and one Workshop. The Workshop's MCP server was also exercised from a separate process, on a throwaway copy of a project. Eight PaperRun runs and one exploration exist in `apps/lab/paperruns/` and `apps/lab/descendances/`.

## 9. Known limits

- **Replication is early.** On the ACO paper, every run rates "Early attempt". None of the 17 reported results is within 10% of the paper. Most results are marked not comparable, because the paper only shows its maps, scale and some settings as figures or not at all. The method is about 69% implemented. The dynamic-obstacle mission completed 0 of 30 trials.
- **Descendance, Workshop, the wiki and graph entries all inherit that.** Each page and each report states the baseline and says to treat the method as unverified. What an agent reports from an IDE is recorded as reported, not verified.
- **Online search finds leads, not facts.** Papers (OpenAlex), questions (Stack Overflow), discussion (Hacker News) and repositories (GitHub) are listed by title and short description. Nothing found is read in full, run or licence-checked.
- **Automatic graph updates spend Muse calls.** About three per item. The quiet time (10 minutes), one item per check, the daily limit (20 reads) and the idle-day rule bound the spend, and an item that fails three times waits for a change.
- **Graph entries made from reports go through paper extraction.** Quotes are checked against the report itself, so a claim an agent reported is stored as reported. Very long reports can exceed Muse's output limit; one did and was retried with another model.
- **The Workshop has no sandbox.** Code is written and run in the user's own IDE or agent with their normal permissions. The app only receives what the agent reports and what it can see in the code folder.
- **Muse choosing environments** has only run against mocks, not the live model.
- **Environments are drawn on their own.** A digitised grid is not placed on a satellite map.
- **Candidate crown peaks are local maxima of predicted canopy height, not trees.** There is no field accuracy assessment.
- **MCP tools** need the agent to reconnect after the server code changes.

## 10. For the author to confirm before submitting

- That the 1 Nov copy date and the source paths in section 3 match what you did.
- That the WikiLLM attribution in section 7 is the idea you meant. It rests on web search results, not on the original post, so read the original and correct the wording if it differs.
- The one line for the video: what existed before (nothing in this repository; some code and data imported from an unsubmitted sibling project built in the same week) and what was built.
