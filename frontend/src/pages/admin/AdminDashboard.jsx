import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts'
import { adminFetch } from './utils/api.js'
import StatusBadge from '../../components/admin/StatusBadge.jsx'

const PIE_COLORS = ['#4361ee', '#f7c59f', '#28a745', '#dc3545', '#6f42c1', '#fd7e14']

function Skel({ w = '80px', h = '20px' }) {
  return <span className="admin-skel" style={{ width: w, height: h, display: 'inline-block' }} />
}

function StatCard({ label, value, sub, loading }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{loading ? <Skel w="100px" h="28px" /> : value}</div>
      {sub && <div className="admin-stat-sub">{sub}</div>}
    </div>
  )
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function AdminDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    adminFetch('/admin/dashboard')
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const stats = data?.stats || {}
  const charts = data?.charts || {}
  const recentOrders = data?.recentOrders || []
  const lowStock = data?.lowStockProducts || []
  const tickets = data?.recentTickets || []

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Dashboard</h1>
          <p className="admin-page-subtitle">Welcome back. Here's what's happening today.</p>
        </div>
      </div>

      {error && (
        <div style={{ background: '#f8d7da', color: '#721c24', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="admin-stat-grid">
        <StatCard label="Total Revenue" value={loading ? null : `$${(stats.totalRevenue || 0).toFixed(2)}`} loading={loading} />
        <StatCard label="Total Orders" value={loading ? null : stats.totalOrders ?? 0} loading={loading} />
        <StatCard label="Pending Orders" value={loading ? null : stats.pendingOrders ?? 0} loading={loading} />
        <StatCard label="Shipped Orders" value={loading ? null : stats.shippedOrders ?? 0} loading={loading} />
        <StatCard label="Total Users" value={loading ? null : stats.totalUsers ?? 0} loading={loading} />
        <StatCard label="Products" value={loading ? null : stats.totalProducts ?? 0} loading={loading} />
        <StatCard label="Open Tickets" value={loading ? null : stats.openTickets ?? 0} loading={loading} />
        <StatCard label="Revenue This Month" value={loading ? null : `$${(stats.revenueThisMonth || 0).toFixed(2)}`} loading={loading} />
      </div>

      {/* Charts */}
      {!loading && (
        <div className="admin-charts-grid">
          {/* Revenue last 30 days */}
          <div className="admin-chart-wrap" style={{ gridColumn: '1 / -1' }}>
            <div className="admin-chart-title">Revenue — Last 30 Days</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={charts.revenueChart || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => typeof d === 'string' ? d.slice(5) : ''} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                <Tooltip formatter={v => [`$${Number(v).toFixed(2)}`, 'Revenue']} />
                <Line type="monotone" dataKey="revenue" stroke="#4361ee" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Orders by status */}
          <div className="admin-chart-wrap">
            <div className="admin-chart-title">Orders by Status</div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={charts.ordersStatusChart || []}
                  cx="50%" cy="50%"
                  innerRadius={55} outerRadius={80}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {(charts.ordersStatusChart || []).map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Top 5 Products */}
          <div className="admin-chart-wrap">
            <div className="admin-chart-title">Top 5 Products</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={charts.topProducts || []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="sales" fill="#4361ee" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* New Users Last 7 Days */}
          <div className="admin-chart-wrap">
            <div className="admin-chart-title">New Users — Last 7 Days</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={charts.newUsersChart || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => typeof d === 'string' ? d.slice(5) : ''} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="users" fill="#28a745" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent Orders */}
      <div className="admin-card">
        <h2 className="admin-card-title">Recent Orders</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4}><Skel w="100%" h="40px" /></td></tr>
              ) : recentOrders.length === 0 ? (
                <tr><td colSpan={4} className="admin-table-empty">No data found.</td></tr>
              ) : recentOrders.map(o => (
                <tr key={o.id}>
                  <td><span className="admin-code">#{o.orderNumber || o.id}</span></td>
                  <td>{o.user?.username || o.name || '—'}</td>
                  <td>${Number(o.total || 0).toFixed(2)}</td>
                  <td><StatusBadge type="status" value={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-grid-2">
        {/* Low Stock */}
        <div className="admin-card">
          <h2 className="admin-card-title">Low Stock Products</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Product</th><th>Stock</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={2}><Skel w="100%" h="32px" /></td></tr>
                ) : lowStock.length === 0 ? (
                  <tr><td colSpan={2} className="admin-table-empty">No low-stock products.</td></tr>
                ) : lowStock.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td><span style={{ color: p.stock <= 5 ? '#dc3545' : '#856404', fontWeight: 700 }}>{p.stock}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Tickets */}
        <div className="admin-card">
          <h2 className="admin-card-title">Recent Unassigned Tickets</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Category</th>
                  <th>Priority</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4}><Skel w="100%" h="32px" /></td></tr>
                ) : tickets.length === 0 ? (
                  <tr><td colSpan={4} className="admin-table-empty">No unassigned tickets.</td></tr>
                ) : tickets.map(t => (
                  <tr key={t.id}>
                    <td>{t.subject || '—'}</td>
                    <td>{t.category || '—'}</td>
                    <td>{t.priority || '—'}</td>
                    <td>{formatDate(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
