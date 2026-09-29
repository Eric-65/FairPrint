"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export interface CurvePoint {
  raisedUsd: number;
  priceUsd: number;
}

const HEIGHT = 260;
const MARGIN = { top: 18, right: 16, bottom: 30, left: 60 };

function usd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `$${(value / 1_000).toFixed(0)}k`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(3)}`;
}

function signedPct(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}

function niceTicks(min: number, max: number, count: number) {
  const step = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const nice = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= step) ?? step;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / nice) * nice; tick <= max + nice * 1e-9; tick += nice) ticks.push(tick);
  return ticks;
}

// Price along the bonding curve against dollars raised, with the fair-value
// corridor shaded so an issuer sees where price discovery is meant to settle.
export function CurveChart({ points, fairUsd, corridorPct, label }: {
  points: CurvePoint[];
  fairUsd: number;
  corridorPct: number;
  label: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const chart = useMemo(() => {
    if (points.length < 2 || width === 0) return null;
    const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const maxRaised = points.at(-1)!.raisedUsd;
    const prices = points.map((point) => point.priceUsd);
    const yMin = Math.min(...prices) * 0.98;
    const yMax = Math.max(...prices) * 1.02;
    const xOf = (raised: number) => MARGIN.left + (raised / maxRaised) * plotWidth;
    const yOf = (price: number) => MARGIN.top + ((yMax - price) / (yMax - yMin)) * plotHeight;
    const line = points.map((point, index) => `${index ? "L" : "M"}${xOf(point.raisedUsd).toFixed(1)},${yOf(point.priceUsd).toFixed(1)}`).join("");
    return {
      plotWidth,
      plotHeight,
      xOf,
      yOf,
      line,
      yTicks: niceTicks(yMin, yMax, 4),
      xTicks: niceTicks(0, maxRaised, width < 480 ? 3 : 5),
      corridorTop: yOf(fairUsd * (1 + corridorPct / 100)),
      corridorBottom: yOf(fairUsd * (1 - corridorPct / 100)),
    };
  }, [points, width, fairUsd, corridorPct]);

  function nearestIndex(clientX: number, target: SVGRectElement) {
    if (!chart) return null;
    const x = clientX - target.getBoundingClientRect().left + MARGIN.left;
    let best = 0;
    for (let index = 1; index < points.length; index += 1) {
      if (Math.abs(chart.xOf(points[index].raisedUsd) - x) < Math.abs(chart.xOf(points[best].raisedUsd) - x)) best = index;
    }
    return best;
  }

  function onKeyDown(event: KeyboardEvent<SVGRectElement>) {
    if (event.key === "ArrowLeft") setHoverIndex((index) => Math.max(0, (index ?? points.length) - 1));
    else if (event.key === "ArrowRight") setHoverIndex((index) => Math.min(points.length - 1, (index ?? -1) + 1));
    else if (event.key === "Escape") setHoverIndex(null);
    else return;
    event.preventDefault();
  }

  const readout = points[hoverIndex ?? points.length - 1];

  return (
    <div className="premium-history curve-chart">
      {readout ? (
        <div className="premium-history__readout" aria-live="polite">
          <strong><i aria-hidden="true" />{usd(readout.priceUsd)}</strong>
          <span>
            {hoverIndex === null ? "At graduation" : `After ${usd(readout.raisedUsd)} raised`} ·{" "}
            {signedPct(((readout.priceUsd - fairUsd) / fairUsd) * 100)} vs fair value {usd(fairUsd)}
          </span>
        </div>
      ) : null}
      <div className="premium-history__frame" ref={frameRef}>
        {chart ? (
          <svg width={width} height={HEIGHT} role="group" aria-label={`${label}. Use arrow keys to read values.`}>
            <rect
              className="curve-chart__corridor"
              x={MARGIN.left}
              width={chart.plotWidth}
              y={chart.corridorTop}
              height={Math.max(1, chart.corridorBottom - chart.corridorTop)}
            />
            {chart.yTicks.map((tick) => (
              <g key={tick}>
                <line className="premium-history__grid" x1={MARGIN.left} x2={MARGIN.left + chart.plotWidth} y1={chart.yOf(tick)} y2={chart.yOf(tick)} />
                <text className="premium-history__tick" x={MARGIN.left - 8} y={chart.yOf(tick)} textAnchor="end" dominantBaseline="middle">
                  {usd(tick)}
                </text>
              </g>
            ))}
            <line className="premium-history__mark" x1={MARGIN.left} x2={MARGIN.left + chart.plotWidth} y1={chart.yOf(fairUsd)} y2={chart.yOf(fairUsd)} />
            <text className="premium-history__mark-label" x={MARGIN.left + 6} y={chart.corridorTop - 5}>
              Fair-value corridor ±{corridorPct}%
            </text>
            {chart.xTicks.map((tick) => (
              <text key={tick} className="premium-history__tick" x={chart.xOf(tick)} y={HEIGHT - 8} textAnchor="middle">
                {usd(tick)}
              </text>
            ))}
            <path className="premium-history__line" d={chart.line} />
            {readout ? (
              <>
                {hoverIndex !== null ? (
                  <line
                    className="premium-history__crosshair"
                    x1={chart.xOf(readout.raisedUsd)}
                    x2={chart.xOf(readout.raisedUsd)}
                    y1={MARGIN.top}
                    y2={MARGIN.top + chart.plotHeight}
                  />
                ) : null}
                <circle className="premium-history__dot" cx={chart.xOf(readout.raisedUsd)} cy={chart.yOf(readout.priceUsd)} r={4} />
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
              onBlur={() => setHoverIndex(null)}
              onKeyDown={onKeyDown}
            />
          </svg>
        ) : null}
      </div>
      <p className="curve-chart__axis">Horizontal: dollars raised on the curve · Vertical: token price in USD at the real share price</p>
    </div>
  );
}
