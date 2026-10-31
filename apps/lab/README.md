# Lab v1 (apps/lab)

React + TypeScript app with local research data and a Google satellite basemap. No model calls. Google imagery is fetched only for map visualization.

```sh
npm install
npm run dev        # http://localhost:5173
npm run preview    # serve a production build locally, including the map proxy
npm run lint && npm run typecheck && npm test && npm run build
```

- `engine/`: detector and tour algorithms copied from MetaHackathon/tools (see engine/README.md).
- `src/domain/`: label rule, validation, store functions, queries, snapshots, persistence. Pure and tested.
- `src/ui/`: React views. Data lives in localStorage key `lab.state` (schema version 1); Export/Import JSON in the header.
- Sample data loads only from the "Load sample data" button and every sample object is badged.

Google satellite uses the same MapLibre + server-side Google Map Tiles API approach as MetaHackathon. Put the following in `apps/lab/.env.local`, then restart the development server:

```dotenv
GOOGLE_MAPS_API_KEY=your_google_map_tiles_api_key
```

Enable **Map Tiles API** for the key's Google Cloud project. Use server API/IP restrictions; this is not a browser-referrer key. The `.env.local` file is ignored by Git. The key and Google's session token stay in the Vite server; the browser receives only an opaque map handle and same-origin tile URLs. Provider imagery is not written to disk. Attribution and coverage metadata are refreshed as the viewport changes. CHMv2 is an independently georeferenced overlay with visibility and opacity controls; peaks and routes use their WGS84 coordinates.

Run through `npm run dev` or `npm run preview` for the map proxy. A static `dist/` deployment alone does not include that backend; production hosting needs the equivalent `/api/maps/*` server endpoints.
