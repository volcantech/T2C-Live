import { useState } from "react";
import { Loader2, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type NearbyStop, type Stop } from "@/lib/api";

interface Props {
  onSelectStop: (s: Stop) => void;
}

function formatDistance(m: number): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function Nearby({ onSelectStop }: Props) {
  const [loading, setLoading] = useState(false);
  const [stops, setStops] = useState<NearbyStop[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locate = () => {
    setLoading(true);
    setError(null);
    if (!("geolocation" in navigator)) {
      setError("La géolocalisation n'est pas disponible sur cet appareil.");
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        api
          .nearbyStops(pos.coords.latitude, pos.coords.longitude)
          .then((d) => setStops(d.stops))
          .catch(() => setError("Erreur de récupération des arrêts."))
          .finally(() => setLoading(false));
      },
      (err) => {
        setLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError("Autorisez la géolocalisation pour voir les arrêts proches.");
        } else {
          setError("Impossible d'obtenir votre position.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">Arrêts proches</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Trouvez les arrêts les plus proches de votre position et leurs prochains
          passages.
        </p>
        <Button className="mt-3 w-full" onClick={locate} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Navigation className="mr-2 h-4 w-4" />
          )}
          Me localiser
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!error && !stops && !loading && (
            <p className="text-sm text-muted-foreground">
              Cliquez sur « Me localiser » pour découvrir les 8 arrêts les plus
              proches de vous.
            </p>
          )}
          {stops && stops.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aucun arrêt trouvé à proximité.
            </p>
          )}
          <ul className="divide-y">
            {stops?.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelectStop(s)}
                  className="flex w-full items-center gap-3 py-3 text-left hover:bg-accent rounded px-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Cliquez pour voir les prochains passages
                    </div>
                  </div>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums">
                    {formatDistance(s.distance)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </ScrollArea>
    </div>
  );
}
