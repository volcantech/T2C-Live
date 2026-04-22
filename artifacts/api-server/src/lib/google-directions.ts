import { logger } from "./logger";
import type { ItineraryOption, WalkingLeg } from "./itinerary";

/**
 * Wrapper around the Google Maps Directions API for transit itineraries
 * inside Clermont-Ferrand. Returns options shaped exactly like
 * `planItineraryEndpoints` so the frontend renders them with the same
 * timeline component.
 *
 * Requires GOOGLE_MAPS_API_KEY in the environment with the Directions API
 * enabled in the Google Cloud project.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

interface GoogleStep {
  travel_mode: "WALKING" | "TRANSIT";
  duration?: { value: number; text: string };
  distance?: { value: number; text: string };
  start_location?: { lat: number; lng: number };
  end_location?: { lat: number; lng: number };
  html_instructions?: string;
  transit_details?: {
    departure_stop?: { name: string; location?: LatLng };
    arrival_stop?: { name: string; location?: LatLng };
    departure_time?: { value: number };
    arrival_time?: { value: number };
    headsign?: string;
    line?: {
      short_name?: string;
      name?: string;
      color?: string;
      text_color?: string;
      vehicle?: { type?: string; name?: string };
      agencies?: Array<{ name?: string }>;
    };
    num_stops?: number;
  };
}

interface GoogleLeg {
  duration?: { value: number };
  arrival_time?: { value: number };
  departure_time?: { value: number };
  steps: GoogleStep[];
}

interface GoogleDirectionsResponse {
  status: string;
  error_message?: string;
  routes: Array<{ legs: GoogleLeg[] }>;
}

const TIMEOUT_MS = 8000;

function isTransitVehicle(t?: string): boolean {
  if (!t) return true;
  // Google vehicle types include BUS, TRAM, SUBWAY, RAIL, …
  return true;
}

/**
 * Build a single ItineraryOption out of one Google route leg.
 */
