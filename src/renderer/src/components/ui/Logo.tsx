/** Three nodes joined by a looping thread — the "skein". */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 6c6 0 6 12 14 12M5 18c6 0 6-12 14-12"
        stroke="rgb(var(--c-accent))"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="5" cy="6" r="2.4" fill="rgb(var(--c-accent))" />
      <circle cx="19" cy="18" r="2.4" fill="rgb(var(--c-loop))" />
      <circle cx="19" cy="6" r="2.4" fill="rgb(var(--c-fg))" />
      <circle cx="5" cy="18" r="2.4" fill="rgb(var(--c-fg) / 0.5)" />
    </svg>
  )
}
