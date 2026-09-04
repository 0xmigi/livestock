/** A narrative's image, or its initial on a soft tile while none is set. */
export function Thumb({
  src,
  name,
  size = 40,
  shape = "circle",
  className = "",
}: {
  src?: string;
  name: string;
  size?: number;
  shape?: "circle" | "square";
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const radius = shape === "circle" ? "rounded-full" : "rounded-xl";
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-neutral-100 font-semibold text-neutral-400 ${radius} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  );
}
