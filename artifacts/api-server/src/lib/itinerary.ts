import { getGtfs, haversine, type GtfsData } from "./gtfs";
import { getRealtimeFeed } from "./gtfs-rt";
import { parisNow } from "./paris-time";
import { walkingRoute } from "./walking";

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
   *  "end" walks from the alighting stop to the destination address;
   *  "transfer" walks between two stops during a connection. */
  kind: "start" | "end" | "transfer";
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
  /** One walking entry between consecutive bus legs (same length as legs.length-1).
   *  Each entry may be null if the connection is at the exact same stop. */
  transferWalks?: (WalkingLeg | null)[];
  /** Time at which the user starts moving (i.e. starts walking, or the bus
   *  leaves if there is no starting walk). */
  departure: number;
  /** Time at which the user reaches the final destination. */
  arrival: number;
  /** Total trip duration including walking. */
  duration: number;
  /** Pure on-board (bus/tram) time, in seconds, summed over all transit legs. */
  transitDuration: number;
  /** Pure walking time, in seconds, summed (start + transfers + end). */
  walkDuration: number;
}

/** Walking speed assumption: 4.5 km/h. */
const WALK_SPEED_MPS = 1.25;
/** Detour factor to roughly approximate street layout vs great-circle. */
const WALK_DETOUR = 1.3;
/** Maximum walking distance to consider a stop reachable on foot. */
const MAX_WALK_M = 1200;
/** How many candidate stops to keep around each address endpoint. */
const MAX_CANDIDATES = 8;
/** Minimum buffer time at a transfer in seconds (passenger needs to walk + wait). */
const TRANSFER_MIN_S = 90;
/** Maximum acceptable wait at a transfer in seconds. */
const TRANSFER_MAX_WAIT_S = 30 * 60;

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

/** Build an in-memory index: stopId → list of (tripId, idx, in-day departure seconds). */
let boardingIndex: {
  for: GtfsData;
  map: Map<string, Array<{ tripId: string; idx: number; dep: number }>>;
} | null = null;

function getBoardingIndex(g: GtfsData) {
  if (boardingIndex && boardingIndex.for === g) return boardingIndex.map;
  const map = new Map<
    string,
    Array<{ tripId: string; idx: number; dep: number }>
  >();
  for (const [tripId, sched] of g.stopTimes) {
    for (let i = 0; i < sched.length; i++) {
      const st = sched[i];
      let arr = map.get(st.stopId);
      if (!arr) {
        arr = [];
        map.set(st.stopId, arr);
      }
      arr.push({ tripId, idx: i, dep: st.departure });
    }
  }
  for (const arr of map.values()) arr.sort((a, b) => a.dep - b.dep);
  boardingIndex = { for: g, map };
  return map;
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
          transitDuration: arrival - departure,
          walkDuration: 0,
        });
      }
    }
  }

  options.sort((a, b) => a.departure - b.departure);

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

