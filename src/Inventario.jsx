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
  const [busqueda, setBusqueda] = useState(''); // ESTADO PARA EL BUSCADOR
  const [notificacion, setNotificacion] = useState({ mostrar: false, mensaje: '', tipo: '' });

  // Colección en la raíz
  const COL_INVENTARIO = user?.email === "prueba@isakari.com" ? "inventario_pruebas" : "inventario";

  // --- NOTIFICACIONES ---
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
  
  // 1. Imprimir solo faltantes o urgentes (Original)
  const imprimirListaCompras = () => {
    const aComprar = insumos.filter(i => i.cantidad <= 0 || i.esUrgente);

    if (aComprar.length === 0) {
      notificar("NADA PENDIENTE", "success");
      return;
    }

    const listaParaImprimir = aComprar.map(i => i.nombre);

    enviarAImpresora(listaParaImprimir);
  };

  // 2. Imprimir TODO con cantidades actuales (Nuevo)
  const imprimirInventarioCompleto = () => {
    if (insumos.length === 0) {
        notificar("INVENTARIO VACÍO", "error");
        return;
    }

    // Formato: "SALMON (12 KG)"
    // El main.js agregará el "____" al final automáticamente
    const listaParaImprimir = insumos.map(i => `${i.nombre} (${i.cantidad} ${i.unidad})`);

    enviarAImpresora(listaParaImprimir);
  };

  const enviarAImpresora = (items) => {
    if (ipcRenderer) {
        ipcRenderer.send('imprimir-ticket-raw', {
          tipo: 'INVENTARIO',
          fecha: new Date().toLocaleDateString('es-CL'),
          items: items
        });
        notificar("IMPRIMIENDO...", "success");
      } else {
        window.print(); // Fallback para web
      }
  };

  // --- FILTRADO VISUAL (Buscador + Filtro de pestañas) ---
  const insumosFiltrados = insumos.filter(item => {
    // 1. Filtro por texto (Buscador)
    const coincideBusqueda = item.nombre.toLowerCase().includes(busqueda.toLowerCase());
    
    // 2. Filtro por pestañas
    let coincideFiltro = true;
    if (filtro === 'faltantes') coincideFiltro = item.cantidad <= 0;
    if (filtro === 'urgentes') coincideFiltro = item.esUrgente;

    return coincideBusqueda && coincideFiltro;
  });

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-100 font-sans text-gray-800 relative">
      
      {/* NOTIFICACIÓN */}
      {notificacion.mostrar && (
        <div className={`fixed bottom-4 right-4 z-[100000] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-right-10 duration-300 ${notificacion.tipo === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`} style={{ animation: 'slideIn 0.3s ease-out forwards' }}>
            <span className="text-2xl">{notificacion.tipo === 'error' ? '🔥' : '✅'}</span>
            <div>
                <h4 className="font-black uppercase text-xs opacity-75">{notificacion.tipo === 'error' ? 'Atención' : 'Éxito'}</h4>
                <p className="font-bold text-sm leading-tight">{notificacion.mensaje}</p>
            </div>
        </div>
      )}

      {/* HEADER Y BOTONES DE IMPRESIÓN */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 m-0 leading-none">Control Stock</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Gestión de Insumos</p>
        </div>
        
        <div className="flex gap-2 flex-wrap">
            {/* BOTÓN 1: IMPRIMIR TODO */}
            <button 
            onClick={imprimirInventarioCompleto}
            className="bg-slate-700 text-white px-5 py-3 rounded-2xl font-black uppercase text-[10px] shadow-lg hover:bg-slate-900 active:scale-95 transition-all flex items-center gap-2"
            >
            <i className="bi bi-card-checklist text-lg"></i> Imprimir Todo
            </button>

            {/* BOTÓN 2: IMPRIMIR FALTANTES */}
            <button 
            onClick={imprimirListaCompras}
            className="bg-slate-900 text-white px-5 py-3 rounded-2xl font-black uppercase text-[10px] shadow-lg hover:bg-black active:scale-95 transition-all flex items-center gap-2"
            >
            <i className="bi bi-printer-fill text-lg"></i> Solo Faltantes
            </button>
        </div>
      </div>

      {/* FORMULARIO AGREGAR */}
      <form onSubmit={agregarInsumo} className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200 mb-6 flex flex-col md:flex-row gap-3 items-center">
        <input 
          type="text" 
          placeholder="NOMBRE NUEVO INSUMO..." 
          className="flex-1 p-3 rounded-xl border-2 border-slate-100 bg-slate-50 font-bold uppercase text-sm outline-none focus:border-slate-300 transition-all placeholder:text-slate-300"
          value={nuevoNombre}
          onChange={e => setNuevoNombre(e.target.value)}
        />
        <select 
          className="p-3 rounded-xl border-2 border-slate-100 bg-slate-50 font-bold uppercase text-sm outline-none cursor-pointer"
          value={unidad}
          onChange={e => setUnidad(e.target.value)}
        >
          <option value="unid">Unid</option><option value="kg">Kg</option><option value="lts">Lts</option><option value="pqte">Pqte</option><option value="caja">Caja</option>
        </select>
        <button type="submit" className="bg-emerald-500 text-white px-6 py-3 rounded-xl font-black uppercase text-xs hover:bg-emerald-600 transition-all w-full md:w-auto shadow-md shadow-emerald-200">
          + Agregar
        </button>
      </form>

      {/* BARRA DE FILTROS Y BUSCADOR */}
      <div className="flex flex-col md:flex-row gap-4 mb-6 justify-between items-center">
        {/* PESTAÑAS DE FILTRO */}
        <div className="flex gap-2 overflow-x-auto pb-2 w-full md:w-auto">
            {[
                { id: 'todos', label: 'Todos', icon: '📦' }, 
                { id: 'faltantes', label: 'Agotados (0)', icon: '⚠️' }, 
                { id: 'urgentes', label: 'Urgentes', icon: '🔥' }
            ].map(f => (
                <button 
                    key={f.id}
                    onClick={() => setFiltro(f.id)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all whitespace-nowrap ${filtro === f.id ? 'bg-slate-800 text-white shadow-md' : 'bg-white text-slate-400 hover:bg-slate-50'}`}
                >
                    <span>{f.icon}</span> {f.label}
                </button>
            ))}
        </div>

        {/* BUSCADOR */}
        <div className="relative w-full md:w-72 group">
            <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-red-500 transition-colors"></i>
            <input 
                type="text" 
                placeholder="BUSCAR INSUMO..." 
                className="w-full pl-9 pr-4 py-2 rounded-xl border-2 border-slate-100 bg-white font-bold uppercase text-xs outline-none focus:border-red-500 transition-all shadow-sm"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
            />
            {busqueda && (
                <button 
                    onClick={() => setBusqueda('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                >
                    <i className="bi bi-x-circle-fill"></i>
                </button>
            )}
        </div>
      </div>

      {/* GRILLA DE INSUMOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-20 animate-fade-in">
        {insumosFiltrados.length > 0 ? (
            insumosFiltrados.map(item => (
            <div key={item.id} className={`bg-white p-4 rounded-3xl border-2 shadow-sm transition-all relative group ${item.esUrgente ? 'border-red-500 ring-2 ring-red-100' : 'border-slate-100 hover:border-slate-300'}`}>
                
                {item.esUrgente && (
                    <div className="absolute -top-3 -right-3 bg-red-500 text-white text-[10px] font-black px-3 py-1 rounded-full shadow-md animate-pulse z-10">
                        URGENTE
                    </div>
                )}

                <div className="flex justify-between items-start mb-2">
                    <h3 className="font-black text-slate-800 uppercase text-sm leading-tight pr-2 break-words">{item.nombre}</h3>
                    <button onClick={() => eliminarInsumo(item.id)} className="text-slate-300 hover:text-red-500 transition-colors p-1">
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
            ))
        ) : (
            <div className="col-span-full py-20 text-center text-slate-300 font-black uppercase text-xs tracking-widest flex flex-col items-center">
                <i className="bi bi-box-seam text-4xl mb-4 opacity-50"></i>
                {busqueda ? "No se encontraron insumos con ese nombre" : "No hay insumos en esta categoría"}
            </div>
        )}
      </div>
      <style>{`@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } } .animate-fade-in { animation: fadeIn 0.3s ease-out; } @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}