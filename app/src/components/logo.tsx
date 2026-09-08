/**
 * The Livestock mark: a cow and a pig, the pig peering over the cow's
 * shoulder. Livestock, not a cow.
 *
 * Solid silhouettes with the features cut out in the ground colour, so it
 * holds up at 24px. Neither head is face-on: the cow is turned to the left,
 * the pig to the right, so they look away from each other. The cow sits in
 * front and is knocked out of the pig by a halo in the ground colour, so
 * both stay full ink. Both are a bit wrong on purpose: eyes bulging past the
 * outline, the near one huge and the far one small, tiny pupils looking
 * nowhere in particular. Nobody here is looking at the same thing.
 *
 * It is drawn in the ink colour and never takes a semantic colour: blue
 * means action, green means buy, and the brand means neither. Each animal is
 * drawn in its own 30-unit box; the mark composes them in a 50-unit one.
 */

function Eye({ cx, cy, r, px, py }: { cx: number; cy: number; r: number; px: number; py: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="var(--ground)" stroke="currentColor" strokeWidth="1.3" />
      <circle cx={px} cy={py} r={r * 0.36} fill="currentColor" />
    </>
  );
}

/**
 * The cow's outline, in three-quarter view turned to the viewer's left. The
 * near side is the right: the bigger horn, the bigger ear, the bigger eye.
 * Used twice, once as the halo.
 */
function CowSilhouette() {
  return (
    <>
      <path d="M10.5 5.5 Q7.5 2.5 9 -1.5 Q12.5 0 13.5 4 Z" />
      <path d="M21 5 Q25 1.5 24 -3 Q19 -0.5 18 3.5 Z" />
      <path d="M5 11 Q-1 8 -0.5 12 Q1 15 5.5 14 Z" />
      <path d="M26.5 12 Q36 10 35 15.5 Q33 20 25.5 17 Z" />
      <path d="M10 5 Q18 0.5 24.5 5 Q30.5 9.5 28.5 18 Q27 27.5 17.5 29.5 Q9 30.5 3.5 25.5 Q-1 20.5 2 14 Q4 8.5 10 5 Z" />
      <path d="M14 3.6 Q14.5 0 16.5 2.5 Q17.5 -1.5 19 2.5 Q20.5 0.5 20 4 Z" />
      <circle cx="19.5" cy="13.5" r="4.6" />
      <circle cx="8.5" cy="12.5" r="2.7" />
    </>
  );
}

export type AnimalProps = {
  x: number;
  y: number;
  /** Degrees, about the centre of the animal's box. */
  tilt: number;
  /** Draw a halo in the ground colour first, to cut this animal out of whatever is behind it. */
  knock?: boolean;
};

function Halo({ children }: { children: React.ReactNode }) {
  return (
    <g fill="var(--ground)" stroke="var(--ground)" strokeWidth="3.2" strokeLinejoin="round">
      {children}
    </g>
  );
}

export function Cow({ x, y, tilt, knock = false }: AnimalProps) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt} 15 15)`}>
      {knock ? <Halo><CowSilhouette /></Halo> : null}
      <g fill="currentColor">
        <CowSilhouette />
      </g>
      {/* muzzle, swung round to the far side */}
      <path d="M3 19.5 Q9 16 16.5 19.5 Q19.5 23 16 26.5 Q9 29 3.5 26 Q0 23 3 19.5 Z" fill="var(--ground)" />
      <ellipse cx="12.5" cy="23.3" rx="1.3" ry="1.7" transform="rotate(20 12.5 23.3)" fill="currentColor" />
      <ellipse cx="6.5" cy="22.3" rx="0.9" ry="1.3" transform="rotate(-25 6.5 22.3)" fill="currentColor" />
      {/* eyes: the near one huge and looking down-right, the far one small and looking up-left */}
      <Eye cx={19.5} cy={13.5} r={4.6} px={21} py={15} />
      <Eye cx={8.5} cy={12.5} r={2.7} px={7.4} py={11.6} />
    </g>
  );
}

/**
 * The pig's outline, in three-quarter view turned to the viewer's right:
 * a round head, one big ear flopped over the forehead, and the snout as a
 * disc sticking out past the cheek.
 */
function PigSilhouette() {
  return (
    <>
      <path d="M7.5 8.5 Q3.5 3 7 0.5 Q11.5 2 12.5 7 Z" strokeLinejoin="round" />
      <path d="M17 7.5 Q22 -2.5 27.5 1 Q27.5 8 22.5 11 Z" strokeLinejoin="round" />
      <path d="M6.5 8 Q14 1 22 5.5 Q28.5 9.5 28 17.5 Q27.5 26 19.5 29.5 Q10 31 4.5 25 Q-0.5 19 1.5 13 Q3 9.5 6.5 8 Z" />
      <ellipse cx="26.5" cy="20" rx="6" ry="5" />
      <circle cx="19" cy="13" r="4.4" />
      <circle cx="9" cy="12.5" r="2.6" />
    </>
  );
}

export function Pig({ x, y, tilt, knock = false }: AnimalProps) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt} 15 15)`}>
      {knock ? <Halo><PigSilhouette /></Halo> : null}
      <g fill="currentColor">
        <PigSilhouette />
      </g>
      {/* snout disc */}
      <ellipse cx="26.5" cy="20" rx="4.6" ry="3.6" fill="var(--ground)" />
      <ellipse cx="25" cy="20" rx="1" ry="1.6" fill="currentColor" />
      <ellipse cx="28.3" cy="20" rx="1" ry="1.6" fill="currentColor" />
      {/* eyes: the near one huge and looking up-right, the far one small and looking down-left */}
      <Eye cx={19} cy={13} r={4.4} px={20.6} py={12} />
      <Eye cx={9} cy={12.5} r={2.6} px={7.9} py={13.3} />
    </g>
  );
}

/** The box the mark is composed in. Ears and horns poke past it, so the svg is left to overflow. */
export const MARK_VIEWBOX = "-5 -5 62 62";

/**
 * The mark: a bull's head in an 8×8 pixel grid, lit from the top-left.
 * Horns in the top corners, a block of a face, two empty cells for nostrils.
 * Three tones of the brand ochre from the --mark-* variables, tinted per
 * theme rather than faded, so the light cells still read on a dark ground. Picked from a sheet of options on
 * 2026-09-08 ("S2", palette "C4"). The cow and pig above are kept for the /logo
 * workbench and older pages.
 */
const MARK_ROWS = [
  "X......x",
  "X......x",
  ".XXXXXx.",
  ".XXXXxx.",
  ".XXXxxo.",
  "..XXxo..",
  "..X..o..",
  "..xxoo..",
];
const MARK_TONE: Record<string, string> = { X: "var(--mark-1)", x: "var(--mark-2)", o: "var(--mark-3)" };

export function Logo({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const cell = 10;
  const inset = 0.5;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {MARK_ROWS.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "." ? null : (
            <rect
              key={`${x}-${y}`}
              x={x * cell + inset}
              y={y * cell + inset}
              width={cell - inset * 2}
              height={cell - inset * 2}
              rx={1}
              fill={MARK_TONE[c]}
            />
          ),
        ),
      )}
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 text-neutral-900 ${className}`}>
      <Logo size={26} />
      <span className="text-lg font-semibold tracking-tight">Livestock</span>
    </span>
  );
}
