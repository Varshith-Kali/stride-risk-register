/**
 * Custom STRIDE GPT brand mark.
 * A monolithic "S" monogram built on a grid — three diagonal bands
 * forming a shield silhouette. Drawn as crisp SVG geometry, not an
 * AI-generated illustration.
 */
export function BrandMark({
  className = "w-7 h-7",
  mono = false,
}: {
  className?: string;
  mono?: boolean;
}) {
  const fill = mono ? "#fff" : "currentColor";
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Shield outline */}
      <path
        d="M16 2.5 L28 6.5 V15 C28 22 22.5 27.2 16 29.5 C9.5 27.2 4 22 4 15 V6.5 Z"
        stroke={fill}
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
      />
      {/* S monogram — three diagonal strokes */}
      <path
        d="M20 11.2 C20 9.4 18.3 8.3 16 8.3 C13.7 8.3 12 9.4 12 11.2 C12 12.9 13.6 13.6 16 14.1 C18.4 14.6 20 15.3 20 17 C20 18.8 18.3 19.9 16 19.9 C13.7 19.9 12 18.8 12 17"
        stroke={fill}
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
