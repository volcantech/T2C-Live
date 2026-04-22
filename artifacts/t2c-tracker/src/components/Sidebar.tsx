import { useEffect, useState } from "react";
import { Accessibility, Bus, Clock, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Departure, type Route, type RouteShape, type Stop, type Vehicle } from "@/lib/api";

// 3-tier delay color: under 2 min = on time (green), 2–5 min = warning (orange),
// over 5 min = severe (red). Negative delays (early) are shown in green too.
function delayClass(delaySec: number): string {
  const m = Math.abs(delaySec) / 60;
  if (m < 2) return "text-emerald-600";
  if (m <= 5) return "text-amber-600";
  return "text-destructive";
}

function formatHM(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function untilLabel(unix: number): string {
  const diff = Math.round((unix * 1000 - Date.now()) / 60000);
  if (diff <= 0) return "à quai";
  if (diff < 60) return `${diff} min`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

interface Props {
  routes: Route[];
  selectedRoute: Route | null;
  routeShape: RouteShape | null;
  selectedStop: Stop | null;
  vehicles: Vehicle[];
  onPickRoute: (r: Route | null) => void;
  onPickStop: (s: Stop | null) => void;
  loadingShape: boolean;
}

export function Sidebar({
  routes,
  selectedRoute,
  routeShape,
  selectedStop,
  vehicles,
  onPickRoute,
  onPickStop,
  loadingShape,
}: Props) {
  const [departures, setDepartures] = useState<Departure[] | null>(null);
  const [loadingDep, setLoadingDep] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setShowAll(false);
  }, [selectedStop?.id]);

  useEffect(() => {
    if (!selectedStop) {
      setDepartures(null);
      return;
    }
    let cancelled = false;
    setLoadingDep(true);
    const run = () =>
      api
        .departures(selectedStop.id, showAll)
        .then((d) => {
          if (!cancelled) setDepartures(d.departures);
        })
        .catch(() => {
          if (!cancelled) setDepartures([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingDep(false);
        });
    run();
    // Don't auto-poll the (large) full-day list; only the "next departures" view refreshes.
    const t = showAll ? null : setInterval(run, 20000);
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
    };
  }, [selectedStop?.id, showAll]);

  if (selectedStop) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between border-b p-4">
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">
              {selectedStop.city ? `Arrêt · ${selectedStop.city}` : "Arrêt"}
            </div>
            <h2 className="flex items-center gap-2 text-lg font-semibold leading-tight">
              <span className="truncate">{selectedStop.name}</span>
              {selectedStop.wheelchair === 1 && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"
                  title="Arrêt accessible aux personnes à mobilité réduite"
                >
                  <Accessibility className="h-3 w-3" />
                  PMR
                </span>
              )}
            </h2>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onPickStop(null)}
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4">
            <div className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {showAll ? "Tous les passages du jour" : "Prochains passages"}
              </span>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="rounded border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent"
              >
                {showAll ? "Voir prochains" : "Voir tous"}
              </button>
            </div>
            {loadingDep && !departures && (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )}
            {departures && departures.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Aucun passage prévu.
              </p>
            )}
            <ul className="divide-y">
              {departures?.map((d, i) => (
                <li
                  key={`${d.tripId}-${i}`}
                  className="flex items-center gap-3 py-2.5"
                >
                  <span
                    className="inline-flex h-8 min-w-10 items-center justify-center rounded px-2 text-sm font-bold"
                    style={{ background: d.routeColor, color: d.routeTextColor }}
                  >
                    {d.routeShortName}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">
                      {d.headsign}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatHM(d.scheduled)}
                      {d.delay !== 0 && (
                        <span className={`ml-2 ${delayClass(d.delay)}`}>
                          {d.delay > 0 ? "+" : ""}
                          {Math.round(d.delay / 60)} min
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums">
                      {untilLabel(d.realtime)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </ScrollArea>
      </div>
    );
  }

  if (selectedRoute) {
    const routeVehicles = vehicles.filter(
      (v) => v.routeId === selectedRoute.id,
    );
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="inline-flex h-10 min-w-12 items-center justify-center rounded px-2 text-base font-bold"
              style={{
                background: selectedRoute.color,
                color: selectedRoute.textColor,
              }}
            >
              {selectedRoute.shortName}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-medium text-muted-foreground">
                Ligne
              </div>
              <h2 className="truncate text-base font-semibold">
                {selectedRoute.longName || "T2C"}
              </h2>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onPickRoute(null)}
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Bus className="h-4 w-4" /> Véhicules en service ({routeVehicles.length})
              </div>
              {routeVehicles.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Aucun véhicule en circulation actuellement.
                </p>
              )}
              <ul className="space-y-2">
                {routeVehicles.map((v) => (
                  <li
                    key={v.tripId}
                    className="rounded-md border bg-card p-3 text-sm"
                  >
                    <div className="font-medium truncate">{v.headsign}</div>
                    {v.nextStopName && (
                      <div className="text-xs text-muted-foreground">
                        → {v.nextStopName}
                        {v.nextStopTime && (
                          <span className="ml-1">
                            ({untilLabel(v.nextStopTime)})
                          </span>
                        )}
                      </div>
                    )}
                    <div className={`mt-1 text-xs ${delayClass(v.delay)}`}>
                      {Math.abs(v.delay) < 60
                        ? "À l'heure"
                        : v.delay > 0
                          ? `Retard +${Math.round(v.delay / 60)} min`
                          : `Avance ${Math.round(v.delay / 60)} min`}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            {routeShape && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <MapPin className="h-4 w-4" /> Arrêts desservis ({routeShape.stops.length})
                </div>
                <ul className="space-y-1">
                  {routeShape.stops.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => onPickStop(s)}
                        className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        {s.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {loadingShape && (
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Default: list of routes
  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">Lignes du réseau ({routes.length})</h2>
        <p className="text-xs text-muted-foreground">
          Sélectionnez une ligne pour voir son tracé et ses véhicules.
        </p>
      </div>
      <ScrollArea className="flex-1">
        <ul className="divide-y">
          {routes.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPickRoute(r)}
                className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent"
              >
                <span
                  className="inline-flex h-9 min-w-11 items-center justify-center rounded px-2 text-sm font-bold"
                  style={{ background: r.color, color: r.textColor }}
                >
                  {r.shortName}
                </span>
                <span className="truncate text-sm">{r.longName}</span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
