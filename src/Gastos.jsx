import React, { useState, useEffect } from 'react';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  onSnapshot,
  doc,
  updateDoc,
  Timestamp,
  deleteDoc,
  addDoc,
  enableIndexedDbPersistence,
  query,
  where
} from 'firebase/firestore';

// --- 1. CONFIGURACIÓN E INICIALIZACIÓN SEGURA ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/**
 * ACTIVACIÓN SEGURA DEL MODO OFFLINE
 */
if (typeof window !== 'undefined' && !window.__isakariPersistenceSetup) {
  window.__isakariPersistenceSetup = true;
  try {
    enableIndexedDbPersistence(db).catch((err) => {
      if (err.code === 'failed-precondition') {
        console.warn("Persistencia: Múltiples pestañas abiertas.");
      } else if (err.code === 'unimplemented') {
        console.warn("Persistencia: Navegador no compatible.");
      }
    });
  } catch (err) {
    console.log("Caché ya configurada.");
  }
}

// Función de fecha local YYYY-MM-DD
const getLocalDate = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
};

/**
 * COMPONENTE GASTOS (Exportado como App para el Canvas)
 */
export default function App() {
  const [user, setUser] = useState(null);
  const [listaGastos, setListaGastos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  // Estado de Caja Abierta
  const [fechaInicioCaja, setFechaInicioCaja] = useState(null);
  const [idCajaAbierta, setIdCajaAbierta] = useState(null);

  // Formulario
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState(''); 
  const [categoria, setCategoria] = useState('Gasto General');
  const [trabajador, setTrabajador] = useState('');
  const [gastoEditar, setGastoEditar] = useState(null);

  const emailUsuario = user?.email || "";
  const esPrueba = emailUsuario === "prueba@isakari.com";
  
  const colGastos = esPrueba ? "gastos_pruebas" : "gastos";
  const colCajas = esPrueba ? "cajas_pruebas" : "cajas";
  
  const hoyString = getLocalDate();

  // Gestión de Red
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

  // 1. Autenticación inicial
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error("Error Auth:", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
        setUser(u);
        if (u) setCargando(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Detectar Caja Abierta para filtrar por turno
  useEffect(() => {
    if (!user) return;
    
    // Buscamos en la colección de cajas una que esté abierta
    const unsubCaja = onSnapshot(collection(db, colCajas), (snap) => {
        const abierta = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .find(c => c.estado === "abierta");
        
        if (abierta) {
            setIdCajaAbierta(abierta.id);
            setFechaInicioCaja(abierta.fechaString || hoyString);
        } else {
            setIdCajaAbierta(null);
            setFechaInicioCaja(null);
        }
    });
    
    return () => unsubCaja();
  }, [user, colCajas, hoyString]);

  // 3. Escucha de Gastos filtrados por el inicio de la caja
  useEffect(() => {
    if (!user) return;
    
    const unsub = onSnapshot(collection(db, colGastos), (snap) => {
        const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        // FILTRO CRÍTICO: Solo mostramos si hay una fecha de inicio de caja detectada
        const filtered = allDocs
            .filter(g => {
                if (!fechaInicioCaja) return false; // Si no hay caja abierta, no mostramos nada según solicitud
                return String(g.fechaString) >= fechaInicioCaja;
            })
            .sort((a, b) => (b.fecha?.toMillis() || 0) - (a.fecha?.toMillis() || 0));
            
        setListaGastos(filtered);
    }, (err) => {
        console.error("Error en Firebase Gastos:", err);
    });
    
    return () => unsub();
  }, [user, fechaInicioCaja, colGastos]);

  const handleGuardar = async (e) => {
    e.preventDefault();
    if (!user || !descripcion || !monto) return;
    if (!idCajaAbierta) {
        alert("⚠️ No puedes registrar gastos sin una caja abierta.");
        return;
    }

    const cleanMonto = Number(monto.toString().replace(/\./g, '')) || 0;
    const data = {
      descripcion: String(descripcion).toUpperCase(),
      monto: cleanMonto,
      categoria: String(categoria),
      trabajador: categoria === 'Sueldo' ? String(trabajador).toUpperCase() : '',
      fechaString: hoyString,
      usuario_id: user.uid,
      fecha: gastoEditar ? gastoEditar.fecha : Timestamp.now(),
      id_caja: idCajaAbierta // Vinculamos el gasto al ID de la caja actual
    };

    try {
      if (gastoEditar) {
        await updateDoc(doc(db, colGastos, gastoEditar.id), data);
      } else {
        await addDoc(collection(db, colGastos), data);
      }
      limpiar();
    } catch (error) { 
      console.error("Error al guardar:", error);
    }
  };

  const limpiar = () => {
    setDescripcion(''); setMonto(''); setCategoria('Gasto General'); setTrabajador(''); setGastoEditar(null);
  };

  const iniciarEdicion = (g) => {
    setGastoEditar(g); 
    setDescripcion(g.descripcion); 
    setMonto(g.monto.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")); 
    setCategoria(g.categoria || 'Gasto General'); 
    setTrabajador(g.trabajador || '');
  };

  const formatPeso = (v) => (Number(v) || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });
  const totalHoy = listaGastos.reduce((acc, g) => acc + (Number(g.monto) || 0), 0);

  if (cargando && !user) return (
    <div className="h-screen flex items-center justify-center bg-slate-900 font-black text-slate-500 uppercase tracking-widest animate-pulse">
        Sincronizando Isakari...
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-gray-800 overflow-hidden">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" />

      {/* SIDEBAR DE REGISTRO */}
      <aside className="w-[380px] h-full bg-white shadow-xl flex flex-col z-20 border-r border-gray-200">
        <div className="p-4 border-b bg-gray-50 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
                <span className={`text-[9px] font-black px-3 py-1 rounded-full border ${isOnline ? 'bg-green-50 text-green-600 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                    {isOnline ? 'ONLINE' : 'OFFLINE'}
                </span>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{esPrueba ? 'Pruebas' : 'Producción'}</span>
            </div>
            <h2 className="text-xl font-black text-gray-900 uppercase tracking-tighter leading-none mb-1">
                {gastoEditar ? 'Editar Registro' : 'Nueva Salida'}
            </h2>
            
            {/* Indicador de Estado de Caja */}
            <div className={`mt-2 flex items-center gap-2 p-2 rounded-xl border ${idCajaAbierta ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${idCajaAbierta ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
                <span className="text-[9px] font-black uppercase tracking-tighter">
                    {idCajaAbierta ? `Caja Abierta: ${fechaInicioCaja}` : 'Caja Cerrada (No puedes registrar)'}
                </span>
            </div>
        </div>

        <form onSubmit={handleGuardar} className="p-4 flex-1 space-y-4 overflow-y-auto custom-scrollbar">
            <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Categoría</label>
                <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
                    <button type="button" onClick={() => setCategoria('Gasto General')} className={`flex-1 py-2 rounded-lg text-[9px] font-black transition-all ${categoria !== 'Sueldo' ? 'bg-white shadow text-red-600' : 'text-gray-400'}`}>GENERAL</button>
                    <button type="button" onClick={() => setCategoria('Sueldo')} className={`flex-1 py-2 rounded-lg text-[9px] font-black transition-all ${categoria === 'Sueldo' ? 'bg-white shadow text-blue-600' : 'text-gray-400'}`}>SUELDO</button>
                </div>
            </div>

            <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Descripción</label>
                <input type="text" className="w-full p-3 rounded-xl border border-gray-100 bg-slate-50 focus:ring-2 focus:ring-red-100 outline-none text-xs font-bold uppercase" placeholder="Ej: Compra de mercadería..." value={descripcion} onChange={e => setDescripcion(e.target.value)} required />
            </div>

            {categoria === 'Sueldo' && (
                <div className="space-y-1.5 animate-fade-in">
                    <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">Trabajador</label>
                    <input type="text" className="w-full p-3 rounded-xl border border-blue-100 bg-blue-50 focus:ring-2 focus:ring-blue-200 outline-none text-xs font-bold uppercase" placeholder="Nombre completo..." value={trabajador} onChange={e => setTrabajador(e.target.value)} required />
                </div>
            )}

            <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Monto $</label>
                <div className="flex items-center bg-slate-50 rounded-xl border border-gray-100 focus-within:ring-2 focus-within:ring-red-100 px-3 overflow-hidden">
                    <span className="font-black text-gray-300 text-lg">$</span>
                    <input 
                      type="text" 
                      className="w-full p-3 bg-transparent outline-none text-xl font-black text-slate-800" 
                      placeholder="0" 
                      value={monto} 
                      onChange={(e) => setMonto(e.target.value.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, "."))} 
                      required 
                    />
                </div>
            </div>

            <div className="pt-4 flex gap-2">
                {gastoEditar && (
                    <button type="button" onClick={limpiar} className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-400 transition-all hover:bg-slate-200"><i className="bi bi-x-lg"></i></button>
                )}
                <button type="submit" disabled={!idCajaAbierta} className={`flex-[4] py-4 rounded-2xl font-black text-white text-xs shadow-lg active:scale-95 transition-all uppercase tracking-widest disabled:opacity-30 disabled:grayscale ${gastoEditar ? 'bg-blue-600 shadow-blue-100' : 'bg-red-600 shadow-red-100'}`}>
                    <i className={`bi ${gastoEditar ? 'bi-save-fill' : 'bi-plus-circle-fill'} me-2`}></i>
                    {gastoEditar ? 'Actualizar' : 'Guardar Egreso'}
                </button>
            </div>
        </form>

        <div className="p-4 bg-slate-900 text-white flex-shrink-0 border-t border-slate-800">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Total del Turno</span>
            <div className="text-2xl font-black tracking-tighter">{formatPeso(totalHoy)}</div>
        </div>
      </aside>

      {/* LISTADO DE GASTOS */}
      <main className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
        <div className="p-6 pb-2">
            <h1 className="text-4xl font-black text-gray-900 uppercase tracking-tighter leading-none">Movimientos del Turno</h1>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                {idCajaAbierta ? `Filtrando gastos desde: ${fechaInicioCaja}` : 'Abra una caja para visualizar los egresos'}
            </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
            {listaGastos.map(g => (
                <div key={g.id} className={`bg-white rounded-3xl p-5 shadow-sm border-2 transition-all hover:shadow-md flex items-center justify-between ${g.categoria === 'Sueldo' ? 'border-blue-100' : 'border-white'}`}>
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl shadow-inner ${g.categoria === 'Sueldo' ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'}`}>
                            <i className={`bi ${g.categoria === 'Sueldo' ? 'bi-person-badge-fill' : 'bi-cart-dash-fill'}`}></i>
                        </div>
                        <div>
                            <h4 className="font-black text-gray-800 uppercase leading-none text-sm">{String(g.descripcion)}</h4>
                            <div className="flex gap-2 items-center mt-1">
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${g.categoria === 'Sueldo' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-gray-500'}`}>
                                    {String(g.categoria || 'Gasto')}
                                </span>
                                {g.trabajador && <span className="text-[10px] font-bold text-blue-500 uppercase">{String(g.trabajador)}</span>}
                                <span className="text-[10px] text-gray-300 font-bold">• {g.fecha?.seconds ? new Date(g.fecha.seconds * 1000).toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-5">
                        <span className="text-xl font-black text-red-600 tracking-tighter">-{ formatPeso(g.monto) }</span>
                        <div className="flex gap-1">
                            <button onClick={() => iniciarEdicion(g)} className="w-10 h-10 flex items-center justify-center bg-slate-50 text-gray-400 rounded-xl hover:text-blue-600 hover:bg-blue-50 transition-all"><i className="bi bi-pencil-fill"></i></button>
                            <button onClick={async () => { if(window.confirm("¿Borrar registro?")) await deleteDoc(doc(db, colGastos, g.id)); }} className="w-10 h-10 flex items-center justify-center bg-slate-50 text-gray-400 rounded-xl hover:text-red-600 hover:bg-red-50 transition-all"><i className="bi bi-trash3-fill"></i></button>
                        </div>
                    </div>
                </div>
            ))}
            
            {listaGastos.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-300 py-20 opacity-40">
                    <i className={`bi ${idCajaAbierta ? 'bi-receipt-cutoff' : 'bi-lock-fill'} text-6xl mb-4`}></i>
                    <p className="font-black uppercase tracking-widest text-[10px] text-center max-w-[250px]">
                        {idCajaAbierta 
                            ? "No hay egresos registrados en el turno actual" 
                            : "Debe abrir una caja en el módulo 'Caja' para ver y registrar movimientos"}
                    </p>
                </div>
            )}
        </div>
      </main>
      <style>{`
        .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </div>
  );
}