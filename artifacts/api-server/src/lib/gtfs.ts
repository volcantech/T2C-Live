import AdmZip from "adm-zip";
import { logger } from "./logger";

const GTFS_URL =
  process.env["T2C_GTFS_URL"] ??
  "https://www.data.gouv.fr/api/1/datasets/r/4e237a58-cd14-4746-b729-1337a40a8a7b";

const REFRESH_MS = 1000 * 60 * 60 * 12;

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  wheelchair?: number;
  parentId?: string;
  locationType: number;
}
export interface Route {
  id: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
  type: number;
}
export interface Trip {
  id: string;
  routeId: string;
  serviceId: string;
  shapeId: string;
  headsign: string;
  directionId: number;
}
export interface StopTime {
  tripId: string;
  arrival: number;
  departure: number;
  stopId: string;
  stopSeq: number;
}
export interface ShapePoint {
  lat: number;
  lng: number;
  seq: number;
  dist: number;
}

export interface GtfsData {
  loadedAt: number;
  stops: Map<string, Stop>;
  routes: Map<string, Route>;
  trips: Map<string, Trip>;
  stopTimes: Map<string, StopTime[]>;
  shapes: Map<string, ShapePoint[]>;
  routeShapes: Map<string, Set<string>>;
  routeStops: Map<string, Set<string>>;
  serviceDates: Map<string, Set<string>>;
}

let cached: GtfsData | null = null;
let loading: Promise<GtfsData> | null = null;

function parseCSV(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuote = false;
      } else field += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else if (c === "\r") {
        // skip
      } else field += c;
    }
  }
  if (field.length || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  if (!rows.length) return [];
  const headers = rows[0];
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0] === "") continue;
    const o: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) o[headers[j]] = r[j] ?? "";
    out.push(o);
  }
  return out;
}

export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function toSec(s: string): number {
  if (!s) return 0;
  const p = s.split(":");
  return Number(p[0]) * 3600 + Number(p[1]) * 60 + Number(p[2] ?? 0);
}

