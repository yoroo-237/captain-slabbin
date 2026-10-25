import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../utils/api.js'

// Storefront state: gate pass, 21+ confirmation, public settings, shelves
// (categories) and toasts.
//
// Two locks: the public pages (home, about, FAQ, shelf intros) only ask for a
// 21+ confirmation, so search engines and visitors can read them; products,
// prices, cart and account need the gate code (AgeGate), opened on demand.
const ShopContext = createContext(null)

export function ShopProvider({ children }) {
  const [gateToken, setGateToken] = useState(() => localStorage.getItem('cs_gate'))
  const [settings, setSettings]   = useState({})
  const [shelves, setShelves]     = useState({ categories: [], fireSale: 0 })
  const [toasts, setToasts]       = useState([])
  const [ageOk, setAgeOk]         = useState(() => { try { return localStorage.getItem('cs_age') === '1' } catch { return false } })
  const [gateWanted, setGateWanted] = useState(false)
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

  const confirmAge = useCallback(() => {
    try { localStorage.setItem('cs_age', '1') } catch { /* private mode */ }
    setAgeOk(true)
  }, [])

  const unlocked = !!gateToken || !!localStorage.getItem('token')

  useEffect(() => {
    apiFetch('/categories').then(setShelves).catch(() => {})
  }, [])

  const toast = useCallback((message, action) => {
    const id = ++toastId.current
    setToasts(t => [...t.slice(-2), { id, message, action }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])

  return (
    <ShopContext.Provider value={{ unlocked, passGate, ageOk: ageOk || unlocked, confirmAge, gateWanted, openGate: () => setGateWanted(true), closeGate: () => setGateWanted(false), settings, shelves, toasts, toast }}>
      {children}
    </ShopContext.Provider>
  )
}

export function useShop() {
  const ctx = useContext(ShopContext)
  if (!ctx) throw new Error('useShop must be used within ShopProvider')
  return ctx
}
