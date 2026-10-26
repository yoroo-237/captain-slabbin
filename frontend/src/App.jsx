import { lazy, Suspense, useEffect, useRef, useState } from 'react'

// Admin pages load on first visit. If a new deploy removed the file this tab
// expects, load the new build once rather than crash (see also main.jsx).
const lazyPage = load => lazy(() => load().catch(err => {
  let last = 0
  try { last = Number(sessionStorage.getItem('cs_reloaded_at')) || 0 } catch { /* storage blocked */ }
  if (Date.now() - last > 30000) {
    try { sessionStorage.setItem('cs_reloaded_at', String(Date.now())) } catch { /* storage blocked */ }
    window.location.reload()
    return new Promise(() => {}) // keep the fallback on screen while reloading
  }
  throw err
}))
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { CartProvider } from './context/CartContext.jsx'
import { AppProvider, useApp } from './context/AppContext.jsx'
import { ShopProvider, useShop } from './shop/ShopContext.jsx'
import './shop/captain.css'
import AgeGate from './shop/components/AgeGate.jsx'
import Layout from './shop/components/Layout.jsx'
import HomePage from './shop/pages/HomePage.jsx'
import ShelfPage from './shop/pages/ShelfPage.jsx'
import ProductPage from './shop/pages/ProductPage.jsx'
import CartPage from './shop/pages/CartPage.jsx'
import CheckoutPage from './shop/pages/CheckoutPage.jsx'
import WalletPage from './shop/pages/WalletPage.jsx'
import { LoginPage, CreateAccountPage, TelegramLoginPage } from './shop/pages/AuthPages.jsx'
import AboutPage from './shop/pages/AboutPage.jsx'
import FaqPage from './shop/pages/FaqPage.jsx'
import { Locked, AgeNotice } from './shop/components/Locks.jsx'
import { AccountLayout, AccountOverview, AccountOrders, AccountProfile, AccountMessages } from './shop/pages/AccountPages.jsx'
const AdminLayout = lazyPage(() => import('./pages/admin/AdminLayout.jsx'))
const AdminDashboard = lazyPage(() => import('./pages/admin/AdminDashboard.jsx'))
const AdminUsers = lazyPage(() => import('./pages/admin/AdminUsers.jsx'))
const AdminUserDetail = lazyPage(() => import('./pages/admin/AdminUserDetail.jsx'))
const AdminDeposits = lazyPage(() => import('./pages/admin/AdminDeposits.jsx'))
const AdminTransactions = lazyPage(() => import('./pages/admin/AdminTransactions.jsx'))
const AdminOrders = lazyPage(() => import('./pages/admin/AdminOrders.jsx'))
const AdminOrderDetail = lazyPage(() => import('./pages/admin/AdminOrderDetail.jsx'))
const AdminProducts = lazyPage(() => import('./pages/admin/AdminProducts.jsx'))
const AdminCategories = lazyPage(() => import('./pages/admin/AdminCategories.jsx'))
const AdminBrands = lazyPage(() => import('./pages/admin/AdminBrands.jsx'))
const AdminSupport = lazyPage(() => import('./pages/admin/AdminSupport.jsx'))
const AdminSupportDetail = lazyPage(() => import('./pages/admin/AdminSupportDetail.jsx'))
const AdminReviews = lazyPage(() => import('./pages/admin/AdminReviews.jsx'))
const AdminNews = lazyPage(() => import('./pages/admin/AdminNews.jsx'))
const AdminFaq = lazyPage(() => import('./pages/admin/AdminFaq.jsx'))
const AdminGiveaways = lazyPage(() => import('./pages/admin/AdminGiveaways.jsx'))
const AdminAnalytics = lazyPage(() => import('./pages/admin/AdminAnalytics.jsx'))
const AdminSettings = lazyPage(() => import('./pages/admin/AdminSettings.jsx'))
const AdminAccount = lazyPage(() => import('./pages/admin/AdminAccount.jsx'))
const AdminTelegram = lazyPage(() => import('./pages/admin/AdminTelegram.jsx'))
const AdminSuperDashboard = lazyPage(() => import('./pages/admin/AdminSuperDashboard.jsx'))
const AdminInbox = lazyPage(() => import('./pages/admin/AdminInbox.jsx'))
import { STAFF_ROLES } from './utils/roles.js'

function LoadingScreen() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#050506' }}>
      <div style={{ width: 34, height: 34, border: '3px solid rgb(198 210 219 / .2)', borderTopColor: '#c6d2db', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
    </div>
  )
}

