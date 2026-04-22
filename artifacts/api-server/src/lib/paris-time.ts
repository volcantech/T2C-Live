const FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export interface ParisNow {
  todayStr: string;
  yesterdayStr: string;
  nowSec: number;
  dayBase: number;
  yesterdayBase: number;
}

interface Parts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

function partsOf(date: Date): Parts {
  const parts = FMT.formatToParts(date);
  const get = (k: string): number =>
    Number(parts.find((p) => p.type === k)?.value ?? 0);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    hh: get("hour") % 24,
    mm: get("minute"),
    ss: get("second"),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parisOffsetMs(unixMs: number): number {
  const p = partsOf(new Date(unixMs));
  const local = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return local - unixMs;
}

export function dayBaseForParisDate(y: number, m: number, d: number): number {
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offset = parisOffsetMs(naive);
  return (naive - offset) / 1000;
}

export function dayBaseForParisDateStr(yyyymmdd: string): number {
  return dayBaseForParisDate(
    Number(yyyymmdd.slice(0, 4)),
    Number(yyyymmdd.slice(4, 6)),
    Number(yyyymmdd.slice(6, 8)),
  );
}

export function parisNow(at: Date = new Date()): ParisNow {
  const t = partsOf(at);
  const todayStr = `${t.y}${pad(t.m)}${pad(t.d)}`;
  const nowSec = t.hh * 3600 + t.mm * 60 + t.ss;
  const dayBase = dayBaseForParisDate(t.y, t.m, t.d);
  const yp = partsOf(new Date(at.getTime() - 24 * 3600 * 1000));
  const yesterdayStr = `${yp.y}${pad(yp.m)}${pad(yp.d)}`;
  const yesterdayBase = dayBaseForParisDate(yp.y, yp.m, yp.d);
  return { todayStr, yesterdayStr, nowSec, dayBase, yesterdayBase };
}
