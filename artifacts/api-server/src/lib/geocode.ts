import { logger } from "./logger";

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
  type?: string;
  city?: string;
}

const CACHE = new Map<string, { ts: number; results: GeocodeResult[] }>();
const TTL_MS = 60 * 60 * 1000;

const USER_AGENT =
  process.env["GEOCODE_USER_AGENT"] ??
  "t2c-live-tracker/1.0 (https://github.com)";

const VIEWBOX_LON_MIN = 2.7;
const VIEWBOX_LON_MAX = 3.5;
const VIEWBOX_LAT_MIN = 45.5;
const VIEWBOX_LAT_MAX = 46.0;

export async function geocode(query: string, limit = 6): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const key = `${q.toLowerCase()}|${limit}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.results;

  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    addressdetails: "1",
    limit: String(limit),
    countrycodes: "fr",
    "accept-language": "fr",
    viewbox: `${VIEWBOX_LON_MIN},${VIEWBOX_LAT_MAX},${VIEWBOX_LON_MAX},${VIEWBOX_LAT_MIN}`,
    bounded: "1",
  });

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Nominatim non-OK");
      return [];
    }
    const data = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
      name?: string;
      type?: string;
      class?: string;
      address?: Record<string, string>;
    }>;
    const mapped: GeocodeResult[] = data
      .map((r) => {
        const lat = Number(r.lat);
        const lng = Number(r.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const a = r.address ?? {};
        const city =
          a["city"] ??
          a["town"] ??
          a["village"] ??
          a["municipality"] ??
          a["suburb"];
        const postcode = a["postcode"];
        const cityWithPostcode = [postcode, city].filter(Boolean).join(" ");
        const street = a["road"] ?? a["pedestrian"] ?? a["footway"];
        const houseNumber = a["house_number"];

        // For named places (schools, shops, parks, hospitals, stations…),
        // prefer the proper name as the primary label so a query like
        // "École Simone Godard" returns a recognizable result.
        const poiName =
          r.name ||
          (r.type ? a[r.type] : undefined) ||
          (r.class ? a[r.class] : undefined);
        const norm = (s: string | undefined) =>
          (s ?? "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
        // Drop the POI name when it just repeats the street (Nominatim does
        // this for residential alleys, e.g. name="Allée Claude Bois" with the
        // same string in `road`). Same for highway/place classes.
        const poiMatchesStreet =
          poiName && street && norm(poiName) === norm(street);
        const isPoi =
          Boolean(poiName) &&
          r.class !== "highway" &&
          r.class !== "place" &&
          !poiMatchesStreet;

        const street_part = houseNumber && street
          ? `${houseNumber} ${street}`
          : street;

        let label: string;
        if (isPoi) {
          // "École Simone Godard, Allée Antony Bardin, 63112 Blanzat"
          label = [poiName, street_part, cityWithPostcode]
            .filter(Boolean)
            .join(", ");
        } else {
          const head = [street_part, cityWithPostcode].filter(Boolean).join(", ");
          label = head || r.display_name.split(",").slice(0, 3).join(",");
        }
        return { lat, lng, label, type: r.type, city: cityWithPostcode || city };
      })
      .filter((x): x is GeocodeResult => Boolean(x));

    // Dedupe: same label, OR same (lat,lng) rounded to ~10 m, collapses
    // duplicates Nominatim sometimes returns for one POI with multiple geometries.
    const seen = new Set<string>();
    const results: GeocodeResult[] = [];
    for (const r of mapped) {
      const labelKey = r.label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const coordKey = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
      const key = `${labelKey}|${coordKey}`;
      if (seen.has(labelKey) || seen.has(coordKey) || seen.has(key)) continue;
      seen.add(labelKey);
      seen.add(coordKey);
      results.push(r);
    }

    CACHE.set(key, { ts: Date.now(), results });
    return results;
  } catch (e) {
    logger.warn({ err: e }, "Geocode failed");
    return [];
  }
}
