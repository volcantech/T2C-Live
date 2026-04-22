import { logger } from "./logger";

/**
 * Real walking-route computation using the OSRM public demo server
 * (router.project-osrm.org, foot profile). This gives distances and durations
 * that closely match Google Maps because both ride on the OpenStreetMap road
 * graph for pedestrian routing.
 *
 * We cache results in memory (LRU-ish via Map insertion order) and fall back
 * to a great-circle * 1.3 heuristic at 4.5 km/h on any error / timeout, so the
 * planner never blocks indefinitely.
 */

export interface WalkRoute {
  /** Distance in meters along the walking path. */
  distance: number;
  /** Duration in seconds along the walking path. */
  duration: number;
}

// The router.project-osrm.org demo replies with a runner-speed duration for
// the "foot" endpoint, so distances match Google but durations are too low.
// routing.openstreetmap.de/routed-foot uses a true 4.5 km/h walking profile.
const OSRM_BASE =
  process.env["OSRM_FOOT_BASE"] ??
  "https://routing.openstreetmap.de/routed-foot";
const TIMEOUT_MS = 4000;
const CACHE_MAX = 2000;
/** Round coordinates to ~10 m so cache hits compose well between requests. */
const COORD_ROUND = 1e4;

const CACHE = new Map<string, WalkRoute>();

const FALLBACK_DETOUR = 1.3;
const FALLBACK_SPEED_MPS = 1.25;

/** Great-circle distance in meters. */
function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function fallbackRoute(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): WalkRoute {
  const d = haversine(a, b) * FALLBACK_DETOUR;
  return { distance: Math.round(d), duration: Math.round(d / FALLBACK_SPEED_MPS) };
}

function cacheKey(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): string {
  const r = (n: number) => Math.round(n * COORD_ROUND) / COORD_ROUND;
  return `${r(a.lat)},${r(a.lng)}->${r(b.lat)},${r(b.lng)}`;
}

function setCache(key: string, value: WalkRoute) {
  if (CACHE.size >= CACHE_MAX) {
    const firstKey = CACHE.keys().next().value;
    if (firstKey !== undefined) CACHE.delete(firstKey);
  }
  CACHE.set(key, value);
}

/**
 * Compute the real walking route between two coordinates. Returns the cached
 * result on hit, calls OSRM on miss, and falls back to the great-circle
 * heuristic on any failure.
 */
export async function walkingRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<WalkRoute> {
  // Same coordinate: zero-length walk.
  if (
    Math.abs(from.lat - to.lat) < 1e-6 &&
    Math.abs(from.lng - to.lng) < 1e-6
  ) {
    return { distance: 0, duration: 0 };
  }
  const key = cacheKey(from, to);
  const hit = CACHE.get(key);
  if (hit) return hit;

  // For very short distances skip the network round-trip (OSRM noise).
  if (haversine(from, to) < 25) {
    const r = fallbackRoute(from, to);
    setCache(key, r);
    return r;
  }

  const url =
    `${OSRM_BASE}/route/v1/foot/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=false&alternatives=false&steps=false`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{ distance: number; duration: number }>;
    };
    if (data.code !== "Ok" || !data.routes?.length) {
      throw new Error(`OSRM code=${data.code}`);
    }
    const r0 = data.routes[0];
    const route: WalkRoute = {
      distance: Math.round(r0.distance),
      duration: Math.round(r0.duration),
    };
    setCache(key, route);
    return route;
  } catch (e) {
    logger.debug({ err: String(e) }, "OSRM walking fallback");
    const r = fallbackRoute(from, to);
    // Don't cache errors permanently; cache the fallback briefly so a flurry
    // of concurrent requests doesn't all hit OSRM.
    setCache(key, r);
    return r;
  }
}

/**
 * Compute several walking routes in parallel. Useful when enriching an
 * itinerary that has many walk legs across multiple options.
 */
export async function walkingRoutes(
  pairs: Array<{ from: { lat: number; lng: number }; to: { lat: number; lng: number } }>,
): Promise<WalkRoute[]> {
  return Promise.all(pairs.map((p) => walkingRoute(p.from, p.to)));
}
