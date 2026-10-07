export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M9 9h8a5 5 0 0 1 0 10h-4v5H9z" fill="#fff" />
      <circle cx="16.5" cy="14" r="1.8" fill="var(--accent)" />
    </svg>
  );
}
