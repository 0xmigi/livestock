"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";

type MarkProps = { size?: number; className?: string };
type Palette = "ink" | "market" | "cream";

const PALETTES: Record<Palette, CSSProperties> = {
  ink: {
    "--logo-bg": "#f4f1e9",
    "--logo-ink": "#171716",
    "--logo-up": "#171716",
    "--logo-down": "#171716",
  } as CSSProperties,
  market: {
    "--logo-bg": "#f4f1e9",
    "--logo-ink": "#171716",
    "--logo-up": "#07885b",
    "--logo-down": "#e3482f",
  } as CSSProperties,
  cream: {
    "--logo-bg": "#171716",
    "--logo-ink": "#f4f1e9",
    "--logo-up": "#f4f1e9",
    "--logo-down": "#f4f1e9",
  } as CSSProperties,
};

function Svg({
  size = 128,
  className = "",
  children,
}: MarkProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type EyeTreatment = "contour" | "low-slit" | "open-socket";

function EyeSockets({ treatment }: { treatment: EyeTreatment }) {
  if (treatment === "low-slit") {
    return (
      <>
        <path fill="#000" d="M24 39c7-4 16-4 23 0v5c-8-2-15-1-21 2l-2-7Z" />
        <path fill="#000" d="M80 39c-7-4-16-4-23 0v5c8-2 15-1 21 2l2-7Z" />
      </>
    );
  }

  if (treatment === "open-socket") {
    return (
      <>
        <path fill="#000" d="M23 36c7-5 17-4 24 2v8c-7-3-14-3-20 1-4-3-6-7-4-11Z" />
        <path fill="#000" d="M81 36c-7-5-17-4-24 2v8c7-3 14-3 20 1 4-3 6-7 4-11Z" />
      </>
    );
  }

  return (
    <>
      <path
        fill="#000"
        d="M49 34c-9-4-19-3-25 2-4 4-3 9 2 12 9 1 18 6 22 12 4 7 2 13-3 18l-11 8c-3 2-2 5 1 6 5 2 10 2 14 0V34Z"
      />
      <path
        fill="#000"
        d="M55 34c9-4 19-3 25 2 4 4 3 9-2 12-9 1-18 6-22 12-4 7-2 13 3 18l11 8c3 2 2 5-1 6-5 2-10 2-14 0V34Z"
      />
    </>
  );
}

/** Two balanced half-faces, separated by a deliberate centre gap. */
function BullBearMark({
  size,
  className,
  eyes = "contour",
}: MarkProps & { eyes?: EyeTreatment }) {
  const maskId = `bull-bear-${useId().replace(/:/g, "")}`;

  return (
    <Svg size={size} className={className}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          <EyeSockets treatment={eyes} />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        {/* Bull: long horn, pointed ear, low brow and square jaw. */}
        <path
          fill="var(--logo-up)"
          d="M49 18c-9-1-18 2-25 8C15 25 8 18 5 8 1 17 3 27 10 34l9 6-11 3c-4 1-4 5 0 7l10 6v16c0 13 10 21 24 21h7V18Z"
        />
        {/* Bear: round ear, high forehead and round cheek. */}
        <path
          fill="var(--logo-down)"
          d="M55 19c7-3 14-3 20 1 3-5 8-7 14-5 8 2 11 12 7 19-2 4-5 7-10 8 2 5 3 12 3 20v10c0 13-10 21-24 21H55V19Z"
        />
      </g>
    </Svg>
  );
}

function BullBear(props: MarkProps) {
  return <BullBearMark {...props} />;
}

/** A cow and pig reduced to two overlapping, sticker-like heads. */
function Herd({ size, className }: MarkProps) {
  return (
    <Svg size={size} className={className}>
      <path
        fill="var(--logo-down)"
        d="M58 21c-5-8-2-14 1-17 7 1 12 7 13 14 10 1 18 9 18 20v22c0 13-10 23-23 23S44 73 44 60V38c0-7 3-13 8-17h6Zm20 23a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
      />
      <path
        stroke="var(--logo-bg)"
        strokeWidth="7"
        strokeLinejoin="round"
        fill="var(--logo-up)"
        d="M39 31c-9-1-18 2-25 8-5 4-8 1-7-4 1-7 7-13 15-15-2-8 2-14 7-17 5 5 8 10 8 16h7c0-6 3-11 8-16 5 3 9 9 7 17 8 2 14 8 15 15 1 5-2 8-7 4-7-6-16-9-25-8h-3Zm2 9c-13 0-23 10-23 23s10 23 23 23 23-10 23-23-10-23-23-23Zm-10 9a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"
      />
    </Svg>
  );
}

/** A livestock ear tag, with the expiration cut into its centre. */
function ExpiryTag({ size, className }: MarkProps) {
  return (
    <Svg size={size} className={className}>
      <path
        fill="var(--logo-ink)"
        fillRule="evenodd"
        d="M27 8h46l16 25-9 59H20l-9-59L27 8Zm23 13a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 23a20 20 0 1 0 0 40 20 20 0 0 0 0-40Zm3 7v13l10 6-4 6-14-9V51h8Z"
        clipRule="evenodd"
      />
    </Svg>
  );
}

/** Three soft animal backs become a rising market chart. */
function PastureChart({ size, className }: MarkProps) {
  return (
    <Svg size={size} className={className}>
      <path
        fill="var(--logo-ink)"
        d="M7 78V63c0-10 8-18 18-18h6V34c0-10 8-18 18-18h6v13h2V18c0-7 5-12 12-12s12 5 12 12v11h4c5 0 9 4 9 9v40H7Z"
      />
      <path
        stroke="var(--logo-bg)"
        strokeWidth="6"
        strokeLinecap="round"
        d="M12 89h77"
      />
      <path stroke="var(--logo-ink)" strokeWidth="8" strokeLinecap="round" d="M21 75v17M49 75v17M77 75v17" />
    </Svg>
  );
}

/** A cow bell doubles as an analog countdown. */
function BellClock({ size, className }: MarkProps) {
  return (
    <Svg size={size} className={className}>
      <path
        fill="var(--logo-ink)"
        fillRule="evenodd"
        d="M39 5h22l4 14c11 5 18 16 20 31l6 35H9l6-35c2-15 9-26 20-31l4-14Zm11 30a19 19 0 1 0 0 38 19 19 0 0 0 0-38Zm4 7v10l8 8-6 6-11-11V42h9Z"
        clipRule="evenodd"
      />
      <path fill="var(--logo-ink)" d="M38 89h24c-2 7-6 10-12 10s-10-3-12-10Z" />
    </Svg>
  );
}

/** A bull's horns frame a single candlestick. */
function HornCandle({ size, className }: MarkProps) {
  return (
    <Svg size={size} className={className}>
      <path
        fill="var(--logo-ink)"
        d="M43 25C27 25 15 17 9 5 3 13 3 24 9 34c6 10 18 17 34 17v31H30v12h40V82H57V51c16 0 28-7 34-17 6-10 6-21 0-29-6 12-18 20-34 20H43Z"
      />
    </Svg>
  );
}

/** Two opposing livestock horns create a compact L/S-like loop. */
function HornLoop({ size, className }: MarkProps) {
  return (
    <Svg size={size} className={className}>
      <path
        stroke="var(--logo-ink)"
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M76 18H43c-16 0-27 9-27 22s10 20 27 20h14c17 0 27 7 27 20S73 96 57 96H24"
      />
      <path fill="var(--logo-ink)" d="M75 9 97 18 75 27V9ZM25 87 3 96l22 9V87Z" />
    </Svg>
  );
}

/** A split hoof becomes opposing up/down market arrows. */
function HoofArrows({ size, className }: MarkProps) {
  return (
    <Svg size={size} className={className}>
      <path fill="var(--logo-up)" d="m47 8-9 12v31L8 81c7 8 16 13 27 13 7 0 12-5 12-12V8Z" />
      <path fill="var(--logo-down)" d="m53 92 9-12V49l30-30C85 11 76 6 65 6c-7 0-12 5-12 12v74Z" />
    </Svg>
  );
}

type Concept = {
  id: string;
  name: string;
  thought: string;
  Mark: (props: MarkProps) => ReactNode;
  recommended?: boolean;
};

const CONCEPTS: Concept[] = [
  {
    id: "bull-bear",
    name: "Bull / Bear",
    thought: "Two balanced half-faces: angular bull, round bear, separated by a deliberate gap.",
    Mark: BullBear,
    recommended: true,
  },
  {
    id: "herd",
    name: "The Herd",
    thought: "Cow + pig as one compact sticker. Friendliest and closest to the Livestock pun.",
    Mark: Herd,
  },
  {
    id: "tag",
    name: "Expiry Tag",
    thought: "A livestock tag with a clock cutout. Strong silhouette; the cleverness appears second.",
    Mark: ExpiryTag,
  },
  {
    id: "pasture",
    name: "Pasture Chart",
    thought: "Soft animal backs meet candlesticks. Simple, abstract and slightly playful.",
    Mark: PastureChart,
  },
  {
    id: "bell",
    name: "Closing Bell",
    thought: "Farm bell + closing bell + countdown. The most traditional financial direction.",
    Mark: BellClock,
  },
  {
    id: "candle",
    name: "Horn Candle",
    thought: "One candlestick framed by bull horns. Very legible, but more bullish than neutral.",
    Mark: HornCandle,
  },
  {
    id: "loop",
    name: "Horn Loop",
    thought: "Opposing horns form an abstract LS. Premium and ownable without being literal.",
    Mark: HornLoop,
  },
  {
    id: "hoof",
    name: "Hoof / Arrows",
    thought: "A split hoof becomes up and down arrows. Strong at tiny sizes and works in two colors.",
    Mark: HoofArrows,
  },
];

function ConceptCard({
  concept,
  selected,
  onSelect,
}: {
  concept: Concept;
  selected: boolean;
  onSelect: () => void;
}) {
  const { Mark } = concept;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group overflow-hidden rounded-lg text-left transition-all ${
        selected ? "ring-2 ring-accent ring-offset-2 ring-offset-[var(--logo-bg)]" : "hover:-translate-y-0.5"
      }`}
    >
      <div className="flex min-h-64 items-center justify-center bg-[var(--logo-bg)] p-8 text-[var(--logo-ink)]">
        <Mark size={150} />
      </div>
      <div className="bg-neutral-50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="text-[15px] font-semibold text-neutral-900">{concept.name}</div>
          {concept.recommended ? (
            <span className="mono rounded bg-accent-light px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-accent">
              Start here
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 min-h-10 text-xs leading-relaxed text-neutral-400">{concept.thought}</p>
        <div className="mt-4 flex items-center gap-3 border-t border-neutral-100 pt-3">
          <Mark size={24} />
          <Mark size={32} />
          <div className="ml-auto flex items-center gap-2 rounded bg-neutral-100 px-2.5 py-1.5">
            <Mark size={22} />
            <span className="text-xs font-semibold text-neutral-900">Livestock</span>
            <span className="mono text-[9px] text-live">LIVE</span>
          </div>
        </div>
      </div>
    </button>
  );
}

export default function LogoWorkbench() {
  const [palette, setPalette] = useState<Palette>("ink");
  const [selected, setSelected] = useState("bull-bear");
  const [eyes, setEyes] = useState<EyeTreatment>("contour");
  const concept = CONCEPTS.find((item) => item.id === selected) ?? CONCEPTS[0];
  const SelectedMark = concept.Mark;
  const selectedMark = (size: number) =>
    concept.id === "bull-bear" ? <BullBearMark size={size} eyes={eyes} /> : <SelectedMark size={size} />;

  return (
    <main
      className="min-h-screen bg-[var(--logo-bg)] px-5 py-10 text-[var(--logo-ink)] sm:px-8 sm:py-14"
      style={PALETTES[palette]}
    >
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-7 border-b border-current/15 pb-9 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="mono text-[10px] font-semibold uppercase tracking-[0.24em] opacity-50">Livestock identity study · 01</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">One idea. One silhouette.</h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed opacity-60 sm:text-base">
              Eight compact marks designed to survive a ticker row, social avatar and monochrome print. Click one to inspect it.
            </p>
          </div>
          <div className="flex rounded-full bg-current/8 p-1">
            {(
              [
                ["ink", "Black"],
                ["market", "Market"],
                ["cream", "Reverse"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPalette(value)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  palette === value ? "bg-[var(--logo-ink)] text-[var(--logo-bg)]" : "opacity-50 hover:opacity-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <section className="grid gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center lg:gap-16 lg:py-16">
          <div className="flex min-h-[360px] items-center justify-center rounded-[28px] bg-current/[0.045]">
            {selectedMark(280)}
          </div>
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.22em] opacity-45">Selected direction</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">{concept.name}</h2>
            <p className="mt-3 text-sm leading-relaxed opacity-60">{concept.thought}</p>
            {concept.id === "bull-bear" ? (
              <div className="mt-6">
                <div className="mono mb-2 text-[9px] uppercase tracking-[0.18em] opacity-40">Eye treatment</div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["contour", "Contour"],
                      ["low-slit", "Low slit"],
                      ["open-socket", "Open socket"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setEyes(value)}
                      aria-pressed={eyes === value}
                      className={`flex flex-col items-center gap-1.5 rounded-lg p-2 text-[9px] transition ${
                        eyes === value ? "bg-current/10 ring-1 ring-current/20" : "bg-current/[0.045] hover:bg-current/[0.07]"
                      }`}
                    >
                      <BullBearMark size={46} eyes={value} />
                      <span className="opacity-55">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-4 rounded-xl bg-current/[0.045] p-4">
                {selectedMark(36)}
                <div className="text-xl font-semibold tracking-[-0.035em]">livestock</div>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-current/[0.045] p-3">
                {selectedMark(28)}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">AI takes every job</div>
                  <div className="mono mt-0.5 text-[9px] opacity-45">$AIDOOM / NVDA</div>
                </div>
                <div className="mono text-right text-xs font-semibold">$0.043</div>
              </div>
              <div className="flex items-center gap-3 pt-2">
                {[48, 32, 24, 16].map((size) => (
                  <div key={size} className="flex flex-col items-center gap-1.5">
                    {selectedMark(size)}
                    <span className="mono text-[8px] opacity-35">{size}</span>
                  </div>
                ))}
                <div
                  className="ml-auto rounded-full bg-[var(--logo-ink)] p-3"
                  style={
                    {
                      "--logo-up": "var(--logo-bg)",
                      "--logo-down": "var(--logo-bg)",
                    } as CSSProperties
                  }
                >
                  {selectedMark(38)}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-t border-current/15 pb-5 pt-7">
            <h2 className="text-lg font-semibold">Directions</h2>
            <span className="mono text-[10px] opacity-40">8 OPTIONS</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CONCEPTS.map((item) => (
              <ConceptCard
                key={item.id}
                concept={item}
                selected={selected === item.id}
                onSelect={() => setSelected(item.id)}
              />
            ))}
          </div>
        </section>

        <footer className="mt-12 flex flex-col gap-2 border-t border-current/15 py-6 text-xs opacity-45 sm:flex-row sm:justify-between">
          <span>Judge the 16px version before the poster version.</span>
          <span className="mono">BLACK FIRST · COLOR SECOND</span>
        </footer>
      </div>
    </main>
  );
}
