import { useMemo, useState } from "react";
import {
  ArrowDown,
  Bus,
  Calendar as CalendarIcon,
  ChevronDown,
  Footprints,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  EndpointPicker,
  endpointLabel,
  endpointToParam,
  type Endpoint,
} from "@/components/EndpointPicker";
import { api, type ItineraryOption, type Stop } from "@/lib/api";

function formatHM(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(sec: number): string {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

function formatDistance(m: number): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function untilLabel(unix: number): string {
  const diff = Math.round((unix * 1000 - Date.now()) / 60000);
  if (diff <= 0) return "maintenant";
  if (diff < 60) return `dans ${diff} min`;
  return `dans ${Math.floor(diff / 60)} h ${String(diff % 60).padStart(2, "0")}`;
}

function formatDateLabel(d: Date): string {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Aujourd'hui";
  if (sameDay(d, tomorrow)) return "Demain";
  return d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Convert a "YYYY-MM-DDTHH:MM" local datetime string to unix seconds. */
function localStringToUnix(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000);
}

/** Format a Date as "YYYY-MM-DDTHH:MM" in local time. */
function dateToLocalInputString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  stops: Stop[];
  onSelectStop: (s: Stop) => void;
}

export function Itinerary({ stops, onSelectStop }: Props) {
  const [from, setFrom] = useState<Endpoint | null>(null);
  const [to, setTo] = useState<Endpoint | null>(null);
  const [results, setResults] = useState<ItineraryOption[] | null>(null);
  const [provider, setProvider] = useState<"google" | "local" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [showWhen, setShowWhen] = useState(false);
  const [whenMode, setWhenMode] = useState<"now" | "depart">("now");
  const [whenLocal, setWhenLocal] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    return dateToLocalInputString(d);
  });

  const atUnix = useMemo(() => {
    if (whenMode === "now") return undefined;
    const t = localStringToUnix(whenLocal);
    return Number.isFinite(t) ? t : undefined;
  }, [whenMode, whenLocal]);

  const search = () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    api
      .itinerary(endpointToParam(from), endpointToParam(to), atUnix)
      .then((d) => {
        setResults(d.options);
        setProvider(d.provider ?? null);
      })
      .catch(() => setError("Impossible de calculer l'itinéraire."))
      .finally(() => setLoading(false));
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
    setResults(null);
  };

  const whenSummary =
    whenMode === "now"
      ? "Partir maintenant"
      : `Partir ${formatDateLabel(new Date(whenLocal))} à ${new Date(whenLocal).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-4">
        <EndpointPicker
          stops={stops}
          value={from}
          onChange={setFrom}
          placeholder="Départ : arrêt ou adresse…"
        />
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <EndpointPicker
              stops={stops}
              value={to}
              onChange={setTo}
              placeholder="Arrivée : arrêt ou adresse…"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={swap}
            aria-label="Inverser"
            title="Inverser"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>

        {/* Date/time selector */}
        <button
          type="button"
          onClick={() => setShowWhen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-accent"
        >
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 truncate">{whenSummary}</span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${showWhen ? "rotate-180" : ""}`}
          />
        </button>
        {showWhen && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setWhenMode("now")}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${whenMode === "now" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              >
                Maintenant
              </button>
              <button
                type="button"
                onClick={() => setWhenMode("depart")}
                className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${whenMode === "depart" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              >
                Partir à…
              </button>
            </div>
            {whenMode === "depart" && (
              <input
                type="datetime-local"
                value={whenLocal}
                onChange={(e) => setWhenLocal(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            )}
          </div>
        )}

        <Button
          className="w-full"
          onClick={search}
          disabled={!from || !to || loading}
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-2 h-4 w-4" />
          )}
          Rechercher
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {results && results.length === 0 && (
            <div className="rounded-md border bg-card p-4 text-sm">
              <p className="font-medium">Aucun trajet trouvé</p>
              <p className="mt-1 text-muted-foreground">
                Aucune ligne ne dessert ces deux points pour ce créneau, même
                avec une correspondance. Essayez une autre heure ou un point
                plus proche d'un grand axe.
              </p>
            </div>
          )}
          {results?.map((opt, idx) => (
            <ItineraryCard
              key={`${opt.legs.map((l) => l.tripId).join("-")}-${idx}`}
              opt={opt}
              fromLabel={from ? endpointLabel(from) : ""}
              toLabel={to ? endpointLabel(to) : ""}
              expanded={expandedIdx === idx}
              onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              onSelectStop={onSelectStop}
            />
          ))}
          {results && results.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={search}
              disabled={loading}
            >
              <RefreshCw className="mr-2 h-3 w-3" /> Actualiser
            </Button>
          )}
          {results && provider && (
            <p className="text-center text-[10px] text-muted-foreground">
              {provider === "google"
                ? "Itinéraires fournis par Google Maps"
                : "Itinéraires calculés en local (open data T2C)"}
            </p>
          )}
          {!results && !loading && !error && (
            <p className="text-center text-sm text-muted-foreground">
              Choisissez un point de départ et d'arrivée (arrêt ou adresse) pour
              voir les prochains trajets.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface CardProps {
  opt: ItineraryOption;
  fromLabel: string;
  toLabel: string;
  expanded: boolean;
  onToggle: () => void;
  onSelectStop: (s: Stop) => void;
}

/**
 * Each row in the timeline.
 * `kind = "point"` is a labelled time on the left + place name on the right
 *   (origin, intermediate transit endpoint, destination).
 * `kind = "walk"` is a walking segment with no left timestamp.
 * `kind = "bus"` is a bus segment with the line badge + headsign + duration.
 */
type TimelineRow =
  | {
      kind: "point";
      time: number | null;
      title: string;
      subtitle?: string;
      isOrigin?: boolean;
      isDestination?: boolean;
      onClick?: () => void;
    }
  | {
      kind: "walk";
      duration: number;
      distance: number;
    }
  | {
      kind: "bus";
      routeShortName: string;
      routeColor: string;
      routeTextColor: string;
      headsign: string;
      duration: number;
      numStops: number;
      delay: number;
      stopIds: { from: string; to: string };
      intermediateStops: { id: string; name: string }[];
    };

function buildRows(
  opt: ItineraryOption,
  fromLabel: string,
  toLabel: string,
  onSelectStop: (s: Stop) => void,
): TimelineRow[] {
  const rows: TimelineRow[] = [];

  // Walk-only option (Google says walking is faster than the bus).
  if (opt.legs.length === 0) {
    rows.push({
      kind: "point",
      time: opt.departure,
      title: fromLabel || "Départ",
      isOrigin: true,
    });
    if (opt.walkBefore) {
      rows.push({
        kind: "walk",
        duration: opt.walkBefore.duration,
        distance: opt.walkBefore.distance,
      });
    }
    rows.push({
      kind: "point",
      time: opt.arrival,
      title: toLabel || "Arrivée",
      isDestination: true,
    });
    return rows;
  }

  const firstLeg = opt.legs[0];
  const lastLeg = opt.legs[opt.legs.length - 1];

  // Origin point
  rows.push({
    kind: "point",
    time: opt.departure,
    title: opt.walkBefore
      ? fromLabel || "Départ"
      : firstLeg.fromStopName,
    subtitle: opt.walkBefore ? undefined : "Arrêt de départ",
    isOrigin: true,
  });

  // Walk to first stop
  if (opt.walkBefore) {
    rows.push({
      kind: "walk",
      duration: opt.walkBefore.duration,
      distance: opt.walkBefore.distance,
    });
    rows.push({
      kind: "point",
      time: firstLeg.departure,
      title: firstLeg.fromStopName,
      subtitle: "Arrêt",
      onClick: () =>
        onSelectStop({
          id: firstLeg.fromStopId,
          name: firstLeg.fromStopName,
          lat: 0,
          lng: 0,
        }),
    });
  }

  for (let i = 0; i < opt.legs.length; i++) {
    const leg = opt.legs[i];

    // Bus segment
    rows.push({
      kind: "bus",
      routeShortName: leg.routeShortName,
      routeColor: leg.routeColor,
      routeTextColor: leg.routeTextColor,
      headsign: leg.headsign,
      duration: leg.arrival - leg.departure,
      numStops: leg.numStops,
      delay: leg.delay,
      stopIds: { from: leg.fromStopId, to: leg.toStopId },
      intermediateStops: leg.intermediateStops,
    });

    // Alight point
    rows.push({
      kind: "point",
      time: leg.arrival,
      title: leg.toStopName,
      subtitle: "Arrêt",
      onClick: () =>
        onSelectStop({
          id: leg.toStopId,
          name: leg.toStopName,
          lat: 0,
          lng: 0,
        }),
    });

    // Transfer walk + boarding stop of the next leg
    if (i < opt.legs.length - 1) {
      const tw = opt.transferWalks?.[i];
      const next = opt.legs[i + 1];
      if (tw) {
        rows.push({
          kind: "walk",
          duration: tw.duration,
          distance: tw.distance,
        });
      }
      rows.push({
        kind: "point",
        time: next.departure,
        title: next.fromStopName,
        subtitle: "Correspondance",
        onClick: () =>
          onSelectStop({
            id: next.fromStopId,
            name: next.fromStopName,
            lat: 0,
            lng: 0,
          }),
      });
    }
  }

  // Walk to destination
  if (opt.walkAfter) {
    rows.push({
      kind: "walk",
      duration: opt.walkAfter.duration,
      distance: opt.walkAfter.distance,
    });
  }

  // Destination point
  rows.push({
    kind: "point",
    time: opt.arrival,
    title: opt.walkAfter ? toLabel || "Arrivée" : lastLeg.toStopName,
    subtitle: opt.walkAfter ? undefined : "Arrêt d'arrivée",
    isDestination: true,
  });

  return rows;
}

function ItineraryCard({
  opt,
  fromLabel,
  toLabel,
  expanded,
  onToggle,
  onSelectStop,
}: CardProps) {
  const rows = buildRows(opt, fromLabel, toLabel, onSelectStop);
  const isTransfer = opt.legs.length > 1;

  return (
    <div className="rounded-md border bg-card p-3 text-sm">
      {/* Header summary: total range + lines */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="font-semibold tabular-nums">
          {formatHM(opt.departure)} – {formatHM(opt.arrival)}
        </span>
        <span className="text-xs text-muted-foreground">
          ({formatDuration(opt.duration)})
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          Départ {untilLabel(opt.departure)}
        </span>
      </div>
      <div className="mb-3 flex items-center gap-1.5 flex-wrap">
        {opt.legs.length === 0 ? (
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
            <Footprints className="h-3 w-3" /> Trajet à pied
          </span>
        ) : (
          opt.legs.map((leg, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-muted-foreground text-xs">→</span>}
              <span
                className="inline-flex h-6 min-w-8 items-center justify-center rounded px-1.5 text-xs font-bold"
                style={{
                  background: leg.routeColor,
                  color: leg.routeTextColor,
                }}
              >
                {leg.routeShortName}
              </span>
            </div>
          ))
        )}
        {isTransfer && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            1 correspondance
          </span>
        )}
      </div>

      {/* Vertical timeline */}
      <Timeline rows={rows} />

      {/* Footer: bus + walk separately */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Bus className="h-3 w-3" />
          <span className="font-semibold text-foreground">
            {formatDuration(opt.transitDuration)} en bus
          </span>
        </span>
        {opt.walkDuration > 0 && (
          <>
            <span>+</span>
            <span className="flex items-center gap-1">
              <Footprints className="h-3 w-3" />
              {formatDuration(opt.walkDuration)} de marche
            </span>
          </>
        )}
        {opt.legs.length > 0 && (
          <button
            type="button"
            className="ml-auto text-xs underline-offset-2 hover:underline"
            onClick={onToggle}
          >
            {expanded ? "Masquer les arrêts" : "Voir les arrêts"}
          </button>
        )}
      </div>

      {expanded && opt.legs.length > 0 && (
        <div className="mt-2 space-y-3 border-t pt-2 text-xs">
          {opt.legs.map((leg, i) => (
            <div key={`exp-${i}`}>
              <div className="font-medium">
                Ligne {leg.routeShortName} → {leg.headsign}
              </div>
              <ol className="mt-1 space-y-0.5">
                <li className="font-medium">{leg.fromStopName}</li>
                {leg.intermediateStops.map((s) => (
                  <li key={s.id} className="text-muted-foreground">
                    · {s.name}
                  </li>
                ))}
                <li className="font-medium">{leg.toStopName}</li>
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Timeline({ rows }: { rows: TimelineRow[] }) {
  return (
    <ol className="space-y-0">
      {rows.map((row, i) => (
        <TimelineRowView key={i} row={row} isLast={i === rows.length - 1} />
      ))}
    </ol>
  );
}

function TimelineRowView({
  row,
  isLast,
}: {
  row: TimelineRow;
  isLast: boolean;
}) {
  if (row.kind === "point") {
    return (
      <li className="grid grid-cols-[44px_18px_1fr] items-start gap-2">
        <div className="pt-0.5 text-right text-xs font-semibold tabular-nums text-foreground">
          {row.time != null ? formatHM(row.time) : ""}
        </div>
        <div className="relative flex h-full justify-center">
          <span
            className={`relative z-10 mt-0.5 h-3.5 w-3.5 rounded-full border-2 ${row.isOrigin || row.isDestination ? "border-foreground bg-background" : "border-foreground bg-background"}`}
          />
          {!isLast && (
            <span className="absolute left-1/2 top-3.5 h-full w-0 -translate-x-1/2 border-l-2 border-dotted border-muted-foreground/40" />
          )}
        </div>
        <div className="min-w-0 pb-3">
          {row.onClick ? (
            <button
              type="button"
              onClick={row.onClick}
              className="text-left hover:underline"
            >
              <div className="font-semibold leading-tight">{row.title}</div>
              {row.subtitle && (
                <div className="text-xs text-muted-foreground">
                  {row.subtitle}
                </div>
              )}
            </button>
          ) : (
            <>
              <div className="font-semibold leading-tight">{row.title}</div>
              {row.subtitle && (
                <div className="text-xs text-muted-foreground">
                  {row.subtitle}
                </div>
              )}
            </>
          )}
        </div>
      </li>
    );
  }

  if (row.kind === "walk") {
    return (
      <li className="grid grid-cols-[44px_18px_1fr] items-start gap-2">
        <div className="flex justify-end pt-1 text-muted-foreground">
          <Footprints className="h-4 w-4" />
        </div>
        <div className="relative flex h-full justify-center">
          {!isLast && (
            <span className="absolute left-1/2 top-0 h-full w-0 -translate-x-1/2 border-l-2 border-dotted border-muted-foreground/40" />
          )}
        </div>
        <div className="min-w-0 pb-3 pt-0.5">
          <div className="font-medium leading-tight">À pied</div>
          <div className="text-xs text-muted-foreground">
            Environ {formatDuration(row.duration)}, {formatDistance(row.distance)}
          </div>
        </div>
      </li>
    );
  }

  // bus
  return (
    <li className="grid grid-cols-[44px_18px_1fr] items-start gap-2">
      <div className="flex justify-end pt-1 text-muted-foreground">
        <Bus className="h-4 w-4" />
      </div>
      <div className="relative flex h-full justify-center">
        <span
          className="absolute left-1/2 top-0 h-full w-1.5 -translate-x-1/2 rounded"
          style={{ background: row.routeColor }}
        />
      </div>
      <div className="min-w-0 pb-3 pt-0.5">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-6 min-w-9 items-center justify-center rounded px-1.5 text-xs font-bold"
            style={{
              background: row.routeColor,
              color: row.routeTextColor,
            }}
          >
            {row.routeShortName}
          </span>
          <span className="truncate text-sm font-medium">
            {row.headsign}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {formatDuration(row.duration)} ({row.numStops} arrêt
          {row.numStops > 1 ? "s" : ""})
          {row.delay !== 0 && (
            <>
              {" · "}
              <span
                className={
                  row.delay > 0 ? "text-destructive" : "text-emerald-600"
                }
              >
                {row.delay > 0 ? "+" : ""}
                {Math.round(row.delay / 60)} min
              </span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

// Re-export so eslint doesn't mark unused
void MapPin;
