import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
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