function AdminGuard() {
  const { user, loadingAuth } = useApp()
  const location = useLocation()
  if (loadingAuth) return <LoadingScreen />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (!STAFF_ROLES.includes(user.role)) return <Navigate to="/" replace />
  return <Suspense fallback={<LoadingScreen />}><AdminLayout /></Suspense>
}

// Commission sweep panel — a plain admin passes AdminGuard but not this one
function SuperAdminRoute({ children }) {
  const { user } = useApp()
  if (user?.role !== 'superadmin') {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1a1a2e' }}>Super admin access required</div>
        <div style={{ color: '#888', fontSize: '0.875rem', marginTop: '6px' }}>This section is restricted to super admin accounts.</div>
      </div>
    )
  }
  return children
}

// Public pages (home, about, FAQ, shelf intros) are readable by everyone after a
// 21+ confirmation, so search engines can index the shop's front. Products,
// prices, cart and accounts sit behind the gate code (AgeGate): it opens on
// demand ("Enter the shop", a locked page) and stays mounted until its smoke has
// cleared, so the reveal shows the real page. A signed-in customer skips it.
// Pages render from `shown`, which Layout moves to the router's location under
// cover of smoke, so the old page stays put until the smoke hides the swap.
function Storefront() {
  const { unlocked, gateWanted, closeGate } = useShop()
  const location = useLocation()
  const [shown, setShown] = useState(location)
  const latest = useRef(location)
  latest.current = location
  // Keep the gate on screen through its reveal, even after `unlocked` flips
  const [gateShown, setGateShown] = useState(false)
  useEffect(() => { if (gateWanted && !unlocked) setGateShown(true) }, [gateWanted, unlocked])

  const locked = (el, what) => <Locked what={what}>{el}</Locked>

  return (
    <>
      <Layout shown={shown} target={location} onSwap={() => setShown(latest.current)}>
        <Routes location={shown}>
          <Route path="/" element={<HomePage />} />
          <Route path="/s/:slug" element={<ShelfPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/p/:sku" element={locked(<ProductPage />, 'this product')} />
          <Route path="/cart" element={locked(<CartPage />, 'your cart')} />
          <Route path="/checkout" element={locked(<CheckoutPage />, 'checkout')} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/tg-login" element={<TelegramLoginPage />} />
          <Route path="/account/create" element={<CreateAccountPage />} />
          <Route path="/account" element={locked(<AccountLayout />, 'your account')}>
            <Route index element={<AccountOverview />} />
            <Route path="wallet" element={<WalletPage />} />
            <Route path="orders" element={<AccountOrders />} />
            <Route path="messages" element={<AccountMessages />} />
            <Route path="profile" element={<AccountProfile />} />
          </Route>
          {/* Old paths from the previous shop */}
          <Route path="/wallet" element={<Navigate to="/account/wallet" replace />} />
          <Route path="/profile" element={<Navigate to="/account/profile" replace />} />
          <Route path="/register" element={<Navigate to="/account/create" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <AgeNotice />
      </Layout>
      {gateShown && <AgeGate onFinished={() => { setGateShown(false); closeGate() }} onClose={() => { setGateShown(false); closeGate() }} />}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <CartProvider>
        <AppProvider>
          <ShopProvider>
            <Routes>
              <Route path="/admin" element={<AdminGuard />}>
                <Route index element={<AdminDashboard />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="users/:id" element={<AdminUserDetail />} />
                <Route path="deposits" element={<AdminDeposits />} />
                <Route path="transactions" element={<AdminTransactions />} />
                <Route path="orders" element={<AdminOrders />} />
                <Route path="orders/:id" element={<AdminOrderDetail />} />
                <Route path="messages" element={<AdminInbox />} />
                <Route path="messages/:userId" element={<AdminInbox />} />
                <Route path="products" element={<AdminProducts />} />
                <Route path="categories" element={<AdminCategories />} />
                <Route path="brands" element={<AdminBrands />} />
                <Route path="support" element={<AdminSupport />} />
                <Route path="support/:id" element={<AdminSupportDetail />} />
                <Route path="reviews" element={<AdminReviews />} />
                <Route path="news" element={<AdminNews />} />
                <Route path="faq" element={<AdminFaq />} />
                <Route path="giveaways" element={<AdminGiveaways />} />
                <Route path="analytics" element={<AdminAnalytics />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="account" element={<AdminAccount />} />
                <Route path="telegram" element={<AdminTelegram />} />
                <Route path="super" element={<SuperAdminRoute><AdminSuperDashboard /></SuperAdminRoute>} />
              </Route>
              <Route path="/*" element={<Storefront />} />
            </Routes>
          </ShopProvider>
        </AppProvider>
      </CartProvider>
    </BrowserRouter>
  )
}
