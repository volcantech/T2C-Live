import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Route, Stop } from "@/lib/api";

interface Props {
  routes: Route[];
  stops: Stop[];
  onPickRoute: (r: Route) => void;
  onPickStop: (s: Stop) => void;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function SearchBar({ routes, stops, onPickRoute, onPickStop }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const nq = normalize(q.trim());

  const matches = useMemo(() => {
    if (!nq) return { routes: [] as Route[], stops: [] as Stop[] };
    const r = routes
      .filter(
        (r) =>
          normalize(r.shortName).includes(nq) ||
          normalize(r.longName).includes(nq),
      )
      .slice(0, 8);
    // Dedupe by parent station (or stop id) so identical platforms don't
    // appear twice, but preserve all distinct stops with the same name in
    // different cities.
    const seen = new Map<string, Stop>();
    for (const stop of stops) {
      if (seen.size >= 30) break;
      const haystack = normalize(`${stop.city ?? ""} ${stop.name}`);
      if (!haystack.includes(nq)) continue;
      const key = stop.parentId ?? stop.id;
      if (!seen.has(key)) seen.set(key, stop);
    }
    return { routes: r, stops: [...seen.values()].slice(0, 12) };
  }, [nq, routes, stops]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Rechercher une ligne ou un arrêt…"
          className="pl-9 h-11 text-base"
        />
      </div>
      {open && nq && (matches.routes.length > 0 || matches.stops.length > 0) && (
        <div className="absolute left-0 right-0 top-full mt-1 z-[1000] rounded-md border bg-popover text-popover-foreground shadow-lg">
          <ScrollArea className="max-h-80">
            {matches.routes.length > 0 && (
              <div className="p-2">
                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                  Lignes
                </div>
                {matches.routes.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onPickRoute(r);
                      setOpen(false);
                      setQ("");
                    }}
                    className="flex w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-accent"
                  >
                    <span
                      className="inline-flex h-7 min-w-9 items-center justify-center rounded px-2 text-sm font-bold"
                      style={{ background: r.color, color: r.textColor }}
                    >
                      {r.shortName}
                    </span>
                    <span className="truncate text-sm">{r.longName}</span>
                  </button>
                ))}
              </div>
            )}
            {matches.stops.length > 0 && (
              <div className="p-2 border-t">
                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                  Arrêts
                </div>
                {matches.stops.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onPickStop(s);
                      setOpen(false);
                      setQ("");
                    }}
                    className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="truncate">{s.name}</span>
                    {s.city && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {s.city}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
