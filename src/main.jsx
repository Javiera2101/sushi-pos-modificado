import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Importamos el UiProvider que creamos
import { UiProvider } from './context/UiContext'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Envolvemos la App con el Provider para que toda la app tenga acceso al contexto */}
    <UiProvider>
      <App />
    </UiProvider>
  </React.StrictMode>,
)