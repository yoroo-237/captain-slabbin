import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { adminFetch } from './utils/api.js'

// Internal messaging, staff side: customer threads on the left, the open
// conversation on the right. Polls every 10s while open.
export default function AdminInbox() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const [threads, setThreads] = useState(null)
  const [thread, setThread] = useState(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const logRef = useRef(null)

  const loadThreads = () => adminFetch('/admin/messages').then(d => setThreads(d.threads)).catch(e => setError(e.message))
  const loadThread = id => adminFetch(`/admin/messages/${id}`).then(setThread).catch(e => setError(e.message))

  useEffect(() => {
    loadThreads()
    const id = setInterval(() => { loadThreads(); if (userId) loadThread(userId) }, 10000)
    return () => clearInterval(id)
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setThread(null); if (userId) loadThread(userId) }, [userId])
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight) }, [thread?.messages?.length])

  async function send(e) {
    e?.preventDefault()
    if (!body.trim()) return
    setSending(true); setError('')
    try {
      await adminFetch(`/admin/messages/${userId}`, { method: 'POST', body: JSON.stringify({ body: body.trim() }) })
      setBody('')
      loadThread(userId)
      loadThreads()
    } catch (err) { setError(err.message) }
    finally { setSending(false) }
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Messages</h1>
          <p className="admin-page-subtitle">Conversations with customers. New customer messages are also posted to the shop’s Telegram chat.</p>
        </div>
      </div>
      {error && <div className="admin-alert admin-alert-error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr', gap: 16, alignItems: 'start' }}>
        <div className="admin-card" style={{ padding: 0, overflow: 'hidden' }}>
          {threads === null ? <div style={{ padding: 16, color: '#888' }}>Loading…</div>
            : threads.length === 0 ? <div style={{ padding: 16, color: '#888' }}>No conversations yet.</div>
            : threads.map(t => (
              <button
                key={t.user.id} type="button" onClick={() => navigate(`/admin/messages/${t.user.id}`)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 0, color: '#1a1a2e', borderBottom: '1px solid #eef0f4', cursor: 'pointer',
                  background: String(t.user.id) === userId ? '#eef2ff' : '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{t.user.username}</strong>
                  {t.unread > 0 && <span className="admin-badge" style={{ background: '#dc2626', color: '#fff' }}>{t.unread}</span>}
                </div>
                <div style={{ fontSize: 12, color: '#777', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.last?.isStaff ? 'You: ' : ''}{t.last?.body}
                </div>
              </button>
            ))}
        </div>

        <div className="admin-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 420 }}>
          {!userId ? <div style={{ color: '#888', margin: 'auto' }}>Select a conversation.</div> : !thread ? <div style={{ color: '#888' }}>Loading…</div> : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eef0f4', paddingBottom: 10, marginBottom: 10 }}>
                <div>
                  <Link to={`/admin/users/${thread.user.id}`} style={{ fontWeight: 700 }}>{thread.user.username}</Link>
                  {thread.user.telegramHandle && <span style={{ color: '#777', fontSize: 13 }}> · Telegram @{thread.user.telegramHandle.replace(/^@/, '')}</span>}
                </div>
              </div>
              <div ref={logRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '55vh', paddingRight: 4 }}>
                {thread.messages.map(m => (
                  <div key={m.id} style={{
                    alignSelf: m.isStaff ? 'flex-end' : 'flex-start', maxWidth: '78%', padding: '8px 12px', borderRadius: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                    background: m.isStaff ? '#4f46e5' : '#f1f3f7', color: m.isStaff ? '#fff' : '#1a1a2e', fontSize: 14,
                  }}>
                    {m.body}
                    <div style={{ fontSize: 11, opacity: .7, marginTop: 4 }}>
                      {m.isStaff ? `${m.sender?.username || 'staff'} · ` : ''}{new Date(m.createdAt).toLocaleString()}{m.isStaff && m.readAt ? ' · read' : ''}
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={send} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <textarea
                  className="admin-input" rows={2} maxLength={2000} placeholder="Reply…" value={body}
                  onChange={e => setBody(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  style={{ flex: 1, resize: 'vertical' }}
                />
                <button className="admin-btn admin-btn-primary" disabled={sending || !body.trim()}>Send</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
