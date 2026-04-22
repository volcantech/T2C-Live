import { useEffect, useMemo, useRef, useState } from "react";
import { Bus, Loader2, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type GeocodeResult, type Stop } from "@/lib/api";

export type Endpoint =
  | { kind: "stop"; stop: Stop }
  | { kind: "address"; lat: number; lng: number; label: string };

interface Props {
  stops: Stop[];
  value: Endpoint | null;
  onChange: (e: Endpoint | null) => void;
  placeholder: string;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function endpointToParam(e: Endpoint): string {
  if (e.kind === "stop") return `stop:${e.stop.id}`;
  return `addr:${e.lat.toFixed(6)},${e.lng.toFixed(6)}`;
}

export function endpointLabel(e: Endpoint): string {
  if (e.kind === "stop") {
    return e.stop.city ? `${e.stop.city} — ${e.stop.name}` : e.stop.name;
  }
  return e.label;
}

export function EndpointPicker({ stops, value, onChange, placeholder }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [geo, setGeo] = useState<GeocodeResult[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const dedupedStops = useMemo(() => {
    const map = new Map<string, Stop>();
    for (const s of stops) {
      const key = s.parentId ?? `${s.name}|${s.city ?? ""}`;
      if (!map.has(key)) map.set(key, s);
    }
    return [...map.values()];
  }, [stops]);

  const stopMatches = useMemo(() => {
    const nq = normalize(q.trim());
    if (!nq) return [] as Stop[];
    return dedupedStops
      .filter((s) => normalize(`${s.city ?? ""} ${s.name}`).includes(nq))
      .slice(0, 6);
  }, [q, dedupedStops]);

  // Debounced geocoding when query looks address-y (≥ 4 chars, contains a digit
  // or several words, AND has < 3 matching stops to avoid noise)
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const trimmed = q.trim();
    if (trimmed.length < 4) {
      setGeo([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      setGeoLoading(true);
      api
        .geocode(trimmed)
        .then((r) => setGeo(r.results))
        .catch(() => setGeo([]))
        .finally(() => setGeoLoading(false));
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q]);

  const showInput = open ? q : value ? endpointLabel(value) : "";

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={showInput}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => {
            setQ("");
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          placeholder={placeholder}
          className="pl-9 h-10 text-base"
        />
      </div>
      {open && q.trim().length >= 1 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover text-popover-foreground shadow-lg">
          <ScrollArea className="max-h-80">
            {stopMatches.length > 0 && (
              <div className="p-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Arrêts
                </div>
                {stopMatches.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onChange({ kind: "stop", stop: s });
                      setQ("");
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-3 text-left text-sm hover:bg-accent active:bg-accent"
                  >
                    <Bus className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">
                      {s.city && (
                        <>
                          <span className="font-semibold">{s.city}</span>
                          <span className="text-muted-foreground"> — </span>
                        </>
                      )}
                      {s.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="border-t p-1">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Adresses
                </span>
                {geoLoading && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
              </div>
              {!geoLoading && geo.length === 0 && q.trim().length >= 4 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Aucune adresse trouvée. Essayez « numéro rue, ville »
                  (ex. « 12 rue Blatin, Clermont-Ferrand »).
                </p>
              )}
              {q.trim().length < 4 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Tapez au moins 4 caractères pour rechercher une adresse.
                </p>
              )}
              {geo.map((g, i) => (
                <button
                  key={`${g.lat}-${g.lng}-${i}`}
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onChange({
                      kind: "address",
                      lat: g.lat,
                      lng: g.lng,
                      label: g.label,
                    });
                    setQ("");
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded px-2 py-3 text-left text-sm hover:bg-accent active:bg-accent"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{g.label}</span>
                    {g.city && g.label !== g.city && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {g.city}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
