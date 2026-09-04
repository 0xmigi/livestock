/**
 * The Livestock mark: a single rising stroke, drawn the way Moment's mark is —
 * one path, round caps, `currentColor` so it takes the text colour around it.
 */
export function Logo({
  width = 30,
  height = 21,
  className = "",
}: {
  width?: number;
  height?: number;
  className?: string;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 39 27"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M3.5 22.5 L11 13.5 L17.5 18.5 L27 6.5 L30.5 11 L35.5 4"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <Logo className="text-neutral-900" />
      <span className="text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">
        Livestock
      </span>
    </span>
  );
}
