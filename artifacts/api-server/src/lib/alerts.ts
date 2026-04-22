import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { logger } from "./logger";

const URL_ALERTS =
  process.env["T2C_GTFS_RT_ALERTS_URL"] ??
  "https://proxy.transport.data.gouv.fr/resource/t2c-clermont-gtfs-rt-service-alerts";

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

const CAUSE: Record<number, string> = {
  1: "Cause inconnue",
  2: "Autre cause",
  3: "Problème technique",
  4: "Grève",
  5: "Manifestation",
  6: "Travaux",
  7: "Entretien",
  8: "Conditions météo",
  9: "Accident",
  10: "Vacances",
  11: "Conditions de circulation",
  12: "Police",
  13: "Urgence médicale",
};
const EFFECT: Record<number, string> = {
  1: "Service interrompu",
  2: "Service réduit",
  3: "Détours importants",
  4: "Service supplémentaire",
  5: "Modification d'horaires",
  6: "Information",
  7: "Autre effet",
  8: "Effet inconnu",
  9: "Arrêt déplacé",
  10: "Aucun service",
  11: "Service réduit",
};

let cache: { data: ServiceAlert[]; ts: number } | null = null;
let inflight: Promise<ServiceAlert[]> | null = null;

function pickText(t: { translation?: { text?: string | null; language?: string | null }[] | null } | null | undefined): string {
  const list = t?.translation ?? [];
  const fr = list.find((x) => (x.language ?? "").toLowerCase().startsWith("fr"));
  return (fr?.text ?? list[0]?.text ?? "").trim();
}

function severityOf(effect: number): "info" | "warning" | "severe" {
  if (effect === 1 || effect === 10) return "severe";
  if (effect === 2 || effect === 3 || effect === 9 || effect === 11) return "warning";
  return "info";
}

async function fetchAlerts(): Promise<ServiceAlert[]> {
  const res = await fetch(URL_ALERTS);
  if (!res.ok) throw new Error(`alerts fetch ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const msg = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
  const out: ServiceAlert[] = [];
  for (const ent of msg.entity) {
    const a = ent.alert;
    if (!a) continue;
    const routeIds = new Set<string>();
    const stopIds = new Set<string>();
    for (const ie of a.informedEntity ?? []) {
      if (ie.routeId) routeIds.add(ie.routeId);
      if (ie.stopId) stopIds.add(ie.stopId);
    }
    const periods = a.activePeriod ?? [];
    const start = periods[0]?.start ? Number(periods[0].start) : undefined;
    const end = periods[0]?.end ? Number(periods[0].end) : undefined;
    const effect = a.effect ?? 8;
    out.push({
      id: ent.id,
      cause: CAUSE[a.cause ?? 1] ?? "Cause inconnue",
      effect: EFFECT[effect] ?? "Effet inconnu",
      header: pickText(a.headerText),
      description: pickText(a.descriptionText),
      url: pickText(a.url) || undefined,
      routeIds: [...routeIds],
      stopIds: [...stopIds],
      start,
      end,
      severity: severityOf(effect),
    });
  }
  return out;
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
