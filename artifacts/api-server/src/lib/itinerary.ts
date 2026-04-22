import { getGtfs, haversine, type GtfsData } from "./gtfs";
import { getRealtimeFeed } from "./gtfs-rt";
import { parisNow } from "./paris-time";

export interface ItineraryLeg {
  routeId: string;
  routeShortName: string;
  routeColor: string;
  routeTextColor: string;
  headsign: string;
  fromStopId: string;
  fromStopName: string;
  toStopId: string;
  toStopName: string;
  departure: number;
  arrival: number;
  delay: number;
  numStops: number;
  intermediateStops: { id: string; name: string }[];
  tripId: string;
}

export interface WalkingLeg {
  /** "start" walks from the address to the boarding stop;
   *  "end" walks from the alighting stop to the destination address. */
  kind: "start" | "end";
  stopId: string;
  stopName: string;
  /** Walking distance in meters (great-circle x 1.3 to approximate streets). */
  distance: number;
  /** Walking time in seconds (≈ 4.5 km/h). */
  duration: number;
}

export interface ItineraryOption {
  legs: ItineraryLeg[];
  walkBefore?: WalkingLeg;
  walkAfter?: WalkingLeg;
  /** Time at which the user starts moving (i.e. starts walking, or the bus
   *  leaves if there is no starting walk). */
  departure: number;
  /** Time at which the user reaches the final destination. */
  arrival: number;
  /** Total trip duration including walking. */
  duration: number;
}

/** Walking speed assumption: 4.5 km/h. */
const WALK_SPEED_MPS = 1.25;
/** Detour factor to roughly approximate street layout vs great-circle. */
const WALK_DETOUR = 1.3;
/** Maximum walking distance to consider a stop reachable on foot. */
const MAX_WALK_M = 1200;
/** How many candidate stops to keep around each address endpoint. */
const MAX_CANDIDATES = 5;

export interface AddressEndpoint {
  kind: "address";
  lat: number;
  lng: number;
}
export interface StopEndpoint {
  kind: "stop";
  stopIds: string[];
}
export type Endpoint = AddressEndpoint | StopEndpoint;

interface Candidate {
  stopId: string;
  stopName: string;
  distance: number;
  duration: number;
  /** Set of equivalent stop ids (same parent station) used during plan matching. */
  ids: Set<string>;
}

function walkingMeters(distMeters: number): number {
  return distMeters * WALK_DETOUR;
}
function walkingSeconds(distMeters: number): number {
  return walkingMeters(distMeters) / WALK_SPEED_MPS;
}

function candidatesFromAddress(
  g: GtfsData,
  lat: number,
  lng: number,
): Candidate[] {
  // Group nearby physical stops by parent station when available, otherwise
  // by stop name (T2C bus stops typically have one stop_id per direction with
  // no parent_station). Keeping the closest representative per group avoids
  // surfacing two near-identical "Rochefort" entries when a station has two
  // platforms a few meters apart.
  const byKey = new Map<string, Candidate>();
  for (const s of g.stops.values()) {
    if (s.locationType !== 0) continue;
    const dist = haversine({ lat, lng }, s);
    if (dist > MAX_WALK_M) continue;
    const key = s.parentId || s.name;
    const cur = byKey.get(key);
    if (!cur || dist < cur.distance) {
      byKey.set(key, {
        stopId: s.id,
        stopName: s.name,
        distance: dist,
        duration: walkingSeconds(dist),
        ids: new Set(),
      });
    }
  }
  const list = [...byKey.values()].sort((a, b) => a.distance - b.distance);
  const trimmed = list.slice(0, MAX_CANDIDATES);
  // Expand each candidate to every sibling stop (same parent_station OR same
  // name when there is no parent). This is essential so the boarding-side
  // match also considers the opposite-direction platform — without it, the
  // algorithm could fall back to a much farther stop just because the closest
  // platform happens to serve the wrong direction.
  for (const c of trimmed) {
    const seed = g.stops.get(c.stopId);
    if (!seed) continue;
    c.ids.add(c.stopId);
    const parentId = seed.locationType === 1 ? seed.id : seed.parentId;
    if (parentId) {
      for (const x of g.stops.values()) {
        if (x.parentId === parentId || x.id === parentId) c.ids.add(x.id);
      }
    } else {
      for (const x of g.stops.values()) {
        if (x.locationType === 0 && x.name === seed.name) c.ids.add(x.id);
      }
    }
  }
  return trimmed;
}

function candidatesFromStops(g: GtfsData, stopIds: string[]): Candidate[] {
  if (!stopIds.length) return [];
  const ids = new Set(stopIds);
  const first = g.stops.get(stopIds[0]);
  return [
    {
      stopId: stopIds[0],
      stopName: first?.name ?? "Arrêt",
      distance: 0,
      duration: 0,
      ids,
    },
  ];
}

