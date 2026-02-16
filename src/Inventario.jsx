import React, { useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  onSnapshot, 
  query, 
  orderBy,
  enableIndexedDbPersistence
} from 'firebase/firestore';

// --- CONFIGURACIÓN E INICIALIZACIÓN SEGURA DE FIREBASE ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

// Habilitar persistencia local para modo offline
try {
    if (typeof window !== 'undefined') {
        enableIndexedDbPersistence(db).catch(() => {});
    }
} catch (e) {}

// --- DETECCIÓN DE ELECTRON (Para impresión) ---
const ipcRenderer = (function() {
  try {
    if (typeof window !== 'undefined' && window.require) {
      const electron = window.require('electron');
      return electron ? electron.ipcRenderer : null;
    }
  } catch (e) { return null; }
  return null;
})();

export default function Inventario({ user }) {
  const [insumos, setInsumos] = useState([]);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [unidad, setUnidad] = useState('unid');
  const [filtro, setFiltro] = useState('todos'); // todos, faltantes, urgentes
  const [notificacion, setNotificacion] = useState({ mostrar: false, mensaje: '', tipo: '' });

  // Colección en la raíz
  const COL_INVENTARIO = user?.email === "prueba@isakari.com" ? "inventario_pruebas" : "inventario";

  // --- NOTIFICACIONES (Posicionada abajo) ---
  const notificar = (mensaje, tipo = 'success') => {
    setNotificacion({ mostrar: true, mensaje, tipo });
    setTimeout(() => setNotificacion({ mostrar: false, mensaje: '', tipo: '' }), 3000);
  };

  // --- CARGAR DATOS ---
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, COL_INVENTARIO), orderBy('nombre'));
    const unsubscribe = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setInsumos(data);
    }, (error) => console.error("Error inventario:", error));
    return () => unsubscribe();
  }, [user, COL_INVENTARIO]);

  // --- ACCIONES ---
  const agregarInsumo = async (e) => {
    e.preventDefault();
    if (!nuevoNombre.trim()) return;

    try {
      await addDoc(collection(db, COL_INVENTARIO), {
        nombre: nuevoNombre.toUpperCase(),
        cantidad: 0,
        unidad: unidad,
        esUrgente: false,
        fecha_actualizacion: new Date().toISOString()
      });
      setNuevoNombre('');
      notificar("INSUMO AGREGADO", "success");
    } catch (error) {
      console.error(error);
      notificar("ERROR AL AGREGAR", "error");
    }
  };

  const actualizarCantidad = async (id, cantidadActual, delta) => {
    const nuevaCantidad = Math.max(0, cantidadActual + delta);
    await updateDoc(doc(db, COL_INVENTARIO, id), { cantidad: nuevaCantidad });
  };

  const toggleUrgente = async (item) => {
    await updateDoc(doc(db, COL_INVENTARIO, item.id), { esUrgente: !item.esUrgente });
    if (!item.esUrgente) notificar("MARCADO COMO URGENTE", "error");
  };

  const eliminarInsumo = async (id) => {
    if(!window.confirm("¿Borrar este insumo de la lista?")) return;
    await deleteDoc(doc(db, COL_INVENTARIO, id));
    notificar("INSUMO ELIMINADO", "success");
  };

  // --- IMPRESIÓN ---
  const imprimirListaCompras = () => {
    const aComprar = insumos.filter(i => i.cantidad <= 0 || i.esUrgente);

    if (aComprar.length === 0) {
      notificar("NADA PENDIENTE", "success");
      return;
    }

    const listaParaImprimir = aComprar.map(i => {
      let texto = i.nombre;
      if (i.esUrgente) texto += ` (URGENTE)`;
      if (i.cantidad === 0) texto += ` (FALTA)`;
      return texto;
    });

    if (ipcRenderer) {
      ipcRenderer.send('imprimir-ticket-raw', {
        tipo: 'INVENTARIO',
        fecha: new Date().toLocaleDateString('es-CL'),
        items: listaParaImprimir
      });
      notificar("IMPRIMIENDO...", "success");
    } else {
      window.print(); // Fallback para web
    }
  };

  // --- FILTRADO VISUAL ---
  const insumosFiltrados = insumos.filter(item => {
    if (filtro === 'todos') return true;
    if (filtro === 'faltantes') return item.cantidad <= 0;
    if (filtro === 'urgentes') return item.esUrgente;
    return true;
  });

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-100 font-sans text-gray-800 relative">
      
      {/* NOTIFICACIÓN EN LA ESQUINA INFERIOR DERECHA */}
      {notificacion.mostrar && (
        <div className={`fixed bottom-4 right-4 z-[100000] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-right-10 duration-300 ${notificacion.tipo === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
            <span className="text-2xl">{notificacion.tipo === 'error' ? '🔥' : '✅'}</span>
            <div>
                <h4 className="font-black uppercase text-xs opacity-75">{notificacion.tipo === 'error' ? 'Atención' : 'Éxito'}</h4>
                <p className="font-bold text-sm leading-tight">{notificacion.mensaje}</p>
            </div>
        </div>
      )}

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 m-0 leading-none">Control Stock</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Gestión de Insumos</p>
        </div>
        
        <button 
          onClick={imprimirListaCompras}
          className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-black uppercase text-xs shadow-lg hover:bg-black active:scale-95 transition-all flex items-center gap-2"
        >
          <span className="text-lg">🖨️</span> Imprimir Faltantes
        </button>
      </div>

      {/* FORMULARIO AGREGAR */}
      <form onSubmit={agregarInsumo} className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200 mb-6 flex flex-col md:flex-row gap-3 items-center">
        <input 
          type="text" 
          placeholder="Nombre insumo..." 
          className="flex-1 p-3 rounded-xl border-2 border-slate-100 bg-slate-50 font-bold uppercase text-sm outline-none focus:border-slate-300"
          value={nuevoNombre}
          onChange={e => setNuevoNombre(e.target.value)}
        />
        <select 
          className="p-3 rounded-xl border-2 border-slate-100 bg-slate-50 font-bold uppercase text-sm outline-none"
          value={unidad}
          onChange={e => setUnidad(e.target.value)}
        >
          <option value="unid">Unid</option>
          <option value="kg">Kg</option>
          <option value="lts">Lts</option>
          <option value="pqte">Pqte</option>
          <option value="caja">Caja</option>
        </select>
        <button type="submit" className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-black uppercase text-xs hover:bg-emerald-600 transition-all w-full md:w-auto">
          Agregar
        </button>
      </form>

      {/* FILTROS */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {[
            { id: 'todos', label: 'Todos', icon: '📦' }, 
            { id: 'faltantes', label: 'Agotados (0)', icon: '⚠️' }, 
            { id: 'urgentes', label: 'Urgentes', icon: '🔥' }
        ].map(f => (
            <button 
                key={f.id}
                onClick={() => setFiltro(f.id)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all ${filtro === f.id ? 'bg-slate-800 text-white shadow-md' : 'bg-white text-slate-400 hover:bg-slate-50'}`}
            >
                <span>{f.icon}</span> {f.label}
            </button>
        ))}
      </div>

      {/* GRILLA DE INSUMOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-20">
        {insumosFiltrados.map(item => (
          <div key={item.id} className={`bg-white p-4 rounded-3xl border-2 shadow-sm transition-all relative group ${item.esUrgente ? 'border-red-500 ring-2 ring-red-100' : 'border-slate-100 hover:border-slate-300'}`}>
            
            {item.esUrgente && (
                <div className="absolute -top-3 -right-3 bg-red-500 text-white text-[10px] font-black px-3 py-1 rounded-full shadow-md animate-pulse z-10">
                    URGENTE
                </div>
            )}

            <div className="flex justify-between items-start mb-2">
                <h3 className="font-black text-slate-800 uppercase text-sm leading-tight pr-2">{item.nombre}</h3>
                <button onClick={() => eliminarInsumo(item.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                    <i className="bi bi-trash3-fill"></i>
                </button>
            </div>

            <div className="flex items-center justify-between bg-slate-50 rounded-2xl p-1 mb-3">
                <button 
                    onClick={() => actualizarCantidad(item.id, item.cantidad, -1)}
                    className="w-10 h-10 bg-white rounded-xl shadow-sm text-slate-400 hover:text-red-500 font-black text-lg active:scale-95 transition-all"
                >-</button>
                
                <div className="text-center">
                    <span className={`text-xl font-black ${item.cantidad === 0 ? 'text-red-500' : 'text-slate-800'}`}>{item.cantidad}</span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase block leading-none">{item.unidad}</span>
                </div>

                <button 
                    onClick={() => actualizarCantidad(item.id, item.cantidad, 1)}
                    className="w-10 h-10 bg-white rounded-xl shadow-sm text-slate-400 hover:text-emerald-500 font-black text-lg active:scale-95 transition-all"
                >+</button>
            </div>

            <button 
                onClick={() => toggleUrgente(item)}
                className={`w-full py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2 ${item.esUrgente ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
            >
                <i className={`bi ${item.esUrgente ? 'bi-fire' : 'bi-star'}`}></i>
                {item.esUrgente ? 'Marcado Urgente' : 'Marcar Urgente'}
            </button>

          </div>
        ))}
      </div>
    </div>
  );
}