import React, { useState, useEffect } from 'react';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getAuth, 
  signInWithCustomToken, 
  signInAnonymously, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  onSnapshot,
  doc,
  updateDoc
} from 'firebase/firestore';

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'isakari-pos';

// --- DETECCIÓN SEGURA DE ELECTRON (Fix para window.require) ---
const ipcRenderer = (function() {
  try {
    if (typeof window !== 'undefined' && typeof window.require === 'function') {
      const electron = window.require('electron');
      return electron ? electron.ipcRenderer : { send: () => {} };
    }
  } catch (e) {
    return { send: () => {} };
  }
  return { send: () => {} };
})();

export function HistorialPedidos() {
  const [user, setUser] = useState(null);
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('todos');

  // Nombres de colecciones
  const emailUsuario = user ? user.email : "";
  const esPrueba = emailUsuario === "prueba@isakari.com";
  const COL_ORDENES = esPrueba ? "ordenes_pruebas" : "ordenes";

  // Auth
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error("Auth error:", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Listeners de Pedidos (Rule 1 & 2)
  useEffect(() => {
    if (!user) return;

    const qPedidos = collection(db, 'artifacts', appId, 'public', 'data', COL_ORDENES);
    const unsubscribe = onSnapshot(qPedidos, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Ordenar por fecha descendente en memoria (Rule 2)
      docs.sort((a, b) => {
        const fechaA = a.fecha?.toMillis ? a.fecha.toMillis() : 0;
        const fechaB = b.fecha?.toMillis ? b.fecha.toMillis() : 0;
        return fechaB - fechaA;
      });

      setPedidos(docs);
      setCargando(false);
    }, (err) => console.error("Error pedidos:", err));

    return () => unsubscribe();
  }, [user, appId, COL_ORDENES]);

  const cambiarEstado = async (id, nuevoEstado) => {
    try {
      const pedidoRef = doc(db, 'artifacts', appId, 'public', 'data', COL_ORDENES, id);
      await updateDoc(pedidoRef, { estado: nuevoEstado });
    } catch (e) { console.error("Error update:", e); }
  };

  const formatoPeso = (v) => v?.toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });

  const pedidosFiltrados = filtroEstado === 'todos' 
    ? pedidos 
    : pedidos.filter(p => p.estado === filtroEstado);

  if (cargando) return <div className="p-10 text-center font-bold text-gray-400 animate-pulse">Cargando historial...</div>;

  return (
    <div className="flex flex-col h-full bg-slate-50 p-6 font-sans">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-4xl font-black text-gray-900 tracking-tighter uppercase">Historial de Pedidos</h2>
        
        <div className="flex bg-white rounded-2xl p-1 shadow-sm border border-gray-100">
          {['todos', 'pendiente', 'entregado', 'cancelado'].map(estado => (
            <button
              key={estado}
              onClick={() => setFiltroEstado(estado)}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all uppercase ${filtroEstado === estado ? 'bg-red-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {estado}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 overflow-y-auto pr-2">
        {pedidosFiltrados.length === 0 ? (
          <div className="bg-white p-20 rounded-[2.5rem] text-center border-2 border-dashed border-gray-200">
            <p className="text-gray-400 font-bold italic">No hay pedidos registrados en esta categoría.</p>
          </div>
        ) : (
          pedidosFiltrados.map(pedido => (
            <div key={pedido.id} className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center font-black text-lg shadow-inner ${
                  pedido.estado === 'entregado' ? 'bg-green-50 text-green-600' : 
                  pedido.estado === 'pendiente' ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-600'
                }`}>
                  #{pedido.numero_pedido}
                </div>
                <div>
                  <h3 className="font-black text-gray-800 uppercase leading-none">{pedido.nombre_cliente || 'Cliente Anónimo'}</h3>
                  <p className="text-xs text-gray-400 font-bold mt-1">
                    {pedido.tipo_entrega} • {pedido.hora_pedido || 'Sin hora'}
                  </p>
                </div>
              </div>

              <div className="flex-1 px-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Detalle:</p>
                <div className="flex flex-wrap gap-2">
                  {pedido.items?.map((item, i) => (
                    <span key={i} className="bg-slate-50 px-3 py-1 rounded-lg text-[10px] font-black text-gray-600 border border-slate-100 uppercase">
                      {item.cantidad}x {item.nombre}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col items-end gap-3 min-w-[150px]">
                <span className="text-2xl font-black text-gray-900 tracking-tighter">{formatoPeso(pedido.total)}</span>
                <select 
                  value={pedido.estado} 
                  onChange={(e) => cambiarEstado(pedido.id, e.target.value)}
                  className="bg-slate-100 border-none rounded-xl px-3 py-1.5 text-[10px] font-black uppercase text-gray-600 focus:ring-2 focus:ring-red-100 outline-none cursor-pointer"
                >
                  <option value="pendiente">Pendiente</option>
                  <option value="entregado">Entregado</option>
                  <option value="cancelado">Cancelado</option>
                </select>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Para el preview de Canvas
const App = HistorialPedidos;
export default App;