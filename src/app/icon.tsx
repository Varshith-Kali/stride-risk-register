import { ImageResponse } from "next/og";

// Favicon: shield outline with three register lines (sibling of the STRIDE GPT mark).
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <path
            d="M16 2.5 L28 6.5 V15 C28 22 22.5 27.2 16 29.5 C9.5 27.2 4 22 4 15 V6.5 Z"
            stroke="#181818"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <line x1="10.5" y1="12.5" x2="21.5" y2="12.5" stroke="#181818" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="10.5" y1="16" x2="21.5" y2="16" stroke="#181818" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="10.5" y1="19.5" x2="18" y2="19.5" stroke="#181818" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
