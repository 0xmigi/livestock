"use client";

/**
 * Logo workbench. Not linked from anywhere: /logo shows the mark big, on
 * both grounds and at real sizes, next to a few variants, so it can be
 * judged and tweaked without squinting at the header. Edit the variants
 * below, or the animals in components/logo.tsx, and watch it reload.
 */

import { Cow, Pig, Logo, MARK_VIEWBOX, type AnimalProps } from "@/components/logo";

type Variant = { name: string; back: AnimalProps; front: AnimalProps; frontIs: "cow" | "pig" };

const CURRENT: Variant = {
  name: "Current",
  back: { x: 19, y: 1, tilt: 8 },
  front: { x: 0, y: 17, tilt: -6 },
  frontIs: "cow",
};

const VARIANTS: Variant[] = [
  CURRENT,
  { ...CURRENT, name: "More tilt", back: { ...CURRENT.back, tilt: 16 }, front: { ...CURRENT.front, tilt: -14 } },
  { ...CURRENT, name: "No tilt", back: { ...CURRENT.back, tilt: 0 }, front: { ...CURRENT.front, tilt: 0 } },
  { name: "Pig in front", back: { x: 0, y: 1, tilt: -6 }, front: { x: 19, y: 17, tilt: 8 }, frontIs: "pig" },
  { name: "Side by side", back: { x: 24, y: 9, tilt: 6 }, front: { x: -3, y: 11, tilt: -5 }, frontIs: "cow" },
  { name: "Pig lower", back: { x: 22, y: 9, tilt: 10 }, front: { x: 0, y: 14, tilt: -6 }, frontIs: "cow" },
];

function Mark({ v, size }: { v: Variant; size: number }) {
  const Back = v.frontIs === "cow" ? Pig : Cow;
  const Front = v.frontIs === "cow" ? Cow : Pig;
  return (
    <svg width={size} height={size} viewBox={MARK_VIEWBOX} overflow="visible" aria-hidden="true">
      <Back {...v.back} />
      <Front {...v.front} knock />
    </svg>
  );
}

const LIGHT = { "--ground": "#ffffff", color: "#1c1c1d" } as React.CSSProperties;
const DARK = { "--ground": "#282828", color: "#f2f1ee" } as React.CSSProperties;

function Ground({ theme, children }: { theme: "light" | "dark"; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-center gap-10 rounded p-8"
      style={{ ...(theme === "light" ? LIGHT : DARK), background: "var(--ground)" }}
    >
      {children}
    </div>
  );
}

export default function LogoWorkbench() {
  return (
    <main className="mx-auto max-w-5xl space-y-10 px-6 py-10">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Logo workbench</h1>
        <p className="mt-1 text-sm text-neutral-400">
          The mark as shipped, big and at real sizes, then variants. Edit <code className="mono">app/logo/page.tsx</code> or{" "}
          <code className="mono">components/logo.tsx</code>.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        <Ground theme="light">
          <Logo size={320} />
        </Ground>
        <Ground theme="dark">
          <Logo size={320} />
        </Ground>
        <Ground theme="light">
          <Logo size={28} />
          <Logo size={40} />
          <Logo size={64} />
          <Logo size={96} />
        </Ground>
        <Ground theme="dark">
          <Logo size={28} />
          <Logo size={40} />
          <Logo size={64} />
          <Logo size={96} />
        </Ground>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-900">Variants</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {VARIANTS.map((v) => (
            <div key={v.name} className="space-y-2">
              <Ground theme="light">
                <Mark v={v} size={160} />
                <div className="flex flex-col items-center gap-3">
                  <Mark v={v} size={28} />
                  <Mark v={v} size={48} />
                </div>
              </Ground>
              <Ground theme="dark">
                <Mark v={v} size={96} />
                <Mark v={v} size={28} />
              </Ground>
              <div className="text-center text-xs text-neutral-400">{v.name}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