function resolveCandidates(g: GtfsData, ep: Endpoint): Candidate[] {
  if (ep.kind === "address") return candidatesFromAddress(g, ep.lat, ep.lng);
  return candidatesFromStops(g, ep.stopIds);
}

export function expandSameName(g: GtfsData, stopId: string): string[] {
  const s = g.stops.get(stopId);
  if (!s) return [];
  // Group by parent_station when available; otherwise fall back to stop name.
  const out = new Set<string>([stopId]);
  const parentId = s.locationType === 1 ? s.id : s.parentId;
  if (parentId) {
    for (const x of g.stops.values()) {
      if (x.parentId === parentId || x.id === parentId) out.add(x.id);
    }
  } else {
    for (const x of g.stops.values()) {
      if (x.name === s.name) out.add(x.id);
    }
  }
  return [...out];
}

export async function planItinerary(
  fromStopIds: string[],
  toStopIds: string[],
  atTime: number = Math.floor(Date.now() / 1000),
  limit = 6,
): Promise<ItineraryOption[]> {
  const [gtfs, feed] = await Promise.all([getGtfs(), getRealtimeFeed()]);
  if (!fromStopIds.length || !toStopIds.length) return [];
  const fromSet = new Set(fromStopIds);
  const toSet = new Set(toStopIds);
  const rtByTrip = new Map(feed.map((f) => [f.tripId, f] as const));

  const { todayStr, nowSec, dayBase } = parisNow(new Date(atTime * 1000));

  const options: ItineraryOption[] = [];

  for (const [tripId, sched] of gtfs.stopTimes) {
    const trip = gtfs.trips.get(tripId);
    if (!trip) continue;
    const dates = gtfs.serviceDates.get(trip.serviceId);
    if (!dates || !dates.has(todayStr)) continue;

    // Pre-compute the indices of all from/to stops along this trip so we can
    // enumerate every valid (boarding, alighting) pair. This is essential for
    // address-based routing: the user might prefer to board a few stops later
    // (closer to their address) even when an earlier stop also matches.
    const fromIdxs: number[] = [];
    const toIdxs: number[] = [];
    for (let i = 0; i < sched.length; i++) {
      if (fromSet.has(sched[i].stopId)) fromIdxs.push(i);
      if (toSet.has(sched[i].stopId)) toIdxs.push(i);
    }
    if (!fromIdxs.length || !toIdxs.length) continue;

    const route = gtfs.routes.get(trip.routeId);
    if (!route) continue;

    const rt = rtByTrip.get(tripId);

    for (const fromIdx of fromIdxs) {
      if (sched[fromIdx].departure < nowSec - 60) continue;
      for (const toIdx of toIdxs) {
        if (toIdx <= fromIdx) continue;

        let depDelay = 0;
        let arrDelay = 0;
        if (rt) {
          depDelay = rt.stopUpdates.get(sched[fromIdx].stopSeq)?.delay ?? 0;
          arrDelay = rt.stopUpdates.get(sched[toIdx].stopSeq)?.delay ?? depDelay;
        }
        const fromStop = gtfs.stops.get(sched[fromIdx].stopId);
        const toStop = gtfs.stops.get(sched[toIdx].stopId);
        if (!fromStop || !toStop) continue;

        const departure = dayBase + sched[fromIdx].departure + depDelay;
        const arrival = dayBase + sched[toIdx].arrival + arrDelay;

        const intermediateStops: { id: string; name: string }[] = [];
        for (let i = fromIdx + 1; i < toIdx; i++) {
          const s = gtfs.stops.get(sched[i].stopId);
          if (s) intermediateStops.push({ id: s.id, name: s.name });
        }

        options.push({
          legs: [
            {
              routeId: route.id,
              routeShortName: route.shortName,
              routeColor: route.color,
              routeTextColor: route.textColor,
              headsign: trip.headsign,
              fromStopId: fromStop.id,
              fromStopName: fromStop.name,
              toStopId: toStop.id,
              toStopName: toStop.name,
              departure,
              arrival,
              delay: depDelay,
              numStops: toIdx - fromIdx,
              intermediateStops,
              tripId,
            },
          ],
          departure,
          arrival,
          duration: arrival - departure,
        });
      }
    }
  }

  options.sort((a, b) => a.departure - b.departure);

  // Dedupe: keep at most 2 per route+headsign combination
  // Dedupe per (route, headsign, boarding stop) so the address-based caller
  // can compare alternative boarding points (e.g. "Patural" vs "Rochefort")
  // for the same line and still see a couple of upcoming trips for each.
  const seen = new Map<string, number>();
  const filtered: ItineraryOption[] = [];
  for (const opt of options) {
    const leg = opt.legs[0];
    const key = `${leg.routeId}|${leg.headsign}|${leg.fromStopId}|${leg.toStopId}`;
    const c = seen.get(key) ?? 0;
    if (c < 2) {
      filtered.push(opt);
      seen.set(key, c + 1);
    }
    if (filtered.length >= limit) break;
  }
  return filtered;
}

