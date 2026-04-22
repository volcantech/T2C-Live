import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bus, MapPinned, Navigation } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Skeleton } from "@/components/ui/skeleton";
import { BusMap } from "@/components/BusMap";
import { SearchBar } from "@/components/SearchBar";
import { Sidebar } from "@/components/Sidebar";
import { Itinerary } from "@/components/Itinerary";
import { Nearby } from "@/components/Nearby";
import { Alerts } from "@/components/Alerts";
import { api, type Route, type RouteShape, type Stop } from "@/lib/api";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

type TabKey = "lines" | "itinerary" | "nearby" | "alerts";

const TABS: { key: TabKey; label: string; icon: typeof Bus }[] = [
  { key: "lines", label: "Lignes", icon: Bus },
  { key: "itinerary", label: "Itinéraire", icon: MapPinned },
  { key: "nearby", label: "Près de moi", icon: Navigation },
  { key: "alerts", label: "Infos trafic", icon: AlertTriangle },
];

function Tracker() {
  const staticQ = useQuery({
    queryKey: ["static"],
    queryFn: api.static,
    staleTime: 1000 * 60 * 60,
  });

  const vehiclesQ = useQuery({
    queryKey: ["vehicles"],
    queryFn: api.vehicles,
    refetchInterval: 5000,
    enabled: !!staticQ.data,
  });

  const alertsQ = useQuery({
    queryKey: ["alerts"],
    queryFn: api.alerts,
    refetchInterval: 30000,
    enabled: !!staticQ.data,
  });

  const [tab, setTab] = useState<TabKey>("lines");
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [routeShape, setRouteShape] = useState<RouteShape | null>(null);
  const [loadingShape, setLoadingShape] = useState(false);
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!selectedRoute) {
      setRouteShape(null);
      return;
    }
    let cancelled = false;
    setLoadingShape(true);
    api
      .routeShape(selectedRoute.id)
      .then((s) => {
        if (!cancelled) setRouteShape(s);
      })
      .catch(() => {
        if (!cancelled) setRouteShape(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingShape(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoute?.id]);

  const handlePickRoute = (r: Route | null) => {
    setSelectedRoute(r);
    setSelectedStop(null);
    setTab("lines");
  };

  const handlePickStop = (s: Stop | null) => {
    setSelectedStop(s);
    if (s && s.lat && s.lng) setFlyTo([s.lat, s.lng]);
    if (s) setTab("lines");
  };

  // For stop picked from itinerary (without coords), fetch coords from static list
  const handlePickStopById = (s: Stop) => {
    const real = staticQ.data?.stops.find((x) => x.id === s.id);
    handlePickStop(real ?? s);
  };

  const isLoading = staticQ.isLoading || (!staticQ.data && !staticQ.isError);
  const alertCount = alertsQ.data?.alerts.length ?? 0;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <header className="flex items-center gap-4 border-b bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
            T2C
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-semibold leading-tight">
              T2C Live Tracker
            </h1>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="live-dot inline-block h-2 w-2 rounded-full bg-emerald-500" />
              Temps réel · Clermont-Ferrand
            </div>
          </div>
        </div>
        <div className="flex-1 max-w-xl">
          {staticQ.data && (
            <SearchBar
              routes={staticQ.data.routes}
              stops={staticQ.data.stops}
              onPickRoute={handlePickRoute}
              onPickStop={handlePickStop}
            />
          )}
        </div>
        <div className="hidden md:block text-xs text-muted-foreground tabular-nums">
          {vehiclesQ.data
            ? `${vehiclesQ.data.vehicles.length} véhicules`
            : ""}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="hidden md:flex w-[380px] shrink-0 flex-col border-r bg-card">
          <nav className="grid grid-cols-4 border-b">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              const showBadge = t.key === "alerts" && alertCount > 0;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                  {showBadge && (
                    <span className="absolute right-3 top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                      {alertCount}
                    </span>
                  )}
                  {active && (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
                  )}
                </button>
              );
            })}
          </nav>
          <div className="flex-1 min-h-0">
            {!staticQ.data ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : tab === "lines" ? (
              <Sidebar
                routes={staticQ.data.routes}
                selectedRoute={selectedRoute}
                routeShape={routeShape}
                selectedStop={selectedStop}
                vehicles={vehiclesQ.data?.vehicles ?? []}
                onPickRoute={handlePickRoute}
                onPickStop={handlePickStop}
                loadingShape={loadingShape}
              />
            ) : tab === "itinerary" ? (
              <Itinerary
                stops={staticQ.data.stops}
                onSelectStop={handlePickStopById}
              />
            ) : tab === "nearby" ? (
              <Nearby onSelectStop={handlePickStopById} />
            ) : (
              <Alerts />
            )}
          </div>
        </aside>
        <main className="relative flex-1">
          {isLoading && (
            <div className="absolute inset-0 z-[500] flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="text-center">
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="text-sm text-muted-foreground">
                  Chargement des données du réseau…
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Premier chargement long : téléchargement du GTFS T2C.
                </p>
              </div>
            </div>
          )}
          {staticQ.isError && (
            <div className="absolute inset-0 z-[500] flex items-center justify-center bg-background">
              <div className="max-w-sm text-center">
                <p className="font-semibold">Impossible de charger le réseau</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Le serveur GTFS n'a pas répondu. Réessayez dans un instant.
                </p>
              </div>
            </div>
          )}
          {staticQ.data && (
            <BusMap
              vehicles={vehiclesQ.data?.vehicles ?? []}
              stops={staticQ.data.stops}
              routes={staticQ.data.routes}
              selectedRoute={selectedRoute}
              routeShape={routeShape}
              selectedStop={selectedStop}
              onSelectRoute={handlePickRoute}
              onSelectStop={handlePickStop}
              flyTo={flyTo}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Tracker />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
