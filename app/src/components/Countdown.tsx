"use client";

import { useEffect, useState } from "react";

export function Countdown({ endTs }: { endTs: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, endTs - now);
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (left === 0) {
    return <span className="font-mono text-rust">expired</span>;
  }
  return (
    <span className="font-mono tabular-nums text-gold">
      {h > 0 ? `${h}:` : ""}
      {pad(m)}:{pad(s)}
    </span>
  );
}
