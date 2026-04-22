import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Info, OctagonAlert } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type ServiceAlert } from "@/lib/api";

function formatRange(start?: number, end?: number): string {
  if (!start && !end) return "";
  const fmt = (u: number) =>
    new Date(u * 1000).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  if (start && end) return `Du ${fmt(start)} au ${fmt(end)}`;
  if (start) return `Depuis le ${fmt(start)}`;
  return `Jusqu'au ${fmt(end!)}`;
}

function severityStyle(s: ServiceAlert["severity"]) {
  if (s === "severe")
    return {
      icon: <OctagonAlert className="h-4 w-4 text-destructive" />,
      border: "border-destructive/40",
      bg: "bg-destructive/5",
    };
  if (s === "warning")
    return {
      icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
      border: "border-amber-300",
      bg: "bg-amber-50",
    };
  return {
    icon: <Info className="h-4 w-4 text-primary" />,
    border: "border-primary/30",
    bg: "bg-accent",
  };
}

export function Alerts() {
  const q = useQuery({
    queryKey: ["alerts"],
    queryFn: api.alerts,
    refetchInterval: 30000,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">Perturbations en temps réel</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Source officielle T2C / SMTC-AC. Mise à jour toutes les 30 s.
        </p>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {q.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          )}
          {q.isError && (
            <p className="text-sm text-destructive">
              Impossible de charger les perturbations.
            </p>
          )}
          {q.data && q.data.alerts.length === 0 && (
            <div className="rounded-md border bg-emerald-50 border-emerald-200 p-4 text-sm">
              <p className="font-medium text-emerald-700">
                Aucune perturbation signalée
              </p>
              <p className="mt-1 text-emerald-600">
                Le réseau circule normalement.
              </p>
            </div>
          )}
          {q.data && q.data.alerts.length > 0 && (
            <Accordion type="multiple" className="space-y-2">
              {q.data.alerts.map((a) => {
                const s = severityStyle(a.severity);
                return (
                  <AccordionItem
                    key={a.id}
                    value={a.id}
                    className={`rounded-md border ${s.border} ${s.bg} px-3`}
                  >
                    <AccordionTrigger className="py-3 hover:no-underline">
                      <div className="flex flex-1 items-start gap-2 text-left">
                        <div className="mt-0.5">{s.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold leading-tight text-sm">
                            {a.header || a.effect}
                          </div>
                          {a.routes.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {a.routes.map((r) => (
                                <span
                                  key={r.id}
                                  className="inline-flex h-5 min-w-7 items-center justify-center rounded px-1.5 text-[11px] font-bold"
                                  style={{
                                    background: r.color,
                                    color: r.textColor,
                                  }}
                                >
                                  {r.shortName}
                                </span>
                              ))}
                            </div>
                          )}
                          {(a.start || a.end) && (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {formatRange(a.start, a.end)}
                            </div>
                          )}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3 pt-0 text-sm">
                      {a.description && (
                        <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                          {a.description}
                        </p>
                      )}
                      {a.stops.length > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            Arrêts concernés
                          </span>{" "}
                          ({a.stops.length}) :{" "}
                          {a.stops
                            .slice(0, 12)
                            .map((s) => s.name)
                            .join(", ")}
                          {a.stops.length > 12 && "…"}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-background px-2 py-0.5 font-medium">
                          {a.effect}
                        </span>
                        <span className="text-muted-foreground">{a.cause}</span>
                        {a.url && (
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            Plus d'infos <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
