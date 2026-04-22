const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface Route {
  id: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
  type: number;
}
export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  wheelchair?: number;
  parentId?: string;
}
export interface NearbyStop extends Stop {
  distance: number;
}
export interface StopInfo {
  stop: Stop & { locationType: number };
  routes: { id: string; shortName: string; longName: string; color: string; textColor: string }[];
}
export interface Vehicle {
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
export interface Departure {
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
export interface RouteShape {
  route: Route;
  shapes: { id: string; points: [number, number][] }[];
  stops: Stop[];
}
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
  kind: "start" | "end" | "transfer";
  stopId: string;
  stopName: string;
  distance: number;
  duration: number;
}
export interface ItineraryOption {
  legs: ItineraryLeg[];
  walkBefore?: WalkingLeg;
  walkAfter?: WalkingLeg;
  transferWalks?: (WalkingLeg | null)[];
  departure: number;
  arrival: number;
  duration: number;
  transitDuration: number;
  walkDuration: number;
}
export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
  type?: string;
  city?: string;
}
export interface ServiceAlert {
  id: string;
  cause: string;
  effect: string;
  header: string;
  description: string;
  url?: string;
  start?: number;
  end?: number;
  severity: "info" | "warning" | "severe";
  routes: { id: string; shortName: string; color: string; textColor: string }[];
  stops: { id: string; name: string }[];
}

export const api = {
  static: () =>
    get<{ routes: Route[]; stops: Stop[]; loadedAt: number }>("/gtfs/static"),
  routeShape: (id: string) =>
    get<RouteShape>(`/gtfs/route/${encodeURIComponent(id)}/shape`),
  vehicles: () => get<{ vehicles: Vehicle[]; ts: number }>("/gtfs/vehicles"),
  departures: (stopId: string, fullDay = false) =>
    get<{ departures: Departure[] }>(
      `/gtfs/stop/${encodeURIComponent(stopId)}/departures${fullDay ? "?all=1&limit=500" : ""}`,
    ),
  stopInfo: (stopId: string) =>
    get<StopInfo>(`/gtfs/stop/${encodeURIComponent(stopId)}`),
  nearbyStops: (lat: number, lng: number) =>
    get<{ stops: NearbyStop[] }>(
      `/gtfs/nearby-stops?lat=${lat}&lng=${lng}&limit=8`,
    ),
  itinerary: (from: string, to: string, atUnixSeconds?: number) =>
    get<{ options: ItineraryOption[]; provider?: "google" | "local" }>(
      `/gtfs/itinerary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${atUnixSeconds ? `&at=${atUnixSeconds}` : ""}`,
    ),
  geocode: (q: string) =>
    get<{ results: GeocodeResult[] }>(`/gtfs/geocode?q=${encodeURIComponent(q)}`),
  alerts: () => get<{ alerts: ServiceAlert[]; ts: number }>("/gtfs/alerts"),
};
