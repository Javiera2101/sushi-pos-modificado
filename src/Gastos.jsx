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
  query,
  orderBy,
  enableIndexedDbPersistence
} from 'firebase/firestore';

// --- CONFIGURACIÓN E INICIALIZACIÓN ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Persistencia Offline
if (typeof window !== 'undefined' && !window.__isakariPersistenceSetup) {
  window.__isakariPersistenceSetup = true;
  try {
    enableIndexedDbPersistence(db).catch(() => {});
  } catch (err) {}
}

// --- DETECCIÓN DE ELECTRON ---
const ipcRenderer = (function() {
  try {
    if (typeof window !== 'undefined' && window.require) {
      const electron = window.require('electron');
      return electron ? electron.ipcRenderer : null;
    } else if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI;
    }
  } catch (e) { return null; }
  return null;
})();

/**
 * LISTA DE INSUMOS OFICIAL (Basada en tu CSV)
 */
const INSUMOS_LISTA = [
    "Camarón", "Kanikama", "Salmón con piel", "Papas fritas", "Pollo", "Arrollado primavera",
    "Gyosas de pollo", "Gyosas de cerdo", "Gyosas de camarón", "Empanadas de queso", "Carne de vacuno",
    "Jamón", "J. serrano", "Salame", "Tocino", "Arroz", "Panko amarillo", "Nori", "Harina de pan",
    "Levadura", "Mix de frutos secos", "Maní", "Queso crema", "Queso gauda", "Mayonesa", "Mostaza",
    "Ketchup", "Miel", "Jengibre", "Wuasabi", "Salsa de tomate", "Vinagre de manzana", "Aceite",
    "Soya", "Merquen", "Sésamo tostado", "Sésamo negro", "Oregano", "Ajo en polvo", "Sal", "Azúcar",
    "Ciboulette", "Cebollín", "Tomate", "Limón", "Pimentón", "Palta", "Aceituna", "Choclo", "Palmito",
    "Cebolla morada", "Pepino", "Zanahoria", "Royo d aluminio", "Nova", "Alusa grande", "Palito",
    "Pote d soya", "Pote agridulce", "Tapas", "Caja d pizza", "Caja de dos roll", "Caja de tres roll",
    "Potes de aluminio chico", "Potes de aluminio mediano", "Potes de aluminio grande",
    "Saco de papel chico", "Saco de papel grande", "Bowl normal", "Bowl grande", "Suchi burger",
    "Suchi pleto", "Royo de impresora", "Corchete", "Scotch", "Lápices pasta azul", "Cloro", 
    "Cloro gel", "Limpia vidrio", "quix", "Limpia piso", "Confort", "Jabón", "esponja",
    "Virutilla", "Trapero", "Bolsas de basura", "Bolsa de basura baño", "Paños", "Bolsa camisetas",
    "Guantes taya S", "Guantes taya M", "Guantes taya L", "Cofias"
];

const getLocalDate = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
};

