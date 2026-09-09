/**
 * One slider from an hour out to two weeks out. The near end is fine and the
 * far end coarse: quarter hours for the first six hours, half hours for the
 * rest of the day, whole hours after that. Every stop is a round time, so the
 * readout says exactly when trading stops.
 */

import { useMemo } from "react";

const QUARTER = 15 * 60;
const HOUR = 3600;

/** Every time the slider can land on, ascending, all inside [min, max]. */
export function timeStops(min: number, max: number): number[] {
  const stops: number[] = [];
  const grains: { until: number; grain: number }[] = [
    { until: min + 6 * HOUR, grain: QUARTER },
    { until: min + 24 * HOUR, grain: 2 * QUARTER },
    { until: max, grain: HOUR },
  ];
  let t = min;
  for (const { until, grain } of grains) {
    t = Math.ceil(t / grain) * grain;
    while (t <= Math.min(until, max)) {
      if (stops[stops.length - 1] !== t) stops.push(t);
      t += grain;
    }
  }
  return stops;
}

/** In the presets' words: "3 days 5 hours", "5 hours 30 min", "45 min". */
export function formatSpan(secs: number): string {
  const s = Math.max(0, secs);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.round((s % 3600) / 60);
  const days = `${d} day${d === 1 ? "" : "s"}`;
  const hours = `${h} hour${h === 1 ? "" : "s"}`;
  if (d > 0) return h > 0 ? `${days} ${hours}` : days;
  if (h > 0) return m > 0 ? `${hours} ${m} min` : hours;
  return `${m} min`;
}

function nearest(stops: number[], value: number): number {
  let best = 0;
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i] - value) < Math.abs(stops[best] - value)) best = i;
  }
  return best;
}

export function TimeSlider({
  value,
  onChange,
  min,
  max,
}: {
  /** The current time, unix seconds; snapped to the nearest stop for display. */
  value: number;
  onChange: (ts: number) => void;
  min: number;
  max: number;
}) {
  const stops = useMemo(() => timeStops(min, max), [min, max]);
  const index = nearest(stops, value);
  const fill = stops.length > 1 ? (index / (stops.length - 1)) * 100 : 0;
  return (
    <div>
      <input
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(stops[Number(e.target.value)])}
        aria-label="When trading stops"
        className="slider"
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
      />
      <div className="mono mt-2 flex justify-between text-xs text-neutral-400">
        <span>1 hour</span>
        <span>2 weeks</span>
      </div>
    </div>
  );
}
