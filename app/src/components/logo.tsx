/**
 * The Livestock mark: two cow faces, one in front of the other. A herd, not a
 * cow. Solid shapes so it reads at 24px; features are cut out in the ground
 * colour. It is drawn in the ink colour and never takes a semantic colour:
 * blue means action, green means buy, and the brand means neither.
 */
function Cow({ x, y, opacity = 1 }: { x: number; y: number; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity={opacity}>
      {/* horns */}
      <path d="M3 5.5C1.5 4.5 1 2.5 1.5 1C3.5 1.5 4.5 3 4.8 4.5Z" fill="currentColor" />
      <path d="M15 5.5C16.5 4.5 17 2.5 16.5 1C14.5 1.5 13.5 3 13.2 4.5Z" fill="currentColor" />
      {/* ears */}
      <ellipse cx="1.6" cy="9" rx="1.8" ry="1.2" fill="currentColor" />
      <ellipse cx="16.4" cy="9" rx="1.8" ry="1.2" fill="currentColor" />
      {/* face */}
      <rect x="3" y="3.5" width="12" height="13.5" rx="5" fill="currentColor" />
      {/* eyes */}
      <circle cx="6.6" cy="8.6" r="1.1" fill="var(--ground)" />
      <circle cx="11.4" cy="8.6" r="1.1" fill="var(--ground)" />
      {/* muzzle */}
      <rect x="5.2" y="11.6" width="7.6" height="4" rx="2" fill="var(--ground)" />
      <circle cx="7.4" cy="13.6" r="0.75" fill="currentColor" />
      <circle cx="10.6" cy="13.6" r="0.75" fill="currentColor" />
    </g>
  );
}

export function Logo({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <Cow x={9.5} y={0.5} opacity={0.45} />
      <Cow x={0.5} y={9.5} />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 text-neutral-900 ${className}`}>
      <Logo className="text-neutral-900" size={28} />
      <span className="text-lg font-semibold tracking-tight">Livestock</span>
    </span>
  );
}
