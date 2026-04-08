import React from "react";

export default function DockiumLogo({ className = "", title = "Dockium logo" }) {
  return (
    <svg
      className={className}
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <rect x="18" y="18" width="28" height="28" rx="8" stroke="#1F2937" strokeWidth="2" />
      <rect x="23" y="23" width="5" height="5" fill="#60A5FA" />
      <rect x="30" y="23" width="5" height="5" fill="#60A5FA" />
      <rect x="23" y="30" width="5" height="5" fill="#60A5FA" />
      <path
        d="M28 36L32 40L40 32"
        stroke="#2563EB"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}