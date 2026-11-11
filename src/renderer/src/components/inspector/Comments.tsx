import { Check, CornerDownRight, MessageSquare, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { threadsOf, type Thread } from '@shared/comments'
import type { NodeComment, Project } from '@shared/schema'
import { cx } from '../../lib/cx'
import { useAuthor } from '../../store/author'
import { addComment, deleteComment, editComment, resolveThread } from '../../store/ops'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { TextInput } from '../ui/fields'

/**
 * Comment threads on a node, for the team. They're kept in the flow's file,
 * so they travel with the project through git like everything else, and
 * they're never exported to the game.
 */
export function Comments({ project, flowId, nodeId }: { project: Project; flowId: string; nodeId: string }) {
  const threads = threadsOf(project.flows[flowId], nodeId)
  const author = useAuthor((s) => s.name)
  const [showResolved, setShowResolved] = useState(false)
  const open = threads.filter((t) => !t.root.resolved)
  const resolved = threads.length - open.length
  const shown = showResolved ? threads : open

  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
        <MessageSquare size={11} /> Comments
        {resolved > 0 && (
          <button type="button" className="ml-auto font-normal normal-case tracking-normal text-accent hover:underline" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? 'Hide resolved' : `Show ${resolved} resolved`}
          </button>
        )}
      </h3>
      <div className="flex flex-col gap-2">
        {shown.map((t) => (
          <ThreadView key={t.root.id} flowId={flowId} nodeId={nodeId} thread={t} author={author} />
        ))}
        {author ? (
          <Composer placeholder={threads.length ? 'Start another thread…' : 'Leave a comment for the team…'} onSend={(text) => addComment(flowId, nodeId, text, author)} />
        ) : (
          <NameFirst />
        )}
      </div>
    </section>
  )
}

function ThreadView({ flowId, nodeId, thread, author }: { flowId: string; nodeId: string; thread: Thread; author: string }) {
  const [replying, setReplying] = useState(false)
  const done = thread.root.resolved === true
  return (
    <div className={cx('rounded-lg border p-2', done ? 'border-line/60 bg-bg/20 opacity-70' : 'border-accent/30 bg-accent/5')}>
      <CommentView flowId={flowId} comment={thread.root} />
      {thread.replies.map((r) => (
        <div key={r.id} className="mt-1.5 flex gap-1.5 border-t border-line/50 pt-1.5">
          <CornerDownRight size={11} className="mt-0.5 shrink-0 text-faint" />
          <div className="min-w-0 flex-1">
            <CommentView flowId={flowId} comment={r} />
          </div>
        </div>
      ))}
      <div className="mt-1.5 flex items-center gap-1">
        {!done && author && !replying && (
          <Button variant="ghost" onClick={() => setReplying(true)}>
            Reply
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="ghost" icon={done ? RotateCcw : Check} onClick={() => resolveThread(flowId, thread.root.id, !done)}>
          {done ? 'Reopen' : 'Resolve'}
        </Button>
      </div>
      {replying && (
        <div className="mt-1">
          <Composer
            autoFocus
            placeholder="Reply…"
            onSend={(text) => {
              addComment(flowId, nodeId, text, author, thread.root.id)
              setReplying(false)
            }}
            onCancel={() => setReplying(false)}
          />
        </div>
      )}
    </div>
  )
}

function CommentView({ flowId, comment: c }: { flowId: string; comment: NodeComment }) {
  const [editing, setEditing] = useState(false)
  const remove = async () => {
    const thread = !c.parentId
    const ok = await window.api.confirm({
      message: thread ? 'Delete this comment and its replies?' : 'Delete this reply?',
      detail: 'You can undo this with Ctrl+Z.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (ok) deleteComment(flowId, c.id)
  }
  return (
    <div className="group">
      <div className="flex items-baseline gap-1.5 text-2xs">
        <span className="font-semibold text-fg">{c.author || 'Someone'}</span>
        <span className="text-faint" title={c.createdAt}>
          {when(c.createdAt)}
        </span>
        <div className="flex-1" />
        <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconButton size="sm" icon={Trash2} tone="danger" label="Delete" onClick={remove} />
        </span>
      </div>
      {editing ? (
        <TextInput
          value={c.text}
          autoFocus
          required
          onCommit={(text) => {
            editComment(flowId, c.id, text)
            setEditing(false)
          }}
        />
      ) : (
        <p className="cursor-text whitespace-pre-wrap text-xs leading-relaxed text-muted" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
          {c.text}
        </p>
      )}
    </div>
  )
}

function Composer({ placeholder, onSend, onCancel, autoFocus }: { placeholder: string; onSend(text: string): void; onCancel?(): void; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const send = () => {
    if (!text.trim()) return
    onSend(text)
    setText('')
  }
  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={text}
        rows={2}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl/Cmd+Enter sends; Escape cancels a reply.
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            send()
          } else if (e.key === 'Escape' && onCancel) onCancel()
        }}
        className="w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 text-xs leading-relaxed text-fg outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/25"
      />
      {(text.trim() || onCancel) && (
        <div className="flex items-center justify-end gap-1">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button variant="primary" disabled={!text.trim()} onClick={send}>
            Comment
          </Button>
        </div>
      )}
    </div>
  )
}

/** Comments are signed with a name kept on this machine: ask for it before the first one. */
function NameFirst() {
  const setName = useAuthor((s) => s.setName)
  return (
    <div className="rounded-lg border border-dashed border-line p-2">
      <p className="mb-1.5 text-2xs leading-relaxed text-faint">Your name signs your comments. It stays on this computer: Skein has no accounts.</p>
      <TextInput value="" placeholder="Your name" onCommit={(n) => n && setName(n)} />
    </div>
  )
}

/** "3 Nov", or "3 Nov 2025" in another year, or "today 14:05". */
function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `today ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }
  return d.toLocaleDateString(undefined, opts)
}
