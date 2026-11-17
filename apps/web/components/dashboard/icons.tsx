import type { ReactNode } from "react";

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export const ArrowRight = () => (
  <Svg size={18}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const CheckMark = () => (
  <Svg size={14}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

export const CrossMark = () => (
  <Svg size={14}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const DotMark = () => (
  <Svg size={14}>
    <circle cx="12" cy="12" r="3" fill="currentColor" />
  </Svg>
);

export const DashMark = () => (
  <Svg size={14}>
    <path d="M7 12h10" />
  </Svg>
);

export const TodayMark = () => (
  <Svg size={14}>
    <circle cx="12" cy="12" r="6" />
  </Svg>
);

export const Shield = () => (
  <Svg size={20}>
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
  </Svg>
);
