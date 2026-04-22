import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Stop } from "@/lib/api";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

interface Props {
  stops: Stop[];
  value: Stop | null;
  onChange: (s: Stop | null) => void;
  placeholder: string;
}

export function StopPicker({ stops, value, onChange, placeholder }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const dedupedStops = useMemo(() => {
    const map = new Map<string, Stop>();
    for (const s of stops) if (!map.has(s.name)) map.set(s.name, s);
    return [...map.values()];
  }, [stops]);

  const matches = useMemo(() => {
    const nq = normalize(q.trim());
    if (!nq) return [];
    return dedupedStops
      .filter((s) => normalize(s.name).includes(nq))
      .slice(0, 10);
  }, [q, dedupedStops]);

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={open ? q : (value?.name ?? "")}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => {
            setQ("");
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="pl-9 h-10"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover shadow-lg">
          <ScrollArea className="max-h-72">
            {matches.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s);
                  setQ("");
                  setOpen(false);
                }}
                className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-accent"
              >
                {s.name}
              </button>
            ))}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