async function loadGtfs(): Promise<GtfsData> {
  logger.info({ url: GTFS_URL }, "Downloading GTFS");
  const res = await fetch(GTFS_URL);
  if (!res.ok) throw new Error(`GTFS fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);
  const files = new Map<string, string>();
  for (const e of zip.getEntries()) {
    if (!e.isDirectory) {
      files.set(e.entryName.toLowerCase(), e.getData().toString("utf8"));
    }
  }
  const get = (name: string): Record<string, string>[] => {
    for (const k of files.keys()) {
      if (k.endsWith("/" + name) || k === name) return parseCSV(files.get(k)!);
    }
    return [];
  };
  const stopsCsv = get("stops.txt");
  const routesCsv = get("routes.txt");
  const tripsCsv = get("trips.txt");
  const stopTimesCsv = get("stop_times.txt");
  const shapesCsv = get("shapes.txt");
  const calendarCsv = get("calendar.txt");
  const calendarDatesCsv = get("calendar_dates.txt");

  const stops = new Map<string, Stop>();
  const rawStops: { id: string; name: string; lat: number; lng: number; locationType: number; wheelchair: number; parentId: string }[] = [];
  for (const r of stopsCsv) {
    const lat = Number(r["stop_lat"]);
    const lng = Number(r["stop_lon"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    rawStops.push({
      id: r["stop_id"],
      name: r["stop_name"] ?? "",
      lat,
      lng,
      locationType: Number(r["location_type"] ?? 0),
      wheelchair: Number(r["wheelchair_boarding"] ?? 0),
      parentId: r["parent_station"] ?? "",
    });
  }
  // Build parent name index (parent stops carry the "city - place" name)
  const parentNames = new Map<string, string>();
  for (const s of rawStops) {
    if (s.locationType === 1) parentNames.set(s.id, s.name);
  }
  for (const s of rawStops) {
    let displayName = s.name;
    let city: string | undefined;
    const parentName = s.parentId ? parentNames.get(s.parentId) : undefined;
    // Parent names are typically "City Place" or "City - Place"; promote them if the child name is missing the city
    const candidate = parentName && parentName.length > s.name.length ? parentName : s.name;
    if (candidate) {
      const dashIdx = candidate.indexOf(" - ");
      if (dashIdx > 0 && dashIdx < candidate.length - 3) {
        city = candidate.slice(0, dashIdx).trim();
        displayName = candidate.slice(dashIdx + 3).trim();
      } else {
        // Heuristic: if parent name = "Word Word…" and child name is "Word…", treat first word as city
        if (parentName && parentName !== s.name && parentName.endsWith(s.name)) {
          city = parentName.slice(0, parentName.length - s.name.length).trim();
        }
        displayName = s.name;
      }
    }
    stops.set(s.id, {
      id: s.id,
      name: displayName || s.name,
      lat: s.lat,
      lng: s.lng,
      city: city || undefined,
      wheelchair: s.wheelchair,
      parentId: s.parentId || undefined,
      locationType: s.locationType,
    });
  }
  const routes = new Map<string, Route>();
  for (const r of routesCsv) {
    routes.set(r["route_id"], {
      id: r["route_id"],
      shortName: r["route_short_name"] || "",
      longName: r["route_long_name"] || "",
      color: r["route_color"] ? "#" + r["route_color"] : "#0d6efd",
      textColor: r["route_text_color"] ? "#" + r["route_text_color"] : "#ffffff",
      type: Number(r["route_type"] ?? 3),
    });
  }
  const trips = new Map<string, Trip>();
  const routeShapes = new Map<string, Set<string>>();
  for (const r of tripsCsv) {
    const t: Trip = {
      id: r["trip_id"],
      routeId: r["route_id"],
      serviceId: r["service_id"],
      shapeId: r["shape_id"] || "",
      headsign: r["trip_headsign"] || "",
      directionId: Number(r["direction_id"] ?? 0),
    };
    trips.set(t.id, t);
    if (t.shapeId) {
      let s = routeShapes.get(t.routeId);
      if (!s) {
        s = new Set();
        routeShapes.set(t.routeId, s);
      }
      s.add(t.shapeId);
    }
  }
  const stopTimes = new Map<string, StopTime[]>();
  const routeStops = new Map<string, Set<string>>();
  for (const r of stopTimesCsv) {
    const tid = r["trip_id"];
    const st: StopTime = {
      tripId: tid,
      arrival: toSec(r["arrival_time"]),
      departure: toSec(r["departure_time"]),
      stopId: r["stop_id"],
      stopSeq: Number(r["stop_sequence"]),
    };
    let arr = stopTimes.get(tid);
    if (!arr) {
      arr = [];
      stopTimes.set(tid, arr);
    }
    arr.push(st);
    const trip = trips.get(tid);
    if (trip) {
      let rs = routeStops.get(trip.routeId);
      if (!rs) {
        rs = new Set();
        routeStops.set(trip.routeId, rs);
      }
      rs.add(st.stopId);
    }
  }
  for (const arr of stopTimes.values()) arr.sort((a, b) => a.stopSeq - b.stopSeq);

  const shapes = new Map<string, ShapePoint[]>();
  for (const r of shapesCsv) {
    const id = r["shape_id"];
    const lat = Number(r["shape_pt_lat"]);
    const lng = Number(r["shape_pt_lon"]);
    const seq = Number(r["shape_pt_sequence"]);
    const dist = Number(r["shape_dist_traveled"] ?? 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    let arr = shapes.get(id);
    if (!arr) {
      arr = [];
      shapes.set(id, arr);
    }
    arr.push({ lat, lng, seq, dist });
  }
  for (const arr of shapes.values()) {
    arr.sort((a, b) => a.seq - b.seq);
    const last = arr[arr.length - 1];
    if (!last || last.dist === 0) {
      let acc = 0;
      arr[0].dist = 0;
      for (let i = 1; i < arr.length; i++) {
        acc += haversine(arr[i - 1], arr[i]);
        arr[i].dist = acc;
      }
    }
  }

  const serviceDates = new Map<string, Set<string>>();
  for (const r of calendarCsv) {
    const sid = r["service_id"];
    const start = r["start_date"];
    const end = r["end_date"];
    const days = [
      r["sunday"],
      r["monday"],
      r["tuesday"],
      r["wednesday"],
      r["thursday"],
      r["friday"],
      r["saturday"],
    ].map(Number);
    if (!start || !end) continue;
    const set = new Set<string>();
    const startDate = new Date(
      `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T00:00:00Z`,
    );
    const endDate = new Date(
      `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}T00:00:00Z`,
    );
    for (
      let d = new Date(startDate);
      d <= endDate;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      if (days[d.getUTCDay()]) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        set.add(`${y}${m}${dd}`);
      }
    }
    serviceDates.set(sid, set);
  }
  for (const r of calendarDatesCsv) {
    const sid = r["service_id"];
    const date = r["date"];
    const exType = Number(r["exception_type"]);
    let set = serviceDates.get(sid);
    if (!set) {
      set = new Set();
      serviceDates.set(sid, set);
    }
    if (exType === 1) set.add(date);
    else if (exType === 2) set.delete(date);
  }

  logger.info(
    {
      stops: stops.size,
      routes: routes.size,
      trips: trips.size,
      shapes: shapes.size,
    },
    "GTFS loaded",
  );
  return {
    loadedAt: Date.now(),
    stops,
    routes,
    trips,
    stopTimes,
    shapes,
    routeShapes,
    routeStops,
    serviceDates,
  };
}

export async function getGtfs(): Promise<GtfsData> {
  if (cached && Date.now() - cached.loadedAt < REFRESH_MS) return cached;
  if (loading) return loading;
  loading = loadGtfs()
    .then((d) => {
      cached = d;
      loading = null;
      return d;
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
