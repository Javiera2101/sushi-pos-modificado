import React, { createContext, useState, useEffect, useContext } from 'react';

export const UiContext = createContext();

// Hook personalizado con validación de seguridad
export const useUi = () => {
  const context = useContext(UiContext);
  if (!context) {
    // Fallback preventivo para evitar que la app se rompa si se usa fuera del provider
    return {
      isOnline: navigator.onLine,
      notificar: (msg) => console.log("Notificación (sin contexto):", msg)
    };
  }
  return context;
};

export const UiProvider = ({ children }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [mensaje, setMensaje] = useState(null);

  /**
   * Muestra una notificación flotante en pantalla
   * @param {string} msg - Texto a mostrar
   * @param {'success'|'error'} tipo - Estilo visual
   */
  const notificar = (msg, tipo = 'success') => {
    setMensaje({ msg: String(msg), tipo });
    // Limpiar automáticamente tras 3 segundos
    setTimeout(() => setMensaje(null), 3000);
  };

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <UiContext.Provider value={{ 
      isMobileMenuOpen, 
      toggleMobileMenu,
      isOnline,
      notificar 
    }}>
      {children}
      
      {/* RENDERIZADO GLOBAL DE NOTIFICACIONES */}
      {mensaje && (
        <div className={`fixed bottom-6 right-6 z-[999999] p-4 rounded-2xl shadow-2xl text-white font-black uppercase text-xs animate-bounce flex items-center gap-3 border-2 transition-all duration-300 ${
          mensaje.tipo === 'success' ? 'bg-green-600 border-green-400' : 'bg-red-600 border-red-400'
        }`}>
          <i className={`bi ${mensaje.tipo === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'} text-lg`}></i>
          <span>{mensaje.msg}</span>
        </div>
      )}
    </UiContext.Provider>
  );
};