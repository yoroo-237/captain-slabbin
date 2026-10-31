import React from 'react'
import ReactDOM from 'react-dom/client'
import BotsApp from './BotsApp.jsx'
import '../pages/admin/admin.css'
import './bots.css'
import { translateDom } from './i18n.js'

translateDom()
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><BotsApp /></React.StrictMode>)
