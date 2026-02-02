import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from './firebase.js'; 

// Contexto: Importamos useUi para saber el estado de la conexión
import { UiProvider, useUi } from './context/UiContext.jsx';

// Importación de Componentes
import TomarPedido from './TomarPedido.jsx';
import HistorialPedidos from './HistorialPedidos.jsx';
import Caja from './Caja.jsx';
import Gastos from './Gastos.jsx';
import GestionProductos from './GestionProductos.jsx';

// --- COMPONENTE DE LOGIN ---
const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error(err);
      setError('Credenciales incorrectas o error de conexión.');
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-900 font-sans text-gray-800">
      <div className="w-[450px] p-12 bg-white rounded-[3.5rem] shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-red-600"></div>
        
        <div className="text-center mb-10">
          <h2 className="text-4xl font-black uppercase tracking-tighter text-slate-900 m-0">ISAKARI <span className="text-red-600">POS</span></h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">Sistema de Gestión</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-xs font-black uppercase rounded-r-xl animate-bounce">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-2 tracking-widest">Usuario</label>
            <input 
              type="email" 
              className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-[1.5rem] text-sm font-bold focus:border-red-500 focus:bg-white transition-colors outline-none"
              placeholder="correo@isakari.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required 
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 mb-2 ml-2 tracking-widest">Contraseña</label>
            <input 
              type="password" 
              className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-[1.5rem] text-sm font-bold focus:border-red-500 focus:bg-white transition-colors outline-none"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
            />
          </div>
          <button 
            type="submit" 
            disabled={loading}
            className="w-full py-5 bg-red-600 text-white rounded-[1.5rem] font-black uppercase text-sm tracking-widest shadow-xl shadow-red-200 hover:bg-red-700 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? 'Ingresando...' : 'Iniciar Sesión'}
          </button>
        </form>
      </div>
    </div>
  );
};

// --- CONTENIDO PRINCIPAL ---
const AppContent = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [seccion, setSeccion] = useState('PEDIDO');
  const [ordenParaEditar, setOrdenParaEditar] = useState(null);
  
  const { isOnline } = useUi();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (usuario) => {
      setUser(usuario);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleEditarPedido = (pedido) => {
    setOrdenParaEditar(pedido);
    setSeccion('PEDIDO');
  };

  const handleTerminarEdicion = () => {
    setOrdenParaEditar(null);
    setSeccion('HISTORIAL'); 
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 text-slate-300 font-black uppercase tracking-[0.2em] animate-pulse">
        Cargando Sistema...
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="flex flex-col h-screen bg-slate-100 font-sans text-gray-800 overflow-hidden">
      {/* NAVBAR */}
      <nav className="flex-shrink-0 h-20 bg-slate-900 px-8 flex items-center justify-between shadow-2xl z-50 relative">
        <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">I</div>
            <span className="text-white font-black tracking-tighter text-xl">ISAKARI <span className="text-red-600">POS</span></span>
            
            <div className={`ml-4 flex items-center gap-2 px-3 py-1 rounded-full border transition-colors ${isOnline ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400 animate-pulse'}`}>
                <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-red-400'}`}></div>
                <span className="text-[9px] font-black uppercase tracking-widest">
                    {isOnline ? 'ONLINE' : 'OFFLINE'}
                </span>
            </div>
        </div>
        
        {/* MENU DE NAVEGACIÓN */}
        <div className="flex gap-2 p-1 bg-slate-800/50 rounded-2xl border border-slate-700">
          {[
            { id: 'PEDIDO', icon: 'bi-pencil-square', label: 'Tomar Pedido' },
            { id: 'HISTORIAL', icon: 'bi-clock-history', label: 'Historial' },
            { id: 'CAJA', icon: 'bi-cash-coin', label: 'Caja' },
            { id: 'GASTOS', icon: 'bi-wallet2', label: 'Gastos' },
            { id: 'PRODUCTOS', icon: 'bi-box-seam', label: 'Productos' }
          ].map((item) => (
            <button 
              key={item.id} 
              onClick={() => { 
                if (item.id === 'PEDIDO') setOrdenParaEditar(null);
                setSeccion(item.id); 
              }}
              className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 ${
                seccion === item.id 
                  ? 'bg-red-600 text-white shadow-lg shadow-red-900/20' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <i className={`bi ${item.icon} text-sm`}></i>
              {item.label}
            </button>
          ))}
        </div>

        <button 
          onClick={() => signOut(auth)} 
          className="w-10 h-10 rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-red-500 transition-colors flex items-center justify-center border border-slate-700"
          title="Cerrar Sesión"
        >
          <i className="bi bi-power text-lg"></i>
        </button>
      </nav>

      {/* ÁREA DE CONTENIDO DINÁMICO */}
      <div className="flex-1 overflow-hidden relative z-0">
        {seccion === 'PEDIDO' && (
          <TomarPedido 
            user={user} 
            ordenAEditar={ordenParaEditar} 
            onTerminarEdicion={handleTerminarEdicion} 
          />
        )}
        
        {seccion === 'HISTORIAL' && (
          <HistorialPedidos 
            user={user} 
            onEditar={handleEditarPedido} 
            ordenParaEditar={ordenParaEditar}
          />
        )}
        
        {seccion === 'CAJA' && (
          <Caja user={user} />
        )}
        
        {seccion === 'GASTOS' && (
          <Gastos user={user} />
        )}

        {seccion === 'PRODUCTOS' && (
          <GestionProductos />
        )}
      </div>

      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
        body { font-family: 'Inter', sans-serif; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default function App() {
  return (
    <UiProvider>
      <AppContent />
    </UiProvider>
  );
}