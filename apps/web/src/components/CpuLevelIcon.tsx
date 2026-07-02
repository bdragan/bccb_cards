import type { CpuLevelName } from "../progress/cpu-levels";

export function CpuLevelIcon({
  className = "",
  level,
  testId,
}: {
  className?: string;
  level: CpuLevelName;
  testId?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`cpu-level-icon ${className}`}
      data-level={level}
      data-testid={testId}
    >
      <svg viewBox="0 0 24 24" focusable="false">
        <CpuLevelIconShape level={level} />
      </svg>
    </span>
  );
}

function CpuLevelIconShape({ level }: { level: CpuLevelName }) {
  switch (level) {
    case "Bronze":
      return (
        <>
          <path d="M12 3.1 5.4 5.5v5.7c0 4.4 2.6 7.7 6.6 9.5 4-1.8 6.6-5.1 6.6-9.5V5.5L12 3.1Z" />
          <path d="m8.4 13.1 2.4 2.2 4.9-5.6" />
        </>
      );
    case "Silver":
      return (
        <>
          <path d="M8 3.5h8l-2.2 5.1h-3.6L8 3.5Z" />
          <circle cx="12" cy="14.7" r="5.1" />
          <path d="m10.2 14.5 1.3 1.2 2.7-3" />
        </>
      );
    case "Gold":
      return (
        <path d="m12 3.2 2.3 5 5.5.7-4 3.8 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.8 5.5-.7L12 3.2Z" />
      );
    case "Platinum":
      return (
        <>
          <path d="m12 3.3 7 4v9.4l-7 4-7-4V7.3l7-4Z" />
          <path d="m12 6.5 4.2 2.4v6.2L12 17.5l-4.2-2.4V8.9L12 6.5Z" />
        </>
      );
    case "Diamond":
      return (
        <>
          <path d="M7.2 4.4h9.6l3.4 4.7L12 20 3.8 9.1l3.4-4.7Z" />
          <path d="m7.2 4.4 2.1 4.7L12 4.4l2.7 4.7 2.1-4.7M3.8 9.1h16.4M9.3 9.1 12 20l2.7-10.9" />
        </>
      );
    case "Master":
      return (
        <>
          <path d="M4.3 18.5h15.4l-1.1-9.7-4.2 3.5L12 5.2l-2.4 7.1-4.2-3.5-1.1 9.7Z" />
          <path d="M5.7 21h12.6" />
        </>
      );
    case "Grandmaster":
      return (
        <>
          <path d="M8 4h8v3.4c0 4.6-1.5 7.3-4 8.6-2.5-1.3-4-4-4-8.6V4Z" />
          <path d="M8 6H4.7c.1 3.8 1.3 5.8 4 6.4M16 6h3.3c-.1 3.8-1.3 5.8-4 6.4M12 16v3M8.8 21h6.4" />
        </>
      );
  }
}