/**
 * Plan an itinerary where each endpoint is either a known stop (group) or an
 * arbitrary lat/lng. Walking legs are added at the start and/or end as needed.
 *
 * The function returns the up-to `limit` options sorted by total arrival time.
 */
export async function planItineraryEndpoints(
  from: Endpoint,
  to: Endpoint,
  limit = 6,
): Promise<ItineraryOption[]> {
  const g = await getGtfs();
  const fromCandidates = resolveCandidates(g, from);
  const toCandidates = resolveCandidates(g, to);
  if (!fromCandidates.length || !toCandidates.length) return [];

  // Build look-ups so we can map a board/alight stop id back to the candidate
  // it came from (to recover walking distance/duration).
  const fromByStop = new Map<string, Candidate>();
  for (const c of fromCandidates) for (const id of c.ids) fromByStop.set(id, c);
  const toByStop = new Map<string, Candidate>();
  for (const c of toCandidates) for (const id of c.ids) toByStop.set(id, c);

  // Aggregate stop ids used for transit search.
  const fromIds = [...fromByStop.keys()];
  const toIds = [...toByStop.keys()];

  // The earliest the user can be at any boarding stop = now + min walk to it.
  const minWalkBefore = Math.min(...fromCandidates.map((c) => c.duration));
  const startAt = Math.floor(Date.now() / 1000) + Math.floor(minWalkBefore);
  // Ask for many candidates so the address-side dedupe (by total walk) has
  // enough variants to compare across boarding and alighting stops.
  const transitOptions = await planItinerary(fromIds, toIds, startAt, limit * 8);

  const enriched: ItineraryOption[] = [];
  const nowSec = Math.floor(Date.now() / 1000);

  for (const opt of transitOptions) {
    const leg = opt.legs[0];
    const startCand = fromByStop.get(leg.fromStopId);
    const endCand = toByStop.get(leg.toStopId);
    if (!startCand || !endCand) continue;

    // Cannot reach this boarding stop in time.
    if (leg.departure - nowSec < startCand.duration - 30) continue;

    const walkBefore: WalkingLeg | undefined =
      from.kind === "address"
        ? {
            kind: "start",
            stopId: startCand.stopId,
            stopName: startCand.stopName,
            distance: Math.round(walkingMeters(startCand.distance)),
            duration: Math.round(startCand.duration),
          }
        : undefined;
    const walkAfter: WalkingLeg | undefined =
      to.kind === "address"
        ? {
            kind: "end",
            stopId: endCand.stopId,
            stopName: endCand.stopName,
            distance: Math.round(walkingMeters(endCand.distance)),
            duration: Math.round(endCand.duration),
          }
        : undefined;

    const departure = walkBefore
      ? leg.departure - walkBefore.duration
      : leg.departure;
    const arrival = walkAfter
      ? leg.arrival + walkAfter.duration
      : leg.arrival;

    enriched.push({
      ...opt,
      walkBefore,
      walkAfter,
      departure,
      arrival,
      duration: arrival - departure,
    });
  }

  // For each (route, headsign), keep the variant with the SHORTEST total walk.
  // This biases the result towards the user's expectation of "the closest
  // bus stop", instead of an option that boards a bit farther just to shave
  // a couple of minutes off the bus ride.
  const totalWalk = (o: ItineraryOption): number =>
    (o.walkBefore?.distance ?? 0) + (o.walkAfter?.distance ?? 0);

  enriched.sort((a, b) => {
    const wa = totalWalk(a);
    const wb = totalWalk(b);
    if (wa !== wb) return wa - wb;
    return a.arrival - b.arrival;
  });

  const seen = new Map<string, ItineraryOption>();
  for (const opt of enriched) {
    const leg = opt.legs[0];
    const key = `${leg.routeId}|${leg.headsign}`;
    if (!seen.has(key)) seen.set(key, opt);
  }

  // Final list ordered by earliest total arrival so the soonest option is on
  // top, with each route represented by its closest boarding stop.
  return [...seen.values()]
    .sort((a, b) => a.arrival - b.arrival)
    .slice(0, limit);
}

export function parseEndpoint(raw: string, g: GtfsData): Endpoint | null {
  if (!raw) return null;
  if (raw.startsWith("addr:")) {
    const [latStr, lngStr] = raw.slice(5).split(",");
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { kind: "address", lat, lng };
  }
  const stopId = raw.startsWith("stop:") ? raw.slice(5) : raw;
  const ids = expandSameName(g, stopId);
  if (!ids.length) return null;
  return { kind: "stop", stopIds: ids };
}
