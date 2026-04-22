import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
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

interface Props {
  stops: Stop[];
  onSelectStop: (s: Stop) => void;
}

export function Itinerary({ stops, onSelectStop }: Props) {
  const [from, setFrom] = useState<Endpoint | null>(null);
  const [to, setTo] = useState<Endpoint | null>(null);
  const [results, setResults] = useState<ItineraryOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const search = () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    api
      .itinerary(endpointToParam(from), endpointToParam(to))
      .then((d) => setResults(d.options))
      .catch(() => setError("Impossible de calculer l'itinéraire."))
      .finally(() => setLoading(false));
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
    setResults(null);
  };

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
        <p className="text-[11px] text-muted-foreground">
          Saisissez un arrêt T2C ou une adresse (ex. « 12 rue Blatin,
          Clermont-Ferrand »). La marche jusqu'à l'arrêt est calculée à 4,5 km/h.
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {results && results.length === 0 && (
            <div className="rounded-md border bg-card p-4 text-sm">
              <p className="font-medium">Aucun trajet trouvé</p>
              <p className="mt-1 text-muted-foreground">
                Aucune ligne ne dessert directement ces deux points aujourd'hui.
                Essayez deux points plus proches d'un grand axe (tram A/B,
                lignes B/C).
              </p>
            </div>
          )}
          {results?.map((opt, idx) => {
            const leg = opt.legs[0];
            const expanded = expandedIdx === idx;
            return (
              <div
                key={`${leg.tripId}-${idx}`}
                className="rounded-md border bg-card p-3 text-sm"
              >
                {opt.walkBefore && (
                  <div className="mb-2 flex items-start gap-2 rounded bg-muted/40 p-2 text-xs">
                    <Footprints className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        Marche jusqu'à {opt.walkBefore.stopName}
                      </div>
                      <div className="text-muted-foreground">
                        {formatDistance(opt.walkBefore.distance)} ·{" "}
                        {formatDuration(opt.walkBefore.duration)} · départ{" "}
                        {formatHM(opt.departure)}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex h-8 min-w-10 items-center justify-center rounded px-2 text-sm font-bold"
                    style={{
                      background: leg.routeColor,
                      color: leg.routeTextColor,
                    }}
                  >
                    {leg.routeShortName}
                  </span>
                  <span className="truncate text-sm font-medium">
                    → {leg.headsign}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 tabular-nums">
                  <div className="flex-1">
                    <div className="font-semibold">
                      {formatHM(leg.departure)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {leg.fromStopName}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 text-right">
                    <div className="font-semibold">{formatHM(leg.arrival)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {leg.toStopName}
                    </div>
                  </div>
                </div>

                {opt.walkAfter && (
                  <div className="mt-2 flex items-start gap-2 rounded bg-muted/40 p-2 text-xs">
                    <Footprints className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        Marche depuis {opt.walkAfter.stopName} jusqu'à votre
                        adresse
                      </div>
                      <div className="text-muted-foreground">
                        {formatDistance(opt.walkAfter.distance)} ·{" "}
                        {formatDuration(opt.walkAfter.duration)} · arrivée{" "}
                        <span className="font-semibold text-foreground">
                          {formatHM(opt.arrival)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Total {formatDuration(opt.duration)}
                  </span>
                  <span>•</span>
                  <span>{leg.numStops} arrêts</span>
                  <span>•</span>
                  <span>Départ {untilLabel(opt.departure)}</span>
                  {leg.delay !== 0 && (
                    <>
                      <span>•</span>
                      <span
                        className={
                          leg.delay > 0
                            ? "text-destructive"
                            : "text-emerald-600"
                        }
                      >
                        {leg.delay > 0 ? "+" : ""}
                        {Math.round(leg.delay / 60)} min
                      </span>
                    </>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setExpandedIdx(expanded ? null : idx)}
                  >
                    {expanded ? "Masquer" : "Voir les arrêts"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      onSelectStop({
                        id: leg.fromStopId,
                        name: leg.fromStopName,
                        lat: 0,
                        lng: 0,
                      })
                    }
                  >
                    <MapPin className="mr-1 h-3 w-3" />
                    Voir l'arrêt
                  </Button>
                </div>
                {expanded && (
                  <ol className="mt-2 space-y-1 border-t pt-2 text-xs">
                    <li className="font-medium">{leg.fromStopName}</li>
                    {leg.intermediateStops.map((s) => (
                      <li key={s.id} className="text-muted-foreground">
                        · {s.name}
                      </li>
                    ))}
                    <li className="font-medium">{leg.toStopName}</li>
                  </ol>
                )}
              </div>
            );
          })}
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
