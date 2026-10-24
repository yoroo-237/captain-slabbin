import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import { SignInForm, CreateAccountForm } from '../components/AuthForms.jsx'
import { STAFF_ROLES } from '../../utils/roles.js'

function AuthShell({ title, sub, children, footer }) {
  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 40, paddingBottom: 20 }}>
      <h1 className="frost-head" style={{ fontSize: 28, textAlign: 'center' }}>{title}</h1>
      {sub && <p className="muted" style={{ textAlign: 'center', marginTop: 8 }}>{sub}</p>}
      <div className="panel" style={{ marginTop: 20 }}>{children}</div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 16, fontSize: 14 }}>{footer}</p>
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
      title="Sign in"
      sub="Welcome back."
      footer={<>New here? <Link to="/account/create" state={location.state} style={{ textDecoration: 'underline' }}>Create an account</Link> — or keep browsing, no account needed.</>}
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
      sub="Takes 10 seconds. Get a crypto wallet, order tracking and direct messages with the shop."
      footer={<>Already have one? <Link to="/login" style={{ textDecoration: 'underline' }}>Sign in</Link></>}
    >
      <CreateAccountForm onDone={() => navigate(location.state?.from?.pathname || '/account/wallet', { replace: true })} />
    </AuthShell>
  )
}
