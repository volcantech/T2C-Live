import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { getGtfs, type ShapePoint } from "./gtfs";
import { logger } from "./logger";

const RT_URL =
  process.env["T2C_GTFS_RT_TRIP_UPDATES_URL"] ??
  "https://proxy.transport.data.gouv.fr/resource/t2c-clermont-gtfs-rt-trip-update";

interface TripDelay {
  tripId: string;
  startDate?: string;
  stopUpdates: Map<number, { delay: number; stopId?: string }>;
}

let lastFetch = 0;
let cachedFeed: TripDelay[] = [];
let inflight: Promise<TripDelay[]> | null = null;

async function fetchFeed(): Promise<TripDelay[]> {
  const res = await fetch(RT_URL);
  if (!res.ok) throw new Error(`GTFS-RT fetch ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const msg = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
  const out: TripDelay[] = [];
  for (const ent of msg.entity) {
    const tu = ent.tripUpdate;
    if (!tu || !tu.trip || !tu.trip.tripId) continue;
    const stopUpdates = new Map<
      number,
      { delay: number; stopId?: string }
    >();
    for (const stu of tu.stopTimeUpdate ?? []) {
      const seq = stu.stopSequence;
      if (seq == null) continue;
      const delay = stu.departure?.delay ?? stu.arrival?.delay ?? 0;
      stopUpdates.set(seq, { delay, stopId: stu.stopId ?? undefined });
    }
    out.push({
      tripId: tu.trip.tripId,
      startDate: tu.trip.startDate ?? undefined,
      stopUpdates,
    });
  }
  return out;
}

export async function getRealtimeFeed(): Promise<TripDelay[]> {
  if (Date.now() - lastFetch < 5000 && cachedFeed.length) return cachedFeed;
  if (inflight) return inflight;
  inflight = fetchFeed()
    .then((f) => {
      cachedFeed = f;
      lastFetch = Date.now();
      inflight = null;
      return f;
    })
    .catch((e) => {
      inflight = null;
      logger.warn({ err: String(e) }, "GTFS-RT fetch failed");
      return cachedFeed;
    });
  return inflight;
}

function bearingOf(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function pointAlongShape(
  shape: ShapePoint[],
  targetDist: number,
): { lat: number; lng: number; bearing: number } {
  if (!shape.length) return { lat: 0, lng: 0, bearing: 0 };
  if (targetDist <= 0) {
    const a = shape[0];
    const b = shape[Math.min(1, shape.length - 1)];
    return { lat: a.lat, lng: a.lng, bearing: bearingOf(a, b) };
  }
  const total = shape[shape.length - 1].dist;
  if (targetDist >= total) {
    const a = shape[shape.length - 2] ?? shape[0];
    const b = shape[shape.length - 1];
    return { lat: b.lat, lng: b.lng, bearing: bearingOf(a, b) };
  }
  let lo = 0;
  let hi = shape.length - 1;
  while (lo < hi - 1) {
    const m = (lo + hi) >> 1;
    if (shape[m].dist <= targetDist) lo = m;
    else hi = m;
  }
  const a = shape[lo];
  const b = shape[hi];
  const t = (targetDist - a.dist) / Math.max(1, b.dist - a.dist);
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    bearing: bearingOf(a, b),
  };
}

function findShapeDistForStop(
  shape: ShapePoint[],
  lat: number,
  lng: number,
  fromIndex = 0,
): { dist: number; index: number } {
  let best = 0;
  let bestD = Infinity;
  let bestIdx = 0;
  for (let i = fromIndex; i < shape.length; i++) {
    const p = shape[i];
    const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p.dist;
      bestIdx = i;
    }
  }
  return { dist: best, index: bestIdx };
}

export interface VehiclePosition {
  tripId: string;
  routeId: string;
  routeShortName: string;
  routeColor: string;
  routeTextColor: string;
  headsign: string;
  directionId: number;
  lat: number;
  lng: number;
  bearing: number;
  delay: number;
  prevStopId: string | null;
  nextStopId: string | null;
  nextStopName: string | null;
  nextStopTime: number | null;
}

function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${dd}`;
}

export async function computeVehiclePositions(): Promise<VehiclePosition[]> {
  const [gtfs, feed] = await Promise.all([getGtfs(), getRealtimeFeed()]);
  const now = new Date();
  const todayStr = dateStr(now);
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  const yesterdayStr = dateStr(yesterday);
  const nowSec =
    now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  const rtByTrip = new Map<string, TripDelay>();
  for (const f of feed) rtByTrip.set(f.tripId, f);

  const out: VehiclePosition[] = [];

  for (const [tripId, trip] of gtfs.trips) {
    const sched = gtfs.stopTimes.get(tripId);
    if (!sched || sched.length < 2) continue;
    const route = gtfs.routes.get(trip.routeId);
    if (!route) continue;
    const shape = gtfs.shapes.get(trip.shapeId);
    if (!shape || shape.length < 2) continue;
    const dates = gtfs.serviceDates.get(trip.serviceId);
    if (!dates) continue;

    const startSec = sched[0].departure;
    const endSec = sched[sched.length - 1].arrival;
    let baseSec = nowSec;
    let activeDate: string | null = null;
    if (
      dates.has(todayStr) &&
      nowSec >= startSec - 60 &&
      nowSec <= endSec + 60
    ) {
      activeDate = todayStr;
      baseSec = nowSec;
    } else if (dates.has(yesterdayStr)) {
      const adj = nowSec + 24 * 3600;
      if (adj >= startSec - 60 && adj <= endSec + 60) {
        activeDate = yesterdayStr;
        baseSec = adj;
      }
    }
    if (!activeDate) continue;

    const rt = rtByTrip.get(tripId);
    let delay = 0;
    if (rt) {
      let bestSeq = -1;
      for (const st of sched) {
        if (st.departure <= baseSec) bestSeq = st.stopSeq;
        else break;
      }
      if (bestSeq >= 0 && rt.stopUpdates.has(bestSeq)) {
        delay = rt.stopUpdates.get(bestSeq)!.delay;
      } else {
        for (const st of sched) {
          if (rt.stopUpdates.has(st.stopSeq)) {
            delay = rt.stopUpdates.get(st.stopSeq)!.delay;
            break;
          }
        }
      }
    }

    const adjSec = baseSec - delay;
    let prevIdx = -1;
    for (let i = 0; i < sched.length; i++) {
      if (sched[i].departure <= adjSec) prevIdx = i;
      else break;
    }
    if (prevIdx < 0) continue;
    if (prevIdx >= sched.length - 1) continue;

    const prev = sched[prevIdx];
    const next = sched[prevIdx + 1];
    const segDur = Math.max(1, next.arrival - prev.departure);
    const t = Math.min(1, Math.max(0, (adjSec - prev.departure) / segDur));

    const prevStop = gtfs.stops.get(prev.stopId);
    const nextStop = gtfs.stops.get(next.stopId);
    if (!prevStop || !nextStop) continue;
    const dPrev = findShapeDistForStop(shape, prevStop.lat, prevStop.lng);
    const dNext = findShapeDistForStop(
      shape,
      nextStop.lat,
      nextStop.lng,
      dPrev.index,
    );
    const targetDist = dPrev.dist + (dNext.dist - dPrev.dist) * t;
    const pos = pointAlongShape(shape, targetDist);

    const dayBase =
      new Date(
        `${activeDate.slice(0, 4)}-${activeDate.slice(4, 6)}-${activeDate.slice(
          6,
          8,
        )}T00:00:00`,
      ).getTime() / 1000;

    out.push({
      tripId,
      routeId: route.id,
      routeShortName: route.shortName,
      routeColor: route.color,
      routeTextColor: route.textColor,
      headsign: trip.headsign,
      directionId: trip.directionId,
      lat: pos.lat,
      lng: pos.lng,
      bearing: pos.bearing,
      delay,
      prevStopId: prev.stopId,
      nextStopId: next.stopId,
      nextStopName: nextStop.name,
      nextStopTime: dayBase + next.arrival + delay,
    });
  }
  return out;
}

export interface StopDeparture {
  tripId: string;
  routeId: string;
  routeShortName: string;
  routeColor: string;
  routeTextColor: string;
  headsign: string;
  scheduled: number;
  realtime: number;
  delay: number;
}

export async function getStopDepartures(
  stopId: string,
  limit = 15,
): Promise<StopDeparture[]> {
  const [gtfs, feed] = await Promise.all([getGtfs(), getRealtimeFeed()]);
  const rtByTrip = new Map<string, TripDelay>();
  for (const f of feed) rtByTrip.set(f.tripId, f);
  const now = new Date();
  const todayStr = dateStr(now);
  const nowSec =
    now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const dayBase =
    new Date(
      `${todayStr.slice(0, 4)}-${todayStr.slice(4, 6)}-${todayStr.slice(
        6,
        8,
      )}T00:00:00`,
    ).getTime() / 1000;
  const out: StopDeparture[] = [];
  for (const [tripId, sched] of gtfs.stopTimes) {
    const trip = gtfs.trips.get(tripId);
    if (!trip) continue;
    const dates = gtfs.serviceDates.get(trip.serviceId);
    if (!dates || !dates.has(todayStr)) continue;
    let st: { departure: number; stopSeq: number } | null = null;
    for (const s of sched) {
      if (s.stopId === stopId) {
        st = s;
        break;
      }
    }
    if (!st) continue;
    if (st.departure < nowSec - 60) continue;
    const route = gtfs.routes.get(trip.routeId);
    if (!route) continue;
    const rt = rtByTrip.get(tripId);
    let delay = 0;
    if (rt && rt.stopUpdates.has(st.stopSeq)) {
      delay = rt.stopUpdates.get(st.stopSeq)!.delay;
    }
    out.push({
      tripId,
      routeId: route.id,
      routeShortName: route.shortName,
      routeColor: route.color,
      routeTextColor: route.textColor,
      headsign: trip.headsign,
      scheduled: dayBase + st.departure,
      realtime: dayBase + st.departure + delay,
      delay,
    });
  }
  out.sort((a, b) => a.realtime - b.realtime);
  return out.slice(0, limit);
}
