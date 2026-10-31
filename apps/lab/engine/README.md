# engine

Copied unchanged (apart from one import path) from `../MetaHackathon/tools`, 2026-11-01:

| File | Source |
|---|---|
| `peaks.mjs` | `tree-peaks/peaks.mjs` (detector `openpalm-tree-peaks-v1`) |
| `algorithms.mjs` | `path-compare/algorithms.mjs` (A `openpalm-nn-1.0.0`, B `openpalm-nn2opt-1.0.0`) |
| `project.mjs` | `path-compare/project.mjs` (WGS84 to UTM 47N, proj4 2.22.0) |

The `.d.mts` files are type declarations written for Lab. Do not edit the `.mjs` files here;
change them upstream and copy again. `src/data/` holds the saved layer (GeoJSON renamed to `.geojson.json` so Vite imports it), the CHMv2 subset and the
recorded `full-6` runs that the tests compare against.
