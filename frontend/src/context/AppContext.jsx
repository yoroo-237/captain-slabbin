import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../utils/api.js'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [user, setUser]             = useState(null)
  const [balance, setBalance]       = useState(0)
  // Crypto held per currency (net of deposit fees) with live prices; balance = Σ usd
  const [holdings, setHoldings]     = useState([])
  const [loadingAuth, setLoadingAuth] = useState(true)
  const [theme, setTheme]           = useState(
    () => localStorage.getItem('botb_theme') || 'light'
  )

  // Apply theme on mount + change
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('botb_theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme(t => t === 'light' ? 'dark' : 'light')
  }

  const applyWallet = useCallback((w) => {
    const bal = w?.balance ?? w
    setBalance(typeof bal === 'number' ? bal : 0)
    if (Array.isArray(w?.holdings)) setHoldings(w.holdings)
  }, [])

  const refreshBalance = useCallback(async () => {
    const w = await apiFetch('/wallet/balance').catch(() => null)
    if (w) applyWallet(w)
  }, [applyWallet])

  const loadUserData = useCallback(async () => {
    try {
      const [meData, walletData] = await Promise.allSettled([
        apiFetch('/auth/me'),
        apiFetch('/wallet/balance'),
      ])
      if (meData.status === 'fulfilled' && meData.value) {
        setUser(meData.value.user || meData.value)
      }
      if (walletData.status === 'fulfilled' && walletData.value) applyWallet(walletData.value)
    } catch {
      // ignore
    }
  }, [applyWallet])

  // The balance is crypto valued at market price, so it moves on its own:
  // re-value it every 30s while signed in and the tab is visible.
  useEffect(() => {
    if (!user) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refreshBalance()
    }, 30000)
    return () => clearInterval(id)
  }, [user, refreshBalance])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      loadUserData().finally(() => setLoadingAuth(false))
    } else {
      setLoadingAuth(false)
    }
  }, [loadUserData])

  function login(token, refreshToken, userData) {
    localStorage.setItem('token', token)
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken)
    setUser(userData)
    if (userData?.balance != null) setBalance(userData.balance)
  }

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    setUser(null)
    setBalance(0)
    setHoldings([])
    window.location.href = '/login'
  }

  return (
    <AppContext.Provider value={{ user, balance, holdings, refreshBalance, loadingAuth, login, logout, loadUserData, theme, toggleTheme }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
