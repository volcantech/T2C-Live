import { logger } from "./logger";
import { getGtfs } from "./gtfs";

// T2C does NOT publish a GTFS-RT Service Alerts feed. Their public website API
// (siv = "système d'information voyageur") is the authoritative source the
// official t2c.fr site uses for the "Infos trafic" page.
const URL_ALERTS =
  process.env["T2C_ALERTS_URL"] ?? "https://api.t2c.fr/siv/alerts";

export interface ServiceAlert {
  id: string;
  cause: string;
  effect: string;
  header: string;
  description: string;
  url?: string;
  routeIds: string[];
  stopIds: string[];
  start?: number;
  end?: number;
  severity: "info" | "warning" | "severe";
}

interface T2cAlert {
  id: string;
  type?: string;
  title?: string;
  text?: string;
  start_datetime?: string;
  end_datetime?: string;
  priority?: number;
  affected_routes?: string[];
  disruption_level?: string | null;
  forwarding?: string;
  url?: string;
}

let cache: { data: ServiceAlert[]; ts: number } | null = null;
let inflight: Promise<ServiceAlert[]> | null = null;

function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function severityOf(a: T2cAlert): "info" | "warning" | "severe" {
  const t = (a.type ?? "").toLowerCase();
  const lvl = (a.disruption_level ?? "").toLowerCase();
  if (lvl.includes("major") || t.includes("alerte")) return "severe";
  if (lvl.includes("normal") || t.includes("trafic")) return "warning";
  return "info";
}

function effectOf(a: T2cAlert): string {
  const t = (a.type ?? "").toLowerCase();
  if (t.includes("alerte")) return "Perturbation majeure";
  if (t.includes("trafic")) return "Information trafic";
  return a.type ?? "Information";
}

async function fetchAlerts(): Promise<ServiceAlert[]> {
  const res = await fetch(URL_ALERTS, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`alerts fetch ${res.status}`);
  const data = (await res.json()) as T2cAlert[] | { data: T2cAlert[] | null };
  const list: T2cAlert[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { data?: T2cAlert[] }).data)
      ? ((data as { data: T2cAlert[] }).data ?? [])
      : [];

  // Map T2C "affected_routes" (route short names like "A", "B", "10") to GTFS route ids
  const gtfs = await getGtfs();
  const shortNameToIds = new Map<string, string[]>();
  for (const r of gtfs.routes.values()) {
    const k = r.shortName.trim().toUpperCase();
    const arr = shortNameToIds.get(k) ?? [];
    arr.push(r.id);
    shortNameToIds.set(k, arr);
  }

  return list.map((a) => {
    const routeIds: string[] = [];
    for (const sn of a.affected_routes ?? []) {
      const ids = shortNameToIds.get(sn.trim().toUpperCase());
      if (ids) routeIds.push(...ids);
    }
    return {
      id: a.id,
      cause: a.type ?? "Information",
      effect: effectOf(a),
      header: htmlToText(a.title ?? ""),
      description: htmlToText(a.text ?? ""),
      url: a.url,
      routeIds,
      stopIds: [],
      start: a.start_datetime
        ? Math.floor(new Date(a.start_datetime).getTime() / 1000)
        : undefined,
      end: a.end_datetime
        ? Math.floor(new Date(a.end_datetime).getTime() / 1000)
        : undefined,
      severity: severityOf(a),
    };
  });
}

export async function getAlerts(): Promise<ServiceAlert[]> {
  if (cache && Date.now() - cache.ts < 30_000) return cache.data;
  if (inflight) return inflight;
  inflight = fetchAlerts()
    .then((d) => {
      cache = { data: d, ts: Date.now() };
      inflight = null;
      return d;
    })
    .catch((e) => {
      inflight = null;
      logger.warn({ err: String(e) }, "alerts fetch failed");
      return cache?.data ?? [];
    });
  return inflight;
}