const formatPeso = (v) => (Number(v) || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

export default function Gastos() {
  const [user, setUser] = useState(null);
  const [listaGastos, setListaGastos] = useState([]);
  const [cargando, setCargando] = useState(true);
  
  const [fechaInicioCaja, setFechaInicioCaja] = useState(null);
  const [idCajaAbierta, setIdCajaAbierta] = useState(null);

  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState(''); 
  const [categoria, setCategoria] = useState('Gasto General');
  const [trabajador, setTrabajador] = useState('');
  const [gastoEditar, setGastoEditar] = useState(null);

  const esPrueba = user?.email === "prueba@isakari.com";
  const colGastos = esPrueba ? "gastos_pruebas" : "gastos";
  const colCajas = esPrueba ? "cajas_pruebas" : "cajas";
  const hoyString = getLocalDate();

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (err) {}
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
        setUser(u);
        if (u) setCargando(false);
    });
    return () => unsubscribe();
  }, []);

  // Escuchar estado de caja abierta
  useEffect(() => {
    if (!user) return;
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

  // Escuchar gastos vinculados al turno actual
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, colGastos), (snap) => {
        const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const filtered = allDocs
            .filter(g => {
                if (!fechaInicioCaja) return false;
                return String(g.fechaString) === fechaInicioCaja;
            })
            .sort((a, b) => (b.fecha?.toMillis() || 0) - (a.fecha?.toMillis() || 0));
        setListaGastos(filtered);
    });
    return () => unsub();
  }, [user, fechaInicioCaja, colGastos]);

  const handleGuardar = async (e) => {
    e.preventDefault();
    if (!user || !descripcion || !monto) return;
    if (!idCajaAbierta) return alert("⚠️ No hay caja abierta. Debe abrir turno en el módulo Caja.");

    const cleanMonto = Number(monto.toString().replace(/\./g, '')) || 0;
    const data = {
      descripcion: String(descripcion).toUpperCase(),
      monto: cleanMonto,
      categoria: String(categoria),
      trabajador: categoria === 'Sueldo' ? String(trabajador).toUpperCase() : '',
      fechaString: fechaInicioCaja || hoyString,
      usuario_id: user.uid,
      fecha: gastoEditar ? gastoEditar.fecha : Timestamp.now(),
      id_caja: idCajaAbierta
    };

    try {
      if (gastoEditar) {
        await updateDoc(doc(db, colGastos, gastoEditar.id), data);
      } else {
        await addDoc(collection(db, colGastos), data);
      }
      limpiar();
    } catch (error) {
      console.error(error);
    }
  };

  const limpiar = () => {
    setDescripcion('');
    setMonto('');
    setCategoria('Gasto General');
    setTrabajador('');
    setGastoEditar(null);
  };

  const iniciarEdicion = (g) => {
    setGastoEditar(g); 
    setDescripcion(g.descripcion); 
    setMonto(g.monto.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")); 
    setCategoria(g.categoria || 'Gasto General'); 
    setTrabajador(g.trabajador || '');
  };

  // --- FUNCIÓN DE IMPRESIÓN COORDINADA CON ELECTRON ---
  const handleImprimirInventario = () => {
    if (ipcRenderer) {
        // Enviamos el mensaje con el flag 'tipo: INVENTARIO'
        // Esto le dice a Electron que use el formato de ticket limpio
        ipcRenderer.send('imprimir-ticket-raw', {
            tipo: 'INVENTARIO',
            items: INSUMOS_LISTA,
            fecha: hoyString.split('-').reverse().join('/')
        });
    } else {
        // Fallback para navegador
        window.print();
    }
  };

  const totalHoy = listaGastos.reduce((acc, g) => acc + (Number(g.monto) || 0), 0);

  if (cargando && !user) return <div className="h-full flex items-center justify-center font-black text-slate-300 animate-pulse uppercase tracking-widest italic">Cargando Gastos...</div>;

  return (
    <div className="flex h-full w-full bg-slate-100 font-sans text-gray-800 overflow-hidden relative">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" />

      {/* SIDEBAR DE REGISTRO */}
      <aside className="w-[380px] h-full bg-white shadow-xl flex flex-col z-20 border-r border-gray-200">
        <div className="p-4 border-b bg-gray-50 flex-shrink-0">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{esPrueba ? 'Pruebas' : 'Producción'}</span>
            <h2 className="text-xl font-black text-gray-900 uppercase tracking-tighter leading-none mt-1">
                {gastoEditar ? 'Editar Egreso' : 'Nueva Salida'}
            </h2>
            <div className={`mt-2 flex items-center gap-2 p-2 rounded-xl border ${idCajaAbierta ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${idCajaAbierta ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
                <span className="text-[9px] font-black uppercase tracking-tighter">
                    {idCajaAbierta ? `Turno: ${fechaInicioCaja}` : 'Caja Cerrada'}
                </span>
            </div>
        </div>

        <form onSubmit={handleGuardar} className="flex-1 flex flex-col min-h-0 relative">
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Categoría</label>
                    <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
                        <button type="button" onClick={() => setCategoria('Gasto General')} className={`flex-1 py-2 rounded-lg text-[9px] font-black transition-all ${categoria !== 'Sueldo' ? 'bg-white shadow text-red-600' : 'text-gray-400'}`}>GENERAL</button>
                        <button type="button" onClick={() => setCategoria('Sueldo')} className={`flex-1 py-2 rounded-lg text-[9px] font-black transition-all ${categoria === 'Sueldo' ? 'bg-white shadow text-blue-600' : 'text-gray-400'}`}>SUELDO</button>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Descripción</label>
                    <input type="text" className="w-full p-3 rounded-xl border border-gray-100 bg-slate-50 outline-none text-xs font-bold uppercase focus:ring-2 focus:ring-red-100 transition-all" placeholder="Ej: Compra verduras..." value={descripcion} onChange={e => setDescripcion(e.target.value)} required />
                </div>

                {categoria === 'Sueldo' && (
                    <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
                        <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">Trabajador</label>
                        <input type="text" className="w-full p-3 rounded-xl border border-blue-100 bg-blue-50 outline-none text-xs font-bold uppercase focus:ring-2 focus:ring-blue-100 transition-all" placeholder="Nombre trabajador..." value={trabajador} onChange={e => setTrabajador(e.target.value)} required />
                    </div>
                )}

                <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Monto $</label>
                    <div className="flex items-center bg-slate-50 rounded-xl border border-gray-100 px-3 overflow-hidden focus-within:ring-2 focus-within:ring-red-100 transition-all">
                        <span className="font-black text-gray-300 text-lg">$</span>
                        <input type="text" className="w-full p-3 bg-transparent outline-none text-xl font-black text-slate-800" placeholder="0" value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, "."))} required />
                    </div>
                </div>
            </div>

            <div className="p-4 pt-2 flex-shrink-0 bg-white border-t border-gray-50">
                 <div className="flex gap-2">
                    {gastoEditar && <button type="button" onClick={limpiar} className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-400 hover:bg-slate-200 transition-all shadow-inner"><i className="bi bi-x-lg"></i></button>}
                    <button type="submit" disabled={!idCajaAbierta} className={`flex-[4] py-4 rounded-2xl font-black text-white text-xs shadow-lg active:scale-95 transition-all uppercase tracking-widest ${gastoEditar ? 'bg-blue-600 shadow-blue-100' : 'bg-red-600 shadow-red-100'} disabled:opacity-30`}>
                        {gastoEditar ? 'Actualizar' : 'Guardar Egreso'}
                    </button>
                 </div>
            </div>
        </form>

        <div className="p-4 bg-slate-900 text-white flex-shrink-0 border-t border-slate-800">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest opacity-60">Total del Turno</span>
            <div className="text-2xl font-black tracking-tighter">{formatPeso(totalHoy)}</div>
        </div>
      </aside>

      {/* LISTADO PRINCIPAL */}
      <main className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden min-w-0">
        <div className="p-6 pb-2 flex-shrink-0 flex justify-between items-start">
            <div>
                <h1 className="text-4xl font-black text-gray-900 uppercase tracking-tighter leading-none">Movimientos</h1>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                    {idCajaAbierta ? `Turno activo: ${fechaInicioCaja}` : 'Abra una caja en el módulo Caja para registrar'}
                </p>
            </div>
            
            <button 
                onClick={handleImprimirInventario}
                className="bg-white border-2 border-slate-200 text-slate-900 px-6 py-3 rounded-2xl text-[11px] font-black uppercase shadow-sm flex items-center gap-2 hover:bg-slate-100 transition-all active:scale-95"
            >
                <i className="bi bi-printer-fill text-lg"></i>
                Lista Insumos
            </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-32 space-y-3 custom-scrollbar">
            {listaGastos.map(g => (
                <div key={g.id} className={`bg-white rounded-3xl p-5 shadow-sm border-2 transition-all hover:shadow-md flex items-center justify-between ${g.categoria === 'Sueldo' ? 'border-blue-100' : 'border-white'}`}>
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl shadow-inner ${g.categoria === 'Sueldo' ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'}`}>
                            <i className={`bi ${g.categoria === 'Sueldo' ? 'bi-person-badge-fill' : 'bi-cart-dash-fill'}`}></i>
                        </div>
                        <div>
                            <h4 className="font-black text-gray-800 uppercase leading-none text-sm">{g.descripcion}</h4>
                            <div className="flex gap-2 items-center mt-1">
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${g.categoria === 'Sueldo' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-gray-500'}`}>{g.categoria}</span>
                                {g.trabajador && <span className="text-[10px] font-bold text-blue-500 uppercase">{g.trabajador}</span>}
                                <span className="text-[10px] text-gray-300 font-bold">• {g.fecha?.seconds ? new Date(g.fecha.seconds * 1000).toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'}) : '--:--'}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-5">
                        <span className="text-xl font-black text-red-600 tracking-tighter">-{ formatPeso(g.monto) }</span>
                        <div className="flex gap-1">
                            <button onClick={() => iniciarEdicion(g)} className="w-10 h-10 flex items-center justify-center bg-slate-50 text-gray-400 rounded-xl hover:text-blue-600 transition-all shadow-sm"><i className="bi bi-pencil-fill"></i></button>
                            <button onClick={async () => { if(window.confirm("¿Borrar registro?")) await deleteDoc(doc(db, colGastos, g.id)); }} className="w-10 h-10 flex items-center justify-center bg-slate-50 text-gray-400 rounded-xl hover:text-red-600 transition-all shadow-sm"><i className="bi bi-trash3-fill"></i></button>
                        </div>
                    </div>
                </div>
            ))}

            {listaGastos.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-300 py-20 opacity-40 italic font-black uppercase text-[10px] tracking-widest text-center">
                    No hay egresos en el turno actual
                </div>
            )}
        </div>
      </main>

      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 6px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }`}</style>
    </div>
  );
}