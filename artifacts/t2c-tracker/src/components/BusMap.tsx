import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Marker,
  useMap,
  Popup,
} from "react-leaflet";
import type { Route, RouteShape, Stop, Vehicle } from "@/lib/api";

const CLERMONT_CENTER: [number, number] = [45.7797, 3.0863];

function busIcon(v: Vehicle, dimmed: boolean) {
  const style = `background:${v.routeColor};color:${v.routeTextColor};transform: rotate(0deg);`;
  const arrowColor = "#111827";
  const arrowStyle = `transform: translateX(-50%) rotate(${v.bearing}deg); transform-origin: 50% 22px;`;
  return L.divIcon({
    className: "",
    html: `<div class="bus-marker ${dimmed ? "dimmed" : ""}" style="${style}">
      <span style="position:absolute;top:-9px;left:50%;${arrowStyle}; width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${arrowColor}; filter: drop-shadow(0 1px 1px rgba(255,255,255,0.8));"></span>
      ${v.routeShortName}
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [target, map]);
  return null;
}

function FitBounds({ bounds }: { bounds: [number, number][] | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length) {
      map.fitBounds(bounds as L.LatLngBoundsLiteral, { padding: [40, 40] });
    }
  }, [bounds, map]);
  return null;
}

interface Props {
  vehicles: Vehicle[];
  stops: Stop[];
  routes: Route[];
  selectedRoute: Route | null;
  routeShape: RouteShape | null;
  selectedStop: Stop | null;
  onSelectRoute: (r: Route) => void;
  onSelectStop: (s: Stop) => void;
  flyTo: [number, number] | null;
  userPos: [number, number] | null;
  focusedTripId?: string | null;
}

export function BusMap({
  vehicles,
  stops,
  selectedRoute,
  routeShape,
  selectedStop,
  onSelectRoute,
  onSelectStop,
  flyTo,
  userPos,
  focusedTripId,
}: Props) {
  const fitBounds = useMemo(() => {
    if (!routeShape) return null;
    const pts: [number, number][] = [];
    for (const s of routeShape.shapes) for (const p of s.points) pts.push(p);
    return pts.length ? pts : null;
  }, [routeShape]);

  const visibleStops = useMemo(() => {
    if (routeShape) return routeShape.stops;
    return stops;
  }, [stops, routeShape]);

  const filteredVehicles = useMemo(() => {
    if (!selectedRoute) return vehicles;
    return vehicles.filter((v) => v.routeId === selectedRoute.id);
  }, [vehicles, selectedRoute]);

  return (
    <MapContainer
      center={CLERMONT_CENTER}
      zoom={13}
      className="h-full w-full"
      preferCanvas
      attributionControl={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains={["a", "b", "c", "d"]}
      />
      <FitBounds bounds={fitBounds} />
      <FlyTo target={flyTo} />

      {routeShape?.shapes.map((s) => (
        <Polyline
          key={s.id}
          positions={s.points}
          pathOptions={{
            color: routeShape.route.color,
            weight: 5,
            opacity: 0.85,
          }}
        />
      ))}

      {!selectedRoute &&
        visibleStops.length < 1500 &&
        visibleStops.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lng]}
            radius={3}
            pathOptions={{
              color: "#0d6efd",
              weight: 1,
              fillColor: "#ffffff",
              fillOpacity: 1,
            }}
            eventHandlers={{ click: () => onSelectStop(s) }}
          />
        ))}

      {routeShape &&
        routeShape.stops.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lng]}
            radius={5}
            pathOptions={{
              color: routeShape.route.color,
              weight: 2,
              fillColor: "#ffffff",
              fillOpacity: 1,
            }}
            eventHandlers={{ click: () => onSelectStop(s) }}
          >
            <Popup>
              <strong>{s.name}</strong>
            </Popup>
          </CircleMarker>
        ))}

      {selectedStop && (
        <CircleMarker
          center={[selectedStop.lat, selectedStop.lng]}
          radius={9}
          pathOptions={{
            color: "#111827",
            weight: 2,
            fillColor: "#fde047",
            fillOpacity: 1,
          }}
        >
          <Popup>
            <strong>{selectedStop.name}</strong>
          </Popup>
        </CircleMarker>
      )}

      {userPos && (
        <>
          <CircleMarker
            center={userPos}
            radius={9}
            pathOptions={{
              color: "#ffffff",
              weight: 3,
              fillColor: "#1d4ed8",
              fillOpacity: 1,
            }}
          >
            <Popup>Vous êtes ici</Popup>
          </CircleMarker>
          <CircleMarker
            center={userPos}
            radius={22}
            pathOptions={{
              color: "#1d4ed8",
              weight: 1,
              fillColor: "#1d4ed8",
              fillOpacity: 0.12,
            }}
            interactive={false}
          />
        </>
      )}

      {filteredVehicles.map((v) => (
        <AnimatedBus
          key={v.tripId}
          vehicle={v}
          dimmed={false}
          focused={focusedTripId === v.tripId}
          onSelectRoute={() => {
            const route = { id: v.routeId, shortName: v.routeShortName, longName: "", color: v.routeColor, textColor: v.routeTextColor, type: 3 };
            onSelectRoute(route);
          }}
        />
      ))}
    </MapContainer>
  );
}

function AnimatedBus({
  vehicle,
  dimmed,
  focused,
  onSelectRoute,
}: {
  vehicle: Vehicle;
  dimmed: boolean;
  focused?: boolean;
  onSelectRoute: () => void;
}) {
  const ref = useRef<L.Marker | null>(null);
  const prevPos = useRef<[number, number]>([vehicle.lat, vehicle.lng]);

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const start = prevPos.current;
    const end: [number, number] = [vehicle.lat, vehicle.lng];
    const startTs = performance.now();
    const duration = 5000;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - startTs) / duration);
      const lat = start[0] + (end[0] - start[0]) * k;
      const lng = start[1] + (end[1] - start[1]) * k;
      m.setLatLng([lat, lng]);
      if (k < 1) raf = requestAnimationFrame(step);
      else prevPos.current = end;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [vehicle.lat, vehicle.lng]);

  // When this bus becomes the "focused" one (selected from a departure list,
  // for instance), open its popup so the user immediately sees its info.
  useEffect(() => {
    if (!focused) return;
    const m = ref.current;
    if (!m) return;
    const t = setTimeout(() => m.openPopup(), 350);
    return () => clearTimeout(t);
  }, [focused]);

  return (
    <Marker
      ref={(r) => {
        ref.current = r;
      }}
      position={prevPos.current}
      icon={busIcon(vehicle, dimmed)}
    >
      <Popup>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center rounded px-1.5 text-xs font-bold"
              style={{
                background: vehicle.routeColor,
                color: vehicle.routeTextColor,
              }}
            >
              {vehicle.routeShortName}
            </span>
            <strong>{vehicle.headsign}</strong>
          </div>
          {vehicle.nextStopName && (
            <div className="text-xs text-muted-foreground">
              Prochain arrêt : {vehicle.nextStopName}
            </div>
          )}
          <div className="text-xs">
            {vehicle.delay === 0
              ? "À l'heure"
              : vehicle.delay > 0
                ? `Retard : +${Math.round(vehicle.delay / 60)} min`
                : `Avance : ${Math.round(vehicle.delay / 60)} min`}
          </div>
          <button
            type="button"
            onClick={onSelectRoute}
            className="mt-1 inline-flex items-center rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Voir la ligne {vehicle.routeShortName}
          </button>
        </div>
      </Popup>
    </Marker>
  );
}
