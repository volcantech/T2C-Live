import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getGtfs, haversine } from "../lib/gtfs";
import { computeVehiclePositions, getStopDepartures } from "../lib/gtfs-rt";
import { getAlerts } from "../lib/alerts";
import { parseEndpoint, planItineraryEndpoints } from "../lib/itinerary";
import { geocode } from "../lib/geocode";

const router: IRouter = Router();

router.get("/static", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const g = await getGtfs();
    const routes = [...g.routes.values()].sort((a, b) => {
      const an = Number(a.shortName);
      const bn = Number(b.shortName);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return a.shortName.localeCompare(b.shortName);
    });
    // Only return location_type=0 stops (real stop points). Stations (1) and
    // entrances (2) have no schedules attached so picking them in the UI yields
    // empty departures.
    const stops = [...g.stops.values()].filter((s) => s.locationType === 0);
    res.json({ routes, stops, loadedAt: g.loadedAt });
  } catch (e) {
    next(e);
  }
});

router.get("/route/:id/shape", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const g = await getGtfs();
    const route = g.routes.get(req.params.id);
    if (!route) {
      res.status(404).json({ error: "route not found" });
      return;
    }
    const shapeIds = g.routeShapes.get(req.params.id) ?? new Set<string>();
    const shapes: { id: string; points: [number, number][] }[] = [];
    for (const sid of shapeIds) {
      const pts = g.shapes.get(sid);
      if (pts)
        shapes.push({
          id: sid,
          points: pts.map((p) => [p.lat, p.lng] as [number, number]),
        });
    }
    const stopIds = g.routeStops.get(req.params.id) ?? new Set<string>();
    const stops = [...stopIds]
      .map((id) => g.stops.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    res.json({ route, shapes, stops });
  } catch (e) {
    next(e);
  }
});

router.get("/vehicles", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const v = await computeVehiclePositions();
    res.json({ vehicles: v, ts: Date.now() });
  } catch (e) {
    next(e);
  }
});

router.get("/stop/:id/departures", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fullDay = req.query["all"] === "1";
    const limit = Number(req.query["limit"] ?? 15);
    const dep = await getStopDepartures(req.params.id, limit, fullDay);
    res.json({ departures: dep });
  } catch (e) {
    next(e);
  }
});

router.get("/stop/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const g = await getGtfs();
    const s = g.stops.get(req.params.id);
    if (!s) {
      res.status(404).json({ error: "stop not found" });
      return;
    }
    // List routes that serve this stop (or any sibling stop sharing the same parent).
    const ids = new Set<string>([s.id]);
    const parentId = s.locationType === 1 ? s.id : s.parentId;
    if (parentId) {
      for (const x of g.stops.values()) {
        if (x.parentId === parentId || x.id === parentId) ids.add(x.id);
      }
    }
    const routes = new Map<string, { id: string; shortName: string; longName: string; color: string; textColor: string }>();
    for (const id of ids) {
      for (const [routeId, set] of g.routeStops) {
        if (set.has(id)) {
          const r = g.routes.get(routeId);
          if (r) routes.set(r.id, { id: r.id, shortName: r.shortName, longName: r.longName, color: r.color, textColor: r.textColor });
        }
      }
    }
    res.json({ stop: s, routes: [...routes.values()] });
  } catch (e) {
    next(e);
  }
});

router.get("/nearby-stops", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat = Number(req.query["lat"]);
    const lng = Number(req.query["lng"]);
    const limit = Number(req.query["limit"] ?? 8);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: "lat & lng required" });
      return;
    }
    const g = await getGtfs();
    // Dedupe by parent_station (or stop_id) so two physical platforms sharing
    // the same name don't both show up; keep the closest variant.
    const seen = new Map<
      string,
      {
        id: string;
        name: string;
        city?: string;
        wheelchair?: number;
        lat: number;
        lng: number;
        dist: number;
      }
    >();
    for (const s of g.stops.values()) {
      if (s.locationType !== 0) continue;
      const key = s.parentId || s.id;
      const dist = haversine({ lat, lng }, s);
      const cur = seen.get(key);
      if (!cur || dist < cur.dist) {
        seen.set(key, {
          id: s.id,
          name: s.name,
          city: s.city,
          wheelchair: s.wheelchair,
          lat: s.lat,
          lng: s.lng,
          dist,
        });
      }
    }
    const list = [...seen.values()]
      .sort((a, b) => a.dist - b.dist)
      .slice(0, limit)
      .map((x) => ({ ...x, distance: Math.round(x.dist) }));
    res.json({ stops: list });
  } catch (e) {
    next(e);
  }
});

router.get("/itinerary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = String(req.query["from"] ?? "");
    const to = String(req.query["to"] ?? "");
    if (!from || !to) {
      res.status(400).json({ error: "from & to required" });
      return;
    }
    const g = await getGtfs();
    const fromEp = parseEndpoint(from, g);
    const toEp = parseEndpoint(to, g);
    if (!fromEp || !toEp) {
      res.status(400).json({ error: "invalid endpoint" });
      return;
    }
    const options = await planItineraryEndpoints(fromEp, toEp);
    res.json({ options });
  } catch (e) {
    next(e);
  }
});

router.get("/geocode", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query["q"] ?? "");
    if (q.trim().length < 3) {
      res.json({ results: [] });
      return;
    }
    const results = await geocode(q);
    res.json({ results });
  } catch (e) {
    next(e);
  }
});

router.get("/alerts", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const alerts = await getAlerts();
    const g = await getGtfs();
    const enriched = alerts.map((a) => ({
      ...a,
      routes: a.routeIds
        .map((id) => g.routes.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => ({
          id: r.id,
          shortName: r.shortName,
          color: r.color,
          textColor: r.textColor,
        })),
      stops: a.stopIds
        .map((id) => g.stops.get(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => ({ id: s.id, name: s.name })),
    }));
    res.json({ alerts: enriched, ts: Date.now() });
  } catch (e) {
    next(e);
  }
});

export default router;
