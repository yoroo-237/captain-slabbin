import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../utils/api.js'
import { useApp } from '../../context/AppContext.jsx'
import { useSeo } from '../seo.js'
import { SignInForm, CreateAccountForm } from '../components/AuthForms.jsx'
import { STAFF_ROLES } from '../../utils/roles.js'
import { Icon } from '../lib.jsx'

function AuthShell({ title, sub, children, footer, perks }) {
  return (
    <div className="auth-wrap">
      <img className="auth-logo" src="/brand/logo.webp" alt="" />
      <h1 className="display">{title}</h1>
      {sub && <p className="sub">{sub}</p>}
      <div className="panel" style={{ marginTop: 22 }}>{children}</div>
      {perks && (
        <ul className="auth-perks">
          {perks.map(p => <li key={p}><Icon.check /> {p}</li>)}
        </ul>
      )}
      <p className="muted" style={{ textAlign: 'center', marginTop: 18, fontSize: 14 }}>{footer}</p>
    </div>
  )
}

const target = (location, user) => location.state?.from?.pathname || (STAFF_ROLES.includes(user?.role) ? '/admin' : '/account')

export function LoginPage() {
  useSeo({ title: 'Sign in', noindex: true })
  const { user } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  if (user) return <Navigate to={target(location, user)} replace />
  return (
    <AuthShell
      title="Welcome back"
      sub="Sign in to your wallet, orders and messages."
      footer={<>New here? <Link to="/account/create" state={location.state} className="link">Create an account</Link></>}
    >
      <SignInForm onDone={u => navigate(target(location, u), { replace: true })} />
    </AuthShell>
  )
}

// The dedicated sign-up page; checkout also creates accounts inline
export function CreateAccountPage() {
  useSeo({ title: 'Create an account', noindex: true })
  const { user } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  if (user) return <Navigate to="/account" replace />
  return (
    <AuthShell
      title="Create account"
      sub="Takes 10 seconds. No email or real name needed."
      perks={['Crypto wallet to pay in one tap', 'Order tracking & invoices on Telegram', 'Direct messages with the shop']}
      footer={<>Already have an account? <Link to="/login" className="link">Sign in</Link></>}
    >
      <CreateAccountForm onDone={() => navigate(location.state?.from?.pathname || '/account/wallet', { replace: true })} />
    </AuthShell>
  )
}

// /tg-login?t=…: the one-tap sign-in link the Telegram bot hands out
export function TelegramLoginPage() {
  useSeo({ title: 'Signing in', noindex: true })
  const { login, loadUserData } = useApp()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('t')
    apiFetch('/auth/telegram', { method: 'POST', body: JSON.stringify({ token }) })
      .then(async d => { login(d.accessToken, d.refreshToken, d.user); await loadUserData(); navigate('/account', { replace: true }) })
      .catch(err => setError(err.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="container" style={{ padding: '64px 16px', textAlign: 'center' }}>
      {error
        ? <><p className="gate-error" role="alert">{error}</p><p className="muted">Open the bot and tap <b>My account on the site</b> again.</p></>
        : <div className="spinner" style={{ margin: '0 auto' }} />}
    </div>
  )
}
