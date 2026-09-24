"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { HistoryRange, PremiumHistory, PremiumHistoryPoint } from "@/lib/archive";

type HistoryResponse = PremiumHistory & { degradedReason: string | null };

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

const HEIGHT = 240;
const MARGIN = { top: 18, right: 68, bottom: 28, left: 52 };

async function fetchHistory(symbol: string, range: HistoryRange): Promise<HistoryResponse> {
  const response = await fetch(
    `/api/prestocks/${encodeURIComponent(symbol)}/history?range=${range}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const failure = (await response.json()) as { error: string; action: string };
    throw new Error(`${failure.error}. ${failure.action}`);
  }
  return (await response.json()) as HistoryResponse;
}

function signedPct(value: number, digits = 2) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

function money(value: number | null) {
  if (value === null) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

// Always include 0% (the PreStocks mark) so the gap is read against it.
function yScaleFor(points: PremiumHistoryPoint[]) {
  const low = Math.min(0, ...points.map((point) => point.premiumMin));
  const high = Math.max(0, ...points.map((point) => point.premiumMax));
  const pad = Math.max((high - low) * 0.08, 0.5);
  const step = niceStep((high - low + pad * 2) / 4);
  // When every reading is on one side of the mark, pin the axis at 0% there
  // instead of padding into a range the data never reaches.
  const min = low < 0 ? Math.floor((low - pad) / step) * step : 0;
  const max = high > 0 ? Math.ceil((high + pad) / step) * step : 0;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Number(tick.toFixed(6)));
  return { min, max, ticks };
}

const MIN_TICK_SPACING = 56;

function timeTicks(range: HistoryRange, start: number, end: number) {
  const ticks: number[] = [];
  const cursor = new Date(start);
  if (range === "24h") {
    cursor.setMinutes(0, 0, 0);
    while (cursor.getTime() < start || cursor.getHours() % 6 !== 0) cursor.setHours(cursor.getHours() + 1);
    for (; cursor.getTime() <= end; cursor.setHours(cursor.getHours() + 6)) ticks.push(cursor.getTime());
  } else {
    const dayStep = range === "7d" ? 1 : 5;
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() + 1);
    for (; cursor.getTime() <= end; cursor.setDate(cursor.getDate() + dayStep)) ticks.push(cursor.getTime());
  }
  return ticks;
}

function formatTick(range: HistoryRange, time: number) {
  return new Intl.DateTimeFormat(undefined, range === "24h"
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric" }).format(time);
}

function formatBucket(time: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}

// Missing buckets (cron outage) break the line instead of drawing a
// straight segment across data that was never observed.
function segmentsOf(points: PremiumHistoryPoint[], bucketMs: number) {
  const segments: PremiumHistoryPoint[][] = [];
  for (const point of points) {
    const last = segments.at(-1)?.at(-1);
    if (last && new Date(point.bucketStart).getTime() - new Date(last.bucketStart).getTime() <= bucketMs * 2) {
      segments.at(-1)!.push(point);
    } else {
      segments.push([point]);
    }
  }
  return segments;
}

function Summary({ symbol, data, rangeLabel, windowStart }: {
  symbol: string;
  data: HistoryResponse;
  rangeLabel: string;
  windowStart: number;
}) {
  const summary = data.summary;
  if (!summary) return null;
  const partial = new Date(summary.firstObservedAt).getTime() > windowStart + data.bucketMs;
  const coverage = partial
    ? `since ${formatBucket(new Date(summary.firstObservedAt).getTime())}`
    : `over the last ${rangeLabel}`;

  return (
    <div className="history-summary">
      <p>
        {symbol} traded between <strong>{signedPct(summary.premiumMin, 1)}</strong> and{" "}
        <strong>{signedPct(summary.premiumMax, 1)}</strong> versus its PreStocks mark {coverage},
        averaging {signedPct(summary.premiumMean, 1)}.
      </p>
      <dl>
        <div>
          <dt>More than 2% from the mark</dt>
          <dd>{Math.round(summary.pctBeyondTwoPct)}% of readings</dd>
        </div>
        <div>
          <dt>Median depth at 1% impact</dt>
          <dd>{summary.depthMedianUsd === null ? "Not measured yet" : `$${Math.floor(summary.depthMedianUsd).toLocaleString("en-US")}`}</dd>
        </div>
        <div>
          <dt>Readings</dt>
          <dd>{summary.readings.toLocaleString("en-US")}</dd>
        </div>
      </dl>
    </div>
  );
}

export function PremiumHistory({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<HistoryRange>("7d");
  const [width, setWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const { data, error, isPending, isPlaceholderData } = useQuery({
    queryKey: ["prestocks-history", symbol, range],
    queryFn: () => fetchHistory(symbol, range),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const rangeMeta = RANGES.find((item) => item.value === range)!;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const points = useMemo(() => data?.points ?? [], [data]);
  // The server returns the exact window it queried, so the x-axis matches
  // the buckets instead of drifting with the client clock.
  const windowStart = data ? Date.parse(data.windowStart) : 0;
  const windowEnd = data ? Date.parse(data.windowEnd) : 0;

  const chart = useMemo(() => {
    if (!data || points.length === 0 || width === 0) return null;
    const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const y = yScaleFor(points);
    const xOf = (time: number) => MARGIN.left + ((time - windowStart) / (windowEnd - windowStart)) * plotWidth;
    const yOf = (value: number) => MARGIN.top + ((y.max - value) / (y.max - y.min)) * plotHeight;
    // Plot each bucket at its midpoint so the last one sits inside the window.
    const timeOf = (point: PremiumHistoryPoint) => new Date(point.bucketStart).getTime() + data.bucketMs / 2;
    const segments = segmentsOf(points, data.bucketMs).map((segment) => ({
      line: segment.map((point, index) => `${index ? "L" : "M"}${xOf(timeOf(point)).toFixed(1)},${yOf(point.premiumAvg).toFixed(1)}`).join(""),
      band: [
        ...segment.map((point, index) => `${index ? "L" : "M"}${xOf(timeOf(point)).toFixed(1)},${yOf(point.premiumMax).toFixed(1)}`),
        ...[...segment].reverse().map((point) => `L${xOf(timeOf(point)).toFixed(1)},${yOf(point.premiumMin).toFixed(1)}`),
        "Z",
      ].join(""),
    }));
    const xTicks: number[] = [];
    for (const time of timeTicks(data.range, windowStart, windowEnd)) {
      const x = xOf(time);
      const previous = xTicks.at(-1);
      if (x < MARGIN.left + 16 || x > MARGIN.left + plotWidth - 16) continue;
      if (previous === undefined || x - xOf(previous) >= MIN_TICK_SPACING) xTicks.push(time);
    }
    return { plotWidth, plotHeight, y, xOf, yOf, timeOf, segments, xTicks };
  }, [data, points, width, windowStart, windowEnd]);

  function nearestIndex(clientX: number, target: SVGRectElement) {
    if (!chart) return null;
    const box = target.getBoundingClientRect();
    const x = clientX - box.left + MARGIN.left;
    let best = 0;
    for (let index = 1; index < points.length; index += 1) {
      if (Math.abs(chart.xOf(chart.timeOf(points[index])) - x) < Math.abs(chart.xOf(chart.timeOf(points[best])) - x)) best = index;
    }
    return best;
  }

  function onKeyDown(event: KeyboardEvent<SVGRectElement>) {
    if (points.length === 0) return;
    if (event.key === "ArrowLeft") setHoverIndex((index) => Math.max(0, (index ?? points.length) - 1));
    else if (event.key === "ArrowRight") setHoverIndex((index) => Math.min(points.length - 1, (index ?? -1) + 1));
    else if (event.key === "Escape") setHoverIndex(null);
    else return;
    event.preventDefault();
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const last = points.at(-1) ?? null;
  const readout = hovered ?? last;

  return (
    <section className="premium-history" aria-labelledby="premium-history-title">
      <div className="premium-history__head">
        <h2 id="premium-history-title">Premium to the PreStocks mark over time</h2>
        <div className="premium-history__ranges" role="group" aria-label="Time range">
          {RANGES.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={range === item.value}
              onClick={() => {
                setRange(item.value);
                setHoverIndex(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && !data ? (
        <p className="confidence-unavailable">{error instanceof Error ? error.message : "History is unavailable."}</p>
      ) : null}
      {data ? <Summary symbol={symbol} data={data} rangeLabel={rangeMeta.label} windowStart={windowStart} /> : null}

      {readout ? (
        <div className="premium-history__readout" aria-live="polite">
          <strong><i aria-hidden="true" />{signedPct(readout.premiumAvg)}</strong>
          <span>
            {hovered ? formatBucket(new Date(readout.bucketStart).getTime()) : "Latest period"} · range{" "}
            {signedPct(readout.premiumMin)} to {signedPct(readout.premiumMax)} · Token {money(readout.tokenPriceAvg)} · Mark{" "}
            {money(readout.markPriceAvg)} · {readout.readings} readings
          </span>
        </div>
      ) : null}

      <div className="premium-history__frame" ref={frameRef} data-refreshing={isPlaceholderData}>
        {isPending ? (
          <div className="premium-history__empty">Loading recorded readings</div>
        ) : data && points.length === 0 ? (
          <div className="premium-history__empty">
            {data.degradedReason ??
              "No readings recorded yet. The observe cron archives one reading per minute, so history appears after its first run."}
          </div>
        ) : chart ? (
          <>
            <svg
              width={width}
              height={HEIGHT}
              role="group"
              aria-label={`${symbol} premium to the PreStocks mark, ${rangeMeta.label}. Use arrow keys to read values.`}
            >
              {chart.y.ticks.map((tick) => (
                <g key={tick}>
                  <line
                    className={tick === 0 ? "premium-history__mark" : "premium-history__grid"}
                    x1={MARGIN.left}
                    x2={MARGIN.left + chart.plotWidth}
                    y1={chart.yOf(tick)}
                    y2={chart.yOf(tick)}
                  />
                  <text className="premium-history__tick" x={MARGIN.left - 8} y={chart.yOf(tick)} textAnchor="end" dominantBaseline="middle">
                    {tick === 0 ? "0%" : signedPct(tick, Number.isInteger(tick) ? 0 : 1)}
                  </text>
                </g>
              ))}
              <text className="premium-history__mark-label" x={MARGIN.left + 6} y={chart.yOf(0) - 6}>
                PreStocks mark
              </text>
              {chart.xTicks.map((time) => (
                <text key={time} className="premium-history__tick" x={chart.xOf(time)} y={HEIGHT - 8} textAnchor="middle">
                  {formatTick(data!.range, time)}
                </text>
              ))}
              {chart.segments.map((segment, index) => (
                <g key={index}>
                  <path className="premium-history__band" d={segment.band} />
                  <path className="premium-history__line" d={segment.line} />
                </g>
              ))}
              {last ? (
                <>
                  <circle
                    className="premium-history__dot"
                    cx={chart.xOf(chart.timeOf(last))}
                    cy={chart.yOf(last.premiumAvg)}
                    r={4}
                  />
                  <text
                    className="premium-history__end-label"
                    x={chart.xOf(chart.timeOf(last)) + 9}
                    y={chart.yOf(last.premiumAvg)}
                    dominantBaseline="middle"
                  >
                    {signedPct(last.premiumAvg, 1)}
                  </text>
                </>
              ) : null}
              {hovered ? (
                <>
                  <line
                    className="premium-history__crosshair"
                    x1={chart.xOf(chart.timeOf(hovered))}
                    x2={chart.xOf(chart.timeOf(hovered))}
                    y1={MARGIN.top}
                    y2={MARGIN.top + chart.plotHeight}
                  />
                  <circle
                    className="premium-history__dot"
                    cx={chart.xOf(chart.timeOf(hovered))}
                    cy={chart.yOf(hovered.premiumAvg)}
                    r={4}
                  />
                </>
              ) : null}
              <rect
                className="premium-history__hit"
                x={MARGIN.left}
                y={MARGIN.top}
                width={chart.plotWidth}
                height={chart.plotHeight}
                tabIndex={0}
                onPointerMove={(event: PointerEvent<SVGRectElement>) => setHoverIndex(nearestIndex(event.clientX, event.currentTarget))}
                onPointerLeave={() => setHoverIndex(null)}
                onFocus={() => setHoverIndex((index) => index ?? points.length - 1)}
                onBlur={() => setHoverIndex(null)}
                onKeyDown={onKeyDown}
              />
            </svg>
          </>
        ) : null}
      </div>

      {points.length > 0 ? (
        <details className="premium-history__table">
          <summary>Show readings as a table</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Period starting</th>
                <th scope="col">Avg premium</th>
                <th scope="col">Range</th>
                <th scope="col">Token</th>
                <th scope="col">Mark</th>
                <th scope="col">Readings</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((point) => (
                <tr key={point.bucketStart}>
                  <td>{formatBucket(new Date(point.bucketStart).getTime())}</td>
                  <td>{signedPct(point.premiumAvg)}</td>
                  <td>{signedPct(point.premiumMin)} to {signedPct(point.premiumMax)}</td>
                  <td>{money(point.tokenPriceAvg)}</td>
                  <td>{money(point.markPriceAvg)}</td>
                  <td>{point.readings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </section>
  );
}
