import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from '../context/AppContext.jsx'
import { STAFF_ROLES } from '../utils/roles.js'
import BotsLayout from './BotsLayout.jsx'
import { LoginScreen, StaffTelegram } from './Auth.jsx'

// The bots platform's dashboard: bots only. Its own database, wallet and
// withdrawals; the pages are the site admin's, under /admin like on the site so
// the links in the bots' staff notifications open the same pages here.
const CapturePage = lazy(() => import('./CapturePage.jsx'))
const Withdrawals = lazy(() => import('./Withdrawals.jsx'))
const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard.jsx'))
const AdminTelegram = lazy(() => import('../pages/admin/AdminTelegram.jsx'))
const AdminOrders = lazy(() => import('../pages/admin/AdminOrders.jsx'))
const AdminOrderDetail = lazy(() => import('../pages/admin/AdminOrderDetail.jsx'))
const AdminProducts = lazy(() => import('../pages/admin/AdminProducts.jsx'))
const AdminCategories = lazy(() => import('../pages/admin/AdminCategories.jsx'))
const AdminVouchers = lazy(() => import('../pages/admin/AdminVouchers.jsx'))
const AdminUsers = lazy(() => import('../pages/admin/AdminUsers.jsx'))
const AdminUserDetail = lazy(() => import('../pages/admin/AdminUserDetail.jsx'))
const AdminDeposits = lazy(() => import('../pages/admin/AdminDeposits.jsx'))
const AdminTransactions = lazy(() => import('../pages/admin/AdminTransactions.jsx'))
const AdminInbox = lazy(() => import('../pages/admin/AdminInbox.jsx'))
const AdminAnalytics = lazy(() => import('../pages/admin/AdminAnalytics.jsx'))
const AdminAccount = lazy(() => import('../pages/admin/AdminAccount.jsx'))
const AdminSuperDashboard = lazy(() => import('../pages/admin/AdminSuperDashboard.jsx'))

const Loading = () => <div className="bp-loading">Chargement…</div>

function Guard() {
  const { user, loadingAuth } = useApp()
  const location = useLocation()
  if (loadingAuth) return <Loading />
  if (!user || !STAFF_ROLES.includes(user.role)) return <Navigate to="/login" state={{ from: location }} replace />
  return <BotsLayout fallback={<Loading />} />
}

function SuperOnly({ children }) {
  const { user } = useApp()
  if (user?.role !== 'superadmin') return <div className="empty-state">Réservé au super admin.</div>
  return children
}

export default function BotsApp() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/admin-tg" element={<StaffTelegram />} />
            <Route path="/admin" element={<Guard />}>
              <Route index element={<AdminTelegram />} />
              <Route path="telegram" element={<Navigate to="/admin" replace />} />
              <Route path="captures" element={<CapturePage />} />
              <Route path="overview" element={<AdminDashboard />} />
              <Route path="analytics" element={<AdminAnalytics />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="orders/:id" element={<AdminOrderDetail />} />
              <Route path="messages" element={<AdminInbox />} />
              <Route path="messages/:userId" element={<AdminInbox />} />
              <Route path="products" element={<AdminProducts />} />
              <Route path="categories" element={<AdminCategories />} />
              <Route path="vouchers" element={<AdminVouchers />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="users/:id" element={<AdminUserDetail />} />
              <Route path="deposits" element={<AdminDeposits />} />
              <Route path="transactions" element={<AdminTransactions />} />
              <Route path="withdrawals" element={<Withdrawals />} />
              <Route path="super" element={<SuperOnly><AdminSuperDashboard /></SuperOnly>} />
              <Route path="account" element={<AdminAccount />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </Suspense>
      </AppProvider>
    </BrowserRouter>
  )
}