/** Plan trips that change buses once (one transfer / une correspondance). */
async function planTransferItinerary(
  fromStopIds: string[],
  toStopIds: string[],
  atTime: number,
  limit: number,
): Promise<ItineraryOption[]> {
  const [gtfs, feed] = await Promise.all([getGtfs(), getRealtimeFeed()]);
  if (!fromStopIds.length || !toStopIds.length) return [];
  const fromSet = new Set(fromStopIds);
  const toSet = new Set(toStopIds);
  const rtByTrip = new Map(feed.map((f) => [f.tripId, f] as const));
  const idx = getBoardingIndex(gtfs);

  const { todayStr, dayBase } = parisNow(new Date(atTime * 1000));

  // Gather first-leg candidates (board at a from-stop, alight somewhere along the trip).
  interface FirstLeg {
    tripId: string;
    routeId: string;
    boardIdx: number;
    alightIdx: number;
    departure: number;
    arrival: number;
    depDelay: number;
    arrDelay: number;
    alightStopId: string;
  }
  const firstLegs: FirstLeg[] = [];
  const horizon = atTime + 90 * 60;

  for (const [tripId, sched] of gtfs.stopTimes) {
    const trip = gtfs.trips.get(tripId);
    if (!trip) continue;
    const dates = gtfs.serviceDates.get(trip.serviceId);
    if (!dates || !dates.has(todayStr)) continue;

    let boardIdx = -1;
    let depDelay = 0;
    let departure = 0;
    const rt = rtByTrip.get(tripId);
    for (let i = 0; i < sched.length; i++) {
      if (fromSet.has(sched[i].stopId)) {
        const d = rt?.stopUpdates.get(sched[i].stopSeq)?.delay ?? 0;
        const dep = dayBase + sched[i].departure + d;
        if (dep < atTime - 60) continue;
        if (dep > horizon) continue;
        boardIdx = i;
        depDelay = d;
        departure = dep;
        break; // earliest boarding is enough for this trip
      }
    }
    if (boardIdx === -1) continue;

    // Each subsequent stop on this trip is a potential transfer/alight point.
    for (let alightIdx = boardIdx + 1; alightIdx < sched.length; alightIdx++) {
      // Skip alighting directly at a destination stop — those are handled by
      // the direct planner.
      if (toSet.has(sched[alightIdx].stopId)) continue;
      const arrDelay =
        rt?.stopUpdates.get(sched[alightIdx].stopSeq)?.delay ?? depDelay;
      const arrival = dayBase + sched[alightIdx].arrival + arrDelay;
      firstLegs.push({
        tripId,
        routeId: trip.routeId,
        boardIdx,
        alightIdx,
        departure,
        arrival,
        depDelay,
        arrDelay,
        alightStopId: sched[alightIdx].stopId,
      });
    }
  }

  firstLegs.sort((a, b) => a.departure - b.departure);

  const options: ItineraryOption[] = [];
  // Keep best (earliest arrival) per pair of (route1, route2, transferName).
  const bestByKey = new Map<string, ItineraryOption>();

  let processed = 0;
  for (const fl of firstLegs) {
    if (processed > 800) break;
    processed++;

    const transferStopIds = expandSameName(gtfs, fl.alightStopId);
    const transferStopGroup = new Set(transferStopIds);
    const earliestBoard = fl.arrival + TRANSFER_MIN_S;
    const latestBoard = earliestBoard + TRANSFER_MAX_WAIT_S;

    for (const transferStopId of transferStopIds) {
      const candidates = idx.get(transferStopId);
      if (!candidates) continue;
      // Binary-search would be nicer; linear scan is fine for ~50 dep/day per stop.
      for (const c of candidates) {
        if (c.tripId === fl.tripId) continue;
        const trip2 = gtfs.trips.get(c.tripId);
        if (!trip2) continue;
        if (trip2.routeId === fl.routeId) continue;
        const dates = gtfs.serviceDates.get(trip2.serviceId);
        if (!dates || !dates.has(todayStr)) continue;

        const sched2 = gtfs.stopTimes.get(c.tripId);
        if (!sched2) continue;
        const rt2 = rtByTrip.get(c.tripId);
        const dep2Delay =
          rt2?.stopUpdates.get(sched2[c.idx].stopSeq)?.delay ?? 0;
        const dep2Real = dayBase + sched2[c.idx].departure + dep2Delay;
        if (dep2Real < earliestBoard) continue;
        if (dep2Real > latestBoard) break;

        // Find first alight at a destination stop AFTER the boarding index.
        let alight2Idx = -1;
        for (let i = c.idx + 1; i < sched2.length; i++) {
          if (toSet.has(sched2[i].stopId)) {
            alight2Idx = i;
            break;
          }
          // Avoid looping back: if trip re-visits the same transfer group, stop.
          if (transferStopGroup.has(sched2[i].stopId)) break;
        }
        if (alight2Idx === -1) continue;

        const arr2Delay =
          rt2?.stopUpdates.get(sched2[alight2Idx].stopSeq)?.delay ?? dep2Delay;
        const arrival2 = dayBase + sched2[alight2Idx].arrival + arr2Delay;

        const route1 = gtfs.routes.get(fl.routeId);
        const route2 = gtfs.routes.get(trip2.routeId);
        if (!route1 || !route2) continue;
        const sched1 = gtfs.stopTimes.get(fl.tripId);
        if (!sched1) continue;
        const trip1 = gtfs.trips.get(fl.tripId);
        if (!trip1) continue;
        const fromStop1 = gtfs.stops.get(sched1[fl.boardIdx].stopId);
        const alightStop1 = gtfs.stops.get(fl.alightStopId);
        const board2Stop = gtfs.stops.get(transferStopId);
        const alightStop2 = gtfs.stops.get(sched2[alight2Idx].stopId);
        if (!fromStop1 || !alightStop1 || !board2Stop || !alightStop2) continue;

        const intermediate1: { id: string; name: string }[] = [];
        for (let i = fl.boardIdx + 1; i < fl.alightIdx; i++) {
          const s = gtfs.stops.get(sched1[i].stopId);
          if (s) intermediate1.push({ id: s.id, name: s.name });
        }
        const intermediate2: { id: string; name: string }[] = [];
        for (let i = c.idx + 1; i < alight2Idx; i++) {
          const s = gtfs.stops.get(sched2[i].stopId);
          if (s) intermediate2.push({ id: s.id, name: s.name });
        }

        // Walking between the two transfer platforms (often 0 m for buses
        // sharing a sign).
        const transferDist = haversine(alightStop1, board2Stop);
        const transferWalk: WalkingLeg | null =
          transferDist > 5
            ? {
                kind: "transfer",
                stopId: board2Stop.id,
                stopName: board2Stop.name,
                distance: Math.round(walkingMeters(transferDist)),
                duration: Math.round(walkingSeconds(transferDist)),
              }
            : null;

        const transitDuration =
          fl.arrival - fl.departure + (arrival2 - dep2Real);

        const opt: ItineraryOption = {
          legs: [
            {
              routeId: route1.id,
              routeShortName: route1.shortName,
              routeColor: route1.color,
              routeTextColor: route1.textColor,
              headsign: trip1.headsign,
              fromStopId: fromStop1.id,
              fromStopName: fromStop1.name,
              toStopId: alightStop1.id,
              toStopName: alightStop1.name,
              departure: fl.departure,
              arrival: fl.arrival,
              delay: fl.depDelay,
              numStops: fl.alightIdx - fl.boardIdx,
              intermediateStops: intermediate1,
              tripId: fl.tripId,
            },
            {
              routeId: route2.id,
              routeShortName: route2.shortName,
              routeColor: route2.color,
              routeTextColor: route2.textColor,
              headsign: trip2.headsign,
              fromStopId: board2Stop.id,
              fromStopName: board2Stop.name,
              toStopId: alightStop2.id,
              toStopName: alightStop2.name,
              departure: dep2Real,
              arrival: arrival2,
              delay: dep2Delay,
              numStops: alight2Idx - c.idx,
              intermediateStops: intermediate2,
              tripId: c.tripId,
            },
          ],
          transferWalks: [transferWalk],
          departure: fl.departure,
          arrival: arrival2,
          duration: arrival2 - fl.departure,
          transitDuration,
          walkDuration: transferWalk?.duration ?? 0,
        };

        const key = `${route1.id}|${route2.id}|${alightStop1.name}`;
        const cur = bestByKey.get(key);
        if (!cur || opt.arrival < cur.arrival) bestByKey.set(key, opt);
        break; // one onward trip per (firstLeg, transferStopId) is enough
      }
    }

    if (bestByKey.size >= limit * 4) break;
  }

  for (const o of bestByKey.values()) options.push(o);
  options.sort((a, b) => a.arrival - b.arrival);
  return options.slice(0, limit);
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
  /** Earliest desired departure time (unix seconds). Defaults to "now". */
  atTime?: number,
): Promise<ItineraryOption[]> {
  const g = await getGtfs();
  const fromCandidates = resolveCandidates(g, from);
  const toCandidates = resolveCandidates(g, to);
  if (!fromCandidates.length || !toCandidates.length) return [];

  const fromByStop = new Map<string, Candidate>();
  for (const c of fromCandidates) for (const id of c.ids) fromByStop.set(id, c);
  const toByStop = new Map<string, Candidate>();
  for (const c of toCandidates) for (const id of c.ids) toByStop.set(id, c);

  const fromIds = [...fromByStop.keys()];
  const toIds = [...toByStop.keys()];

  const baseTime = atTime ?? Math.floor(Date.now() / 1000);
  const minWalkBefore = Math.min(...fromCandidates.map((c) => c.duration));
  const startAt = baseTime + Math.floor(minWalkBefore);

  // Direct (single-leg) options.
  const directRaw = await planItinerary(fromIds, toIds, startAt, limit * 8);
  // Transfer (two-leg) options.
  const transferRaw = await planTransferItinerary(
    fromIds,
    toIds,
    startAt,
    limit * 2,
  );

  const enrich = (opt: ItineraryOption): ItineraryOption | null => {
    const firstLeg = opt.legs[0];
    const lastLeg = opt.legs[opt.legs.length - 1];
    const startCand = fromByStop.get(firstLeg.fromStopId);
    const endCand = toByStop.get(lastLeg.toStopId);
    if (!startCand || !endCand) return null;
    if (firstLeg.departure - baseTime < startCand.duration - 30) return null;

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
      ? firstLeg.departure - walkBefore.duration
      : firstLeg.departure;
    const arrival = walkAfter
      ? lastLeg.arrival + walkAfter.duration
      : lastLeg.arrival;

    const transferWalkDuration =
      opt.transferWalks?.reduce((s, w) => s + (w?.duration ?? 0), 0) ?? 0;
    const walkDuration =
      (walkBefore?.duration ?? 0) +
      transferWalkDuration +
      (walkAfter?.duration ?? 0);

    return {
      ...opt,
      walkBefore,
      walkAfter,
      departure,
      arrival,
      duration: arrival - departure,
      walkDuration,
    };
  };

  const enriched: ItineraryOption[] = [];
  for (const o of directRaw) {
    const e = enrich(o);
    if (e) enriched.push(e);
  }
  for (const o of transferRaw) {
    const e = enrich(o);
    if (e) enriched.push(e);
  }

  // Prefer the option that gets the user to destination earliest (= shortest
  // total trip time including final walk). Use total walk as tiebreaker so
  // that, between two trips arriving at the same time, we keep the one with
  // the shorter walk.
  const totalWalk = (o: ItineraryOption): number =>
    (o.walkBefore?.distance ?? 0) + (o.walkAfter?.distance ?? 0);

  enriched.sort((a, b) => {
    if (a.arrival !== b.arrival) return a.arrival - b.arrival;
    return totalWalk(a) - totalWalk(b);
  });

  // Dedupe by route signature: direct legs use (route, headsign);
  // transfer legs use (route1, route2, transferName) so different connection
  // points still surface.
  const seen = new Map<string, ItineraryOption>();
  for (const opt of enriched) {
    let key: string;
    if (opt.legs.length === 1) {
      key = `${opt.legs[0].routeId}|${opt.legs[0].headsign}`;
    } else {
      key = opt.legs
        .map((l) => `${l.routeId}|${l.headsign}`)
        .join("→");
    }
    if (!seen.has(key)) seen.set(key, opt);
  }

  // Refine the walking legs of the surviving options against the real OSM
  // pedestrian graph (OSRM foot profile). This makes our distances and
  // durations match Google Maps closely instead of relying on the great-circle
  // heuristic used during candidate selection.
  const finalists = [...seen.values()];
  await Promise.all(finalists.map((opt) => refineWalks(g, opt, from, to)));

  // Re-sort after walk refinement: arrival/duration may have shifted.
  return finalists.sort((a, b) => a.arrival - b.arrival).slice(0, limit);
}

/**
 * Replace the walking legs of one itinerary option with values from a real
 * pedestrian routing engine. Mutates the option in place.
 */
async function refineWalks(
  g: GtfsData,
  opt: ItineraryOption,
  from: Endpoint,
  to: Endpoint,
): Promise<void> {
  const firstLeg = opt.legs[0];
  const lastLeg = opt.legs[opt.legs.length - 1];

  const tasks: Promise<void>[] = [];

  // walkBefore: address → boarding stop
  if (opt.walkBefore && from.kind === "address") {
    const stop = g.stops.get(firstLeg.fromStopId);
    if (stop) {
      tasks.push(
        walkingRoute(
          { lat: from.lat, lng: from.lng },
          { lat: stop.lat, lng: stop.lng },
        ).then((r) => {
          opt.walkBefore!.distance = r.distance;
          opt.walkBefore!.duration = r.duration;
        }),
      );
    }
  }

  // walkAfter: alighting stop → destination address
  if (opt.walkAfter && to.kind === "address") {
    const stop = g.stops.get(lastLeg.toStopId);
    if (stop) {
      tasks.push(
        walkingRoute(
          { lat: stop.lat, lng: stop.lng },
          { lat: to.lat, lng: to.lng },
        ).then((r) => {
          opt.walkAfter!.distance = r.distance;
          opt.walkAfter!.duration = r.duration;
        }),
      );
    }
  }

  // Transfer walks between consecutive bus legs.
  if (opt.transferWalks?.length) {
    for (let i = 0; i < opt.transferWalks.length; i++) {
      const tw = opt.transferWalks[i];
      if (!tw) continue;
      const alight = g.stops.get(opt.legs[i].toStopId);
      const board = g.stops.get(opt.legs[i + 1].fromStopId);
      if (!alight || !board) continue;
      tasks.push(
        walkingRoute(
          { lat: alight.lat, lng: alight.lng },
          { lat: board.lat, lng: board.lng },
        ).then((r) => {
          tw.distance = r.distance;
          tw.duration = r.duration;
        }),
      );
    }
  }

  await Promise.all(tasks);

  // Recompute aggregates from the (possibly updated) walks.
  const dep = opt.walkBefore
    ? firstLeg.departure - opt.walkBefore.duration
    : firstLeg.departure;
  const arr = opt.walkAfter
    ? lastLeg.arrival + opt.walkAfter.duration
    : lastLeg.arrival;
  const transferWalkDuration =
    opt.transferWalks?.reduce((s, w) => s + (w?.duration ?? 0), 0) ?? 0;
  opt.departure = dep;
  opt.arrival = arr;
  opt.duration = arr - dep;
  opt.walkDuration =
    (opt.walkBefore?.duration ?? 0) +
    transferWalkDuration +
    (opt.walkAfter?.duration ?? 0);
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
