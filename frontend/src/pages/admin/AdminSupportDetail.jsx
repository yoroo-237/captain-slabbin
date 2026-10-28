import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { adminFetch } from './utils/api.js'
import { showMessage } from './dialog'

export default function AdminSupportDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [ticket, setTicket] = useState(null)
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchTicket = useCallback(async () => {
    const data = await adminFetch(`/admin/support/tickets/${id}`)
    const t = data.ticket || data
    return { ticket: t, messages: t.messages || data.messages || [] }
  }, [id])

  // Refresh in place (after reply/status change) — keeps current data visible while it runs
  const refresh = useCallback(() => {
    fetchTicket()
      .then(({ ticket, messages }) => { setTicket(ticket); setMessages(messages) })
      .catch(e => setError(e.message))
  }, [fetchTicket])

  useEffect(() => {
    let stale = false
    setLoading(true)
    setTicket(null)
    setMessages([])
    setError('')
    fetchTicket()
      .then(({ ticket, messages }) => { if (!stale) { setTicket(ticket); setMessages(messages) } })
      .catch(e => { if (!stale) setError(e.message) })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [fetchTicket])

  async function sendReply(e) {
    e.preventDefault()
    if (!reply.trim()) return
    setSending(true)
    try {
      await adminFetch(`/admin/support/tickets/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message: reply }),
      })
      setReply('')
      refresh()
    } catch (e) {
      showMessage(e.message)
    } finally {
      setSending(false)
    }
  }

  const isClosed = ['resolved', 'closed'].includes(ticket?.status)

  async function toggleStatus() {
    const newStatus = isClosed ? 'open' : 'closed'
    setStatusLoading(true)
    try {
      await adminFetch(`/admin/support/tickets/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      })
      refresh()
    } catch (e) {
      showMessage(e.message)
    } finally {
      setStatusLoading(false)
    }
  }

  function formatDate(str) {
    if (!str) return '—'
    return new Date(str).toLocaleString()
  }

  if (loading) return <div style={{ padding: '40px', color: '#888' }}>Loading…</div>
  if (error) return <div style={{ color: '#dc3545', padding: '20px' }}>{error}</div>
  if (!ticket) return null

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => navigate('/admin/support')} style={{ marginBottom: '8px' }}>
            ← Back to Tickets
          </button>
          <h1 className="admin-page-title">{ticket.subject}</h1>
          <p className="admin-page-subtitle">
            From: <strong>{ticket.user?.username || '—'}</strong>
            {ticket.user?.telegramHandle && <> (TG {ticket.user.telegramHandle})</>}
            {' '}· {ticket.category} · {ticket.priority} priority · {formatDate(ticket.createdAt)}
          </p>
        </div>
        <div className="admin-gap-actions">
          <span className="admin-badge" style={{ background: isClosed ? '#e9ecef' : '#d4edda', color: isClosed ? '#6c757d' : '#155724' }}>
            {(ticket.status || 'open').replace('_', ' ')}
          </span>
          <button
            className={'admin-btn admin-btn-sm ' + (isClosed ? 'admin-btn-success' : 'admin-btn-danger')}
            onClick={toggleStatus}
            disabled={statusLoading}
          >
            {isClosed ? 'Reopen Ticket' : 'Close Ticket'}
          </button>
        </div>
      </div>

      {/* Message thread */}
      <div className="admin-card">
        <h2 className="admin-card-title">Messages</h2>
        {messages.length === 0 ? (
          <p style={{ color: '#888', fontStyle: 'italic' }}>No messages yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {messages.map((m, i) => {
              const isAdmin = m.isAdmin || ['admin', 'moderator', 'superadmin'].includes(m.role)
              return (
                <div key={m.id || i} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  background: isAdmin ? '#f0f4ff' : '#f8fafc',
                  border: `1px solid ${isAdmin ? '#c8d4ff' : '#e8ecf0'}`,
                  alignSelf: isAdmin ? 'flex-end' : 'flex-start',
                  maxWidth: '80%',
                }}>
                  <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '6px' }}>
                    <strong style={{ color: isAdmin ? '#4361ee' : '#333' }}>{isAdmin ? 'Support Agent' : m.user?.username || 'User'}</strong>
                    {' · '}{formatDate(m.createdAt)}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#333', whiteSpace: 'pre-wrap' }}>{m.message || m.content}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Reply form */}
      <div className="admin-card">
        <h2 className="admin-card-title">Reply</h2>
        {isClosed ? (
          <p className="admin-text-muted" style={{ margin: 0 }}>This ticket is {ticket.status}. Reopen it to reply.</p>
        ) : (
        <form onSubmit={sendReply}>
          <div className="admin-form-group">
            <textarea
              className="admin-textarea"
              rows={4}
              placeholder="Type your reply…"
              value={reply}
              onChange={e => setReply(e.target.value)}
            />
          </div>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={sending || !reply.trim()}>
            {sending ? 'Sending…' : 'Send Reply'}
          </button>
        </form>
        )}
      </div>
    </div>
  )
}
