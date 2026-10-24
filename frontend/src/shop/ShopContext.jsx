import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../utils/api.js'

// Storefront state: gate pass, public settings, shelves (categories) and toasts.
const ShopContext = createContext(null)

export function ShopProvider({ children }) {
  const [gateToken, setGateToken] = useState(() => localStorage.getItem('cs_gate'))
  const [settings, setSettings]   = useState({})
  const [shelves, setShelves]     = useState({ categories: [], fireSale: 0 })
  const [toasts, setToasts]       = useState([])
  const toastId = useRef(0)

  // api.js drops the token and fires this when the server asks for the gate again
  useEffect(() => {
    const onGate = () => setGateToken(null)
    window.addEventListener('cs:gate', onGate)
    return () => window.removeEventListener('cs:gate', onGate)
  }, [])

  useEffect(() => {
    apiFetch('/content/settings').then(d => setSettings(d.settings || {})).catch(() => {})
  }, [])

  const passGate = useCallback(token => {
    localStorage.setItem('cs_gate', token)
    setGateToken(token)
  }, [])

  const unlocked = !!gateToken || !!localStorage.getItem('token')

  useEffect(() => {
    if (!unlocked) return
    apiFetch('/categories').then(setShelves).catch(() => {})
  }, [unlocked])

  const toast = useCallback((message, action) => {
    const id = ++toastId.current
    setToasts(t => [...t.slice(-2), { id, message, action }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])

  return (
    <ShopContext.Provider value={{ unlocked, passGate, settings, shelves, toasts, toast }}>
      {children}
    </ShopContext.Provider>
  )
}

export function useShop() {
  const ctx = useContext(ShopContext)
  if (!ctx) throw new Error('useShop must be used within ShopProvider')
  return ctx
}
