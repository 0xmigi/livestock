/**
 * A narrative's image, or its initial on a tinted tile while none is set. The
 * tint is derived from the name so the same narrative always looks the same.
 */
export function Thumb({
  src,
  name,
  size = 40,
  shape = "square",
  className = "",
}: {
  src?: string;
  name: string;
  size?: number;
  shape?: "circle" | "square";
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const radius = shape === "circle" ? "rounded-full" : "rounded";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white ${radius} ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: src
          ? undefined
          : `linear-gradient(135deg, hsl(${hue} 38% 42%), hsl(${(hue + 40) % 360} 38% 30%))`,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className="h-full w-full object-cover" />
      ) : (
        initial
      )}
    </span>
  );
}
