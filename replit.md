# T2C Live Tracker

Real-time bus tracking website for T2C (Clermont-Ferrand) public transit, in French.

## Architecture

pnpm monorepo with three artifacts:

- **`artifacts/t2c-tracker`** (web, `/`) — React + Vite + Leaflet frontend.
- **`artifacts/api-server`** (api, `/api`) — Express backend that downloads/parses GTFS static and proxies/computes GTFS-RT data.
- **`artifacts/mockup-sandbox`** (design, `/__mockup`) — unused for this project, kept from template.

## Data sources

- GTFS static (zip): `https://www.data.gouv.fr/api/1/datasets/r/4e237a58-cd14-4746-b729-1337a40a8a7b`
- GTFS-RT TripUpdates (protobuf): `https://proxy.transport.data.gouv.fr/resource/t2c-clermont-gtfs-rt-trip-update`
- No VehiclePositions feed published — vehicle positions are **computed** by interpolating along the trip's `shape` between the previous and next stops, using the realtime stop-time + delay.

Override at runtime via env vars: `T2C_GTFS_URL`, `T2C_GTFS_RT_TRIP_UPDATES_URL`.

## Backend layout (`artifacts/api-server/src`)

- `lib/gtfs.ts` — downloads GTFS zip, parses CSV in-memory, builds maps for stops/routes/trips/stopTimes/shapes, expands calendar + calendar_dates into per-day service sets. 12h cache, preloaded on boot.
- `lib/gtfs-rt.ts` — fetches TripUpdates protobuf (5s cache), builds a `Vehicle` per active trip via shape interpolation between consecutive stops with delay applied. Handles trips that started "yesterday" (past-midnight service).
- `routes/gtfs.ts` — endpoints:
  - `GET /api/gtfs/static` → routes + stops list
  - `GET /api/gtfs/route/:id/shape` → polylines + ordered stops for a route
  - `GET /api/gtfs/vehicles` → live vehicle positions
  - `GET /api/gtfs/stop/:id/departures` → next ~15 departures with realtime delays

## Frontend layout (`artifacts/t2c-tracker/src`)

- `App.tsx` — header with logo + search, sidebar (routes / route detail / stop detail), map. React Query polls `/api/gtfs/vehicles` every 10 s.
- `lib/api.ts` — typed `fetch` wrappers using `import.meta.env.BASE_URL` prefix.
- `components/BusMap.tsx` — Leaflet map with Carto Positron tiles. Bus markers are `divIcon`s with route badge + bearing arrow, smoothly animated between polls via `requestAnimationFrame`.
- `components/SearchBar.tsx` — diacritic-insensitive search across routes (short/long name) and stops with inline dropdown.
- `components/Sidebar.tsx` — three modes: route list, route detail (live vehicles + stop list), stop detail (next departures, refreshed every 20 s).

## Conventions

- All UI strings in French.
- Frontend uses `BASE_URL` for any fetch — never root-relative URLs.
- Backend bound to `process.env.PORT`.
- GTFS preloads on server boot to avoid a long first request.
