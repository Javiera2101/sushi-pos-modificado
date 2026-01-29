import React, { createContext, useContext, useState, useCallback } from 'react';

const UiContext = createContext();

export const useUi = () => useContext(UiContext);

export const UiProvider = ({ children }) => {
    // Estado para Notificaciones (Toasts)
    const [toasts, setToasts] = useState([]);
    
    // Estado para Modal de Confirmación
    const [modalConfig, setModalConfig] = useState(null);

    // Función para mostrar notificación
    const notificar = useCallback((mensaje, tipo = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, mensaje, tipo }]);
        
        // Auto eliminar a los 3 segundos
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    }, []);

    // Función para pedir confirmación (Reemplaza a confirm())
    const preguntar = useCallback((titulo, mensaje) => {
        return new Promise((resolve) => {
            setModalConfig({
                titulo,
                mensaje,
                onConfirm: () => {
                    setModalConfig(null);
                    resolve(true);
                },
                onCancel: () => {
                    setModalConfig(null);
                    resolve(false);
                }
            });
        });
    }, []);

    return (
        <UiContext.Provider value={{ notificar, preguntar }}>
            {children}
            
            {/* RENDERIZADO DE NOTIFICACIONES (TOASTS) */}
            <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2">
                {toasts.map(t => (
                    <div key={t.id} className={`px-4 py-3 rounded-lg shadow-lg text-white font-bold animate-bounce-in ${
                        t.tipo === 'error' ? 'bg-red-500' : 
                        t.tipo === 'success' ? 'bg-green-500' : 'bg-blue-600'
                    }`}>
                        {t.tipo === 'error' ? <i className="bi bi-exclamation-triangle-fill me-2"></i> : <i className="bi bi-info-circle-fill me-2"></i>}
                        {t.mensaje}
                    </div>
                ))}
            </div>

            {/* RENDERIZADO DE MODAL DE CONFIRMACIÓN */}
            {modalConfig && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden">
                        <div className="bg-gray-100 p-4 border-b border-gray-200">
                            <h3 className="font-bold text-lg text-gray-800">{modalConfig.titulo}</h3>
                        </div>
                        <div className="p-6">
                            <p className="text-gray-600">{modalConfig.mensaje}</p>
                        </div>
                        <div className="p-4 bg-gray-50 flex justify-end gap-3">
                            <button 
                                onClick={modalConfig.onCancel}
                                className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-200 font-medium transition-colors"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={modalConfig.onConfirm}
                                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-bold transition-colors shadow-md"
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </UiContext.Provider>
    );
};