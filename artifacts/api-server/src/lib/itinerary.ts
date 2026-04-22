import { getGtfs, type GtfsData } from "./gtfs";
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

export interface ItineraryOption {
  legs: ItineraryLeg[];
  departure: number;
  arrival: number;
  duration: number;
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

    let fromIdx = -1;
    let toIdx = -1;
    for (let i = 0; i < sched.length; i++) {
      if (fromIdx < 0 && fromSet.has(sched[i].stopId)) fromIdx = i;
      else if (fromIdx >= 0 && toSet.has(sched[i].stopId)) {
        toIdx = i;
        break;
      }
    }
    if (fromIdx < 0 || toIdx < 0 || toIdx <= fromIdx) continue;
    if (sched[fromIdx].departure < nowSec - 60) continue;

    const route = gtfs.routes.get(trip.routeId);
    if (!route) continue;

    const rt = rtByTrip.get(tripId);
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

  options.sort((a, b) => a.departure - b.departure);

  // Dedupe: keep at most 2 per route+headsign combination
  const seen = new Map<string, number>();
  const filtered: ItineraryOption[] = [];
  for (const opt of options) {
    const leg = opt.legs[0];
    const key = `${leg.routeId}|${leg.headsign}`;
    const c = seen.get(key) ?? 0;
    if (c < 2) {
      filtered.push(opt);
      seen.set(key, c + 1);
    }
    if (filtered.length >= limit) break;
  }
  return filtered;
}
