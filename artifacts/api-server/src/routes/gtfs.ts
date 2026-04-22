import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getGtfs, haversine } from "../lib/gtfs";
import { computeVehiclePositions, getStopDepartures } from "../lib/gtfs-rt";
import { getAlerts } from "../lib/alerts";
import { expandSameName, planItinerary } from "../lib/itinerary";

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
    const stops = [...g.stops.values()];
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
    const dep = await getStopDepartures(req.params.id);
    res.json({ departures: dep });
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
    const seen = new Map<string, { id: string; name: string; lat: number; lng: number; dist: number }>();
    for (const s of g.stops.values()) {
      const dist = haversine({ lat, lng }, s);
      const cur = seen.get(s.name);
      if (!cur || dist < cur.dist) {
        seen.set(s.name, { id: s.id, name: s.name, lat: s.lat, lng: s.lng, dist });
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
    const fromIds = expandSameName(g, from);
    const toIds = expandSameName(g, to);
    const options = await planItinerary(fromIds, toIds);
    res.json({ options });
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
