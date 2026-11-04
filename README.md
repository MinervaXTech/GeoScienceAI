# GeoScienceAI

A map and paper workspace for geoscience research, built for the Meta AI Developer Hackathon. The app lives in `apps/lab`.

- **Map:** saved satellite maps, SAM 3.1 segmentation, canopy height (CHMv2), planning points and clusters, route snapshots, and a Muse chat agent that can control the map.
- **Notes and Papers:** a paper knowledge base. Muse reads a paper, and with your agreement stores what it found in graphify.
- **PaperRun:** reproduce a stored paper, either with Muse in a local sandbox or with an external coding agent (Codex, Claude Code, Cursor) over an MCP server. The app compares the results with the paper.
- **Environments:** a library of maps that paper runs reuse.

## What is new and what was imported

Everything here was built after the event kickoff. The three files in `apps/lab/engine/` and the data in `apps/lab/src/data/` were imported from the author's sibling project, OpenPalm AI, which was built in the same event window, is not being submitted, and was set aside. See [HACKATHON.md](HACKATHON.md) for the full account, the Meta API use and the known limits.

The wiki (WikiLLM) and the knowledge graph are not new ideas and not new tools. The graph is built and drawn with the third party tool graphify, and the wiki follows the existing "LLM Wiki" pattern, in a simpler form. [HACKATHON.md, section 7](HACKATHON.md#7-prior-art-what-is-not-new) says exactly what is borrowed and what was written here.

## Setup

Needs Node 22.12 or newer.

```
cd apps/lab
npm install
cp .env.example .env.local   # then fill in MODEL_API_KEY and GOOGLE_MAPS_API_KEY
npm run dev                  # http://localhost:5173
```

- `MODEL_API_KEY` is the Meta Model API key, used for Muse, SAM 3.1 and image enhancement. Muse, SAM and the paper knowledge base need it.
- The paper knowledge base also needs graphify (the `graphify` command) and poppler's `pdftoppm` installed.
- PaperRun in Muse mode needs the sandbox environment: `npm run paperrun:setup` (needs `uv`). It runs only on macOS.
- To use an external agent, open a run in the PaperRun tab and follow "Connect your coding agent".

## Checks

```
npm test          # vitest
npm run typecheck
npm run lint
npm run build
```
