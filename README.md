# GeoScienceAI Lab

[![DOI](https://zenodo.org/badge/1440980399.svg)](https://doi.org/10.5281/zenodo.23955762)
[![Licence: Apache-2.0](https://img.shields.io/badge/licence-Apache--2.0-blue.svg)](LICENSE)

**Reproduce a research paper with agents, then test what the reproduction makes possible, and always say how far each result can be trusted.**

GeoScienceAI Lab is a local web app built for the Meta AI Developer Hackathon. It started as a geoscience map workspace (satellite maps, tree and canopy analysis) and grew a paper workflow on top of it. The model used inside the app is Muse, through the Meta Model API. The app lives in [`apps/lab`](apps/lab).

## What it does

| Tab | What it is for |
| --- | --- |
| **Map** | Saved satellite maps, SAM 3.1 segmentation, CHMv2 canopy height, planning points and clusters, route snapshots, and a Muse chat agent that can control the map. |
| **Notes** | Your own notes, kept next to the papers they are about. |
| **Papers** | A paper knowledge base. Muse reads a paper, and only with your agreement stores what it found. A quote counts as verified only if it appears in the paper text, otherwise the link is kept and marked inferred. |
| **PaperRun** | Reproduce a stored paper, with Muse in a local sandbox or with an external coding agent (Codex, Claude Code, Cursor) over an MCP server. **The app, not the agent, compares the numbers with the paper's.** |
| **Descendance** | Explore what a finished replication makes possible. A coordinator and subagents write a report, with online leads from OpenAlex, GitHub, Stack Overflow and Hacker News. Every report states how far the baseline replication can be trusted. |
| **Workshop** | Test the hypotheses from a Descendance report in your own IDE or agent. An MCP server carries progress back. A hypothesis can be marked supported or refuted only with a recorded experiment and a measured value. |
| **WikiLLM and Knowledge graph** | Header buttons that open a markdown wiki and a knowledge graph, both fed from your replications, explorations and workshops. |

### Rules the app enforces

- **Comparison is done by the app.** A reproduced number counts as comparable only if it ran on the paper's own data and settings. Everything else is shown as not comparable or not run.
- **No claim without a measurement.** In a Workshop, an agent cannot mark a hypothesis supported or refuted without a recorded experiment, a metric and a measured value. Agent results are labelled as reported.
- **Provenance travels with the knowledge.** Wiki pages and graph entries made by the app are labelled as app-made, are not treated as paper evidence, and are kept out of the paper corpus.
- **Nothing is stored without agreement.** Adding a paper to the knowledge base, or deleting from it, needs your confirmation.
- **Automatic updates are slow on purpose.** Wiki and graph updates wait for a quiet period (10 minutes by default), push one item per check, respect a daily limit (20 by default), and push nothing on a day with no changes.

## An honest first result

The first paper reproduced here, "Global and local path planning of robots combining ACO and dynamic window algorithm", was rated **Early attempt**: none of 17 compared results could be verified against the paper, and about 69% of the method was implemented. The paper's maps, scale and some definitions are not published. A later Workshop then found defects in this project's own replication code, and recorded them rather than hiding them. Details and limits are in [HACKATHON.md](HACKATHON.md).

## Quick start

Needs Node 22.12 or newer.

```
cd apps/lab
npm install
cp .env.example .env.local   # then fill in MODEL_API_KEY and GOOGLE_MAPS_API_KEY
npm run dev                  # http://localhost:5173
```

| Setting | Used for |
| --- | --- |
| `MODEL_API_KEY` | The Meta Model API key. Needed for Muse, SAM 3.1, image enhancement and the paper knowledge base. |
| `GOOGLE_MAPS_API_KEY` | The Google satellite basemap. |
| `VITE_EARTH_ENGINE_*` | The Earth Engine preview. See `.env.example`. |

Extra requirements, only for the features that use them:

- **Paper knowledge base:** the `graphify` command and poppler's `pdftoppm`.
- **PaperRun in Muse mode:** `npm run paperrun:setup` (needs `uv`). It runs only on macOS.
- **External agent:** open a run in the PaperRun tab and follow "Connect your coding agent". The Workshop tab shows the same for its own MCP server.

Run data (papers, runs, descendances, workshops, the wiki and the knowledge base) is stored under `apps/lab` and is not committed.

## How it is organised

- `apps/lab/src`: the React and TypeScript interface and the map and domain logic.
- `apps/lab/server`: Vite dev-server plugins for each feature (PaperRun, Descendance, Workshop, wiki, graph sync, auto-sync) and two MCP servers, `paperrun` and `workshop`.
- `apps/lab/engine`: imported code, see below.

## What is new and what was imported

Everything here was built after the event kickoff. The three files in `apps/lab/engine/` and the data in `apps/lab/src/data/` were imported from the author's sibling project, OpenPalm AI, which was built in the same event window, is not being submitted, and was set aside.

The wiki (WikiLLM) and the knowledge graph are not new ideas and not new tools. The graph is built and drawn with the third party tool [graphify](https://github.com/Graphify-Labs/graphify), and the wiki follows the existing "LLM Wiki" pattern, in a simpler form. [HACKATHON.md, section 7](HACKATHON.md#7-prior-art-what-is-not-new) says exactly what is borrowed and what was written here.

## Limits and safety

- This is a research prototype that runs on your own machine. The dev server has no sign-in, so do not expose it to a network.
- The results come from one paper and one replication thread. There is no ablation study, no comparison with other systems or models, and no field study.
- Descendance reports are model reasoning plus online leads. Leads are not facts, and each report says how far its baseline can be trusted.
- Inside the app only Muse is used as the model. External agents are optional and their results are labelled.

The full list of limits is in [HACKATHON.md, section 9](HACKATHON.md#9-known-limits).

## Checks

```
npm test          # vitest
npm run typecheck
npm run lint
npm run build
```

## Documentation

- [HACKATHON.md](HACKATHON.md): git history, what was imported, what was built, Meta API use, third party software, prior art, verification and known limits.
- [NOTICE](NOTICE): copyright and the citation request.

## Citation

If you use this software, or ideas or results taken from it, please cite it.

> Lee, S. S., and Lim, L. G. (2026). GeoScienceAI Lab (v0.1.0). Zenodo. https://doi.org/10.5281/zenodo.23955762

```bibtex
@software{lee_lim_geoscienceai_2026,
  author    = {Lee, Sheng Siang and Lim, Lam Ghai},
  title     = {GeoScienceAI Lab},
  year      = {2026},
  version   = {v0.1.0},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.23955762},
  url       = {https://github.com/MinervaXTech/GeoScienceAI}
}
```

## Licence

Apache License 2.0, see [LICENSE](LICENSE). Anyone who redistributes this code must keep the copyright notice and the [NOTICE](NOTICE) file, which carries the citation request above. Third party software used here keeps its own licence and credit, listed in [HACKATHON.md](HACKATHON.md#6-third-party-software-and-ai-assistance).

## Contact

hello@minerva-x-tech.com, lim.lamghai@monash.edu
