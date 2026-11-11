import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

/** A test's status, as an icon. */
export function TestStatusIcon({ status, size = 13 }: { status: 'pass' | 'fail' | 'broken' | 'pending'; size?: number }) {
  if (status === 'pass') return <CheckCircle2 size={size} className="shrink-0 text-ok" aria-label="Passing" />
  if (status === 'fail') return <XCircle size={size} className="shrink-0 text-danger" aria-label="Failing" />
  if (status === 'broken') return <AlertTriangle size={size} className="shrink-0 text-warn" aria-label="Can't run" />
  return <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-line" aria-label="Checking" />
}