function legToOption(
  gleg: GoogleLeg,
  fromCoord: LatLng,
  toCoord: LatLng,
): ItineraryOption | null {
  const legs: ItineraryOption["legs"] = [];
  const transferWalks: (WalkingLeg | null)[] = [];
  let walkBefore: WalkingLeg | undefined;
  let walkAfter: WalkingLeg | undefined;

  // Group consecutive walking steps together (Google sometimes emits multiple
  // back-to-back walking steps for waypoint guidance).
  const groups: Array<
    | { kind: "walk"; distance: number; duration: number; from: LatLng; to: LatLng }
    | { kind: "transit"; step: GoogleStep }
  > = [];

  let walkAcc: { distance: number; duration: number; from: LatLng | null; to: LatLng | null } | null = null;

  const flushWalk = () => {
    if (walkAcc && walkAcc.from && walkAcc.to) {
      groups.push({
        kind: "walk",
        distance: Math.round(walkAcc.distance),
        duration: Math.round(walkAcc.duration),
        from: walkAcc.from,
        to: walkAcc.to,
      });
    }
    walkAcc = null;
  };

  for (const step of gleg.steps) {
    if (step.travel_mode === "WALKING") {
      const dist = step.distance?.value ?? 0;
      const dur = step.duration?.value ?? 0;
      if (!walkAcc) {
        walkAcc = {
          distance: 0,
          duration: 0,
          from: step.start_location ?? null,
          to: null,
        };
      }
      walkAcc.distance += dist;
      walkAcc.duration += dur;
      walkAcc.to = step.end_location ?? walkAcc.to;
    } else if (step.travel_mode === "TRANSIT") {
      flushWalk();
      groups.push({ kind: "transit", step });
    }
  }
  flushWalk();

  // Now translate groups into the ItineraryOption structure.
  let i = 0;
  while (i < groups.length) {
    const g = groups[i];
    if (g.kind === "walk") {
      // Walking before any transit → walkBefore. Walking after the last transit
      // → walkAfter. Walking between two transits → transferWalk.
      const prevTransit = legs.length > 0;
      const nextIsTransit = groups
        .slice(i + 1)
        .some((x) => x.kind === "transit");
      if (!prevTransit) {
        walkBefore = {
          kind: "start",
          stopId: "google-walk-before",
          stopName: "Départ",
          distance: g.distance,
          duration: g.duration,
        };
      } else if (nextIsTransit) {
        transferWalks.push({
          kind: "transfer",
          stopId: "google-walk-transfer",
          stopName: "Correspondance",
          distance: g.distance,
          duration: g.duration,
        });
      } else {
        walkAfter = {
          kind: "end",
          stopId: "google-walk-after",
          stopName: "Arrivée",
          distance: g.distance,
          duration: g.duration,
        };
      }
      i++;
      continue;
    }

    // transit
    const td = g.step.transit_details;
    if (!td || !isTransitVehicle(td.line?.vehicle?.type)) {
      // Skip unknown
      i++;
      continue;
    }
    const dep = td.departure_time?.value ?? 0;
    const arr = td.arrival_time?.value ?? 0;
    const fromName = td.departure_stop?.name ?? "?";
    const toName = td.arrival_stop?.name ?? "?";
    const shortName =
      td.line?.short_name ?? td.line?.name ?? "?";
    const headsign = td.headsign ?? td.line?.name ?? "";
    const color = td.line?.color ?? "#0066cc";
    const textColor = td.line?.text_color ?? "#ffffff";
    const numStops = td.num_stops ?? 1;

    // If the previous group was a transit (no walk between), insert a null
    // transfer walk so transferWalks aligns with legs.length-1.
    if (legs.length > 0 && groups[i - 1]?.kind === "transit") {
      transferWalks.push(null);
    }

    legs.push({
      routeId: shortName,
      routeShortName: shortName,
      routeColor: color,
      routeTextColor: textColor,
      headsign,
      fromStopId: `google:${fromName}`,
      fromStopName: fromName,
      toStopId: `google:${toName}`,
      toStopName: toName,
      departure: dep,
      arrival: arr,
      delay: 0,
      numStops,
      intermediateStops: [],
      tripId: `google:${shortName}:${dep}`,
    });
    i++;
  }

  // If Google returned only walking (no transit), still surface the option as
  // a "walk-only" itinerary so the user sees what Google would show.
  if (legs.length === 0) {
    const totalWalkDist = (walkBefore?.distance ?? 0);
    const totalWalkDur = (walkBefore?.duration ?? 0);
    if (totalWalkDist === 0) return null;
    const departure = gleg.departure_time?.value ?? Math.floor(Date.now() / 1000);
    const arrival = departure + totalWalkDur;
    return {
      legs: [],
      walkBefore: {
        kind: "start",
        stopId: "google-walk-only",
        stopName: "Trajet à pied",
        distance: totalWalkDist,
        duration: totalWalkDur,
      },
      departure,
      arrival,
      duration: totalWalkDur,
      transitDuration: 0,
      walkDuration: totalWalkDur,
    };
  }

  // Use Google's authoritative timing.
  const departure = gleg.departure_time?.value ?? legs[0].departure;
  const arrival = gleg.arrival_time?.value ?? legs[legs.length - 1].arrival;
  const duration =
    gleg.duration?.value ?? Math.max(0, arrival - departure);

  // Adjust walkBefore so its duration places the user at the boarding stop
  // exactly when the first transit step departs (Google already does this
  // implicitly).
  if (walkBefore) {
    walkBefore.stopName = legs[0].fromStopName;
    walkBefore.stopId = legs[0].fromStopId;
  }
  if (walkAfter) {
    walkAfter.stopName = legs[legs.length - 1].toStopName;
    walkAfter.stopId = legs[legs.length - 1].toStopId;
  }
  // Align transferWalks length with legs.length - 1.
  while (transferWalks.length < legs.length - 1) transferWalks.push(null);
  transferWalks.length = legs.length - 1;

  const transitDuration = legs.reduce(
    (s, l) => s + (l.arrival - l.departure),
    0,
  );
  const walkDuration =
    (walkBefore?.duration ?? 0) +
    transferWalks.reduce((s, w) => s + (w?.duration ?? 0), 0) +
    (walkAfter?.duration ?? 0);

  void fromCoord;
  void toCoord;

  return {
    legs,
    walkBefore,
    walkAfter,
    transferWalks: transferWalks.length ? transferWalks : undefined,
    departure,
    arrival,
    duration,
    transitDuration,
    walkDuration,
  };
}

/**
 * Call Google Directions API for transit. Returns ItineraryOption[] sorted by
 * arrival time.
 */
export async function googleDirectionsTransit(
  from: LatLng,
  to: LatLng,
  /** Earliest desired departure time (unix seconds). Defaults to now. */
  atTime?: number,
  limit = 4,
): Promise<ItineraryOption[]> {
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is not set");
  }
  const departureTime = atTime ?? Math.floor(Date.now() / 1000);

  const params = new URLSearchParams({
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    mode: "transit",
    transit_mode: "bus|tram|rail|subway",
    departure_time: String(departureTime),
    alternatives: "true",
    language: "fr",
    region: "fr",
    key: apiKey,
  });
  const url = `https://maps.googleapis.com/maps/api/directions/json?${params}`;

  let data: GoogleDirectionsResponse;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    data = (await res.json()) as GoogleDirectionsResponse;
  } catch (e) {
    logger.warn({ err: String(e) }, "Google Directions request failed");
    throw new Error("Échec de l'appel à Google Directions");
  }

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    logger.warn(
      { status: data.status, error: data.error_message },
      "Google Directions non-OK",
    );
    throw new Error(
      data.error_message
        ? `Google Directions: ${data.status} - ${data.error_message}`
        : `Google Directions: ${data.status}`,
    );
  }

  const options: ItineraryOption[] = [];
  for (const route of data.routes ?? []) {
    for (const gleg of route.legs ?? []) {
      const opt = legToOption(gleg, from, to);
      if (opt) options.push(opt);
    }
  }
  options.sort((a, b) => a.arrival - b.arrival);
  return options.slice(0, limit);
}
