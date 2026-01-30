import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  updateDoc, 
  doc, 
  deleteDoc,
  Timestamp 
} from 'firebase/firestore';

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Saneamiento de appId para Firestore
const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'sushi-app';
const appId = rawAppId.replace(/\//g, '_');

// --- CONTEXTO DE UI ---
const UiContext = createContext();
const useUi = () => useContext(UiContext);

const UiProvider = ({ children }) => {
  const [mensaje, setMensaje] = useState(null);
  const notificar = (msg, tipo) => {
    setMensaje({ msg: String(msg), tipo }); 
    setTimeout(() => setMensaje(null), 3000);
  };
  return (
    <UiContext.Provider value={{ notificar }}>
      {children}
      {mensaje && (
        <div className={`fixed bottom-4 right-4 z-[10000] p-4 rounded-xl shadow-2xl text-white font-black uppercase text-xs animate-bounce ${mensaje.tipo === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {mensaje.msg}
        </div>
      )}
    </UiContext.Provider>
  );
};

// Detectar Electron para impresión
const ipcRenderer = (function() {
  try {
    if (typeof window !== 'undefined' && window.require) {
      const electron = window.require('electron');
      return electron ? electron.ipcRenderer : null;
    }
  } catch (e) { return null; }
  return null;
})();

// --- COMPONENTE PRINCIPAL ---
function HistorialPedidos({ onEditar, ordenParaEditar, user: userProp }) {
  const { notificar } = useUi();
  const [user, setUser] = useState(userProp || null);
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('todos');

  // Estados para Cobro
  const [modalPago, setModalPago] = useState({ show: false, pedido: null });
  const [modoPago, setModoPago] = useState('unico'); 
  const [metodoSeleccionadoUnico, setMetodoSeleccionadoUnico] = useState('Efectivo');
  const [montosPago, setMontosPago] = useState({ Efectivo: '', Tarjeta: '', Transferencia: '', Otro: '' });
  const [metodosHabilitados, setMetodosHabilitados] = useState({ Efectivo: true, Tarjeta: false, Transferencia: false, Otro: false });
  const [aplicarDescuento, setAplicarDescuento] = useState(false);
  const [procesando, setProcesando] = useState(false);

  // Configuración de nombre de colección (RAÍZ)
  const emailUsuario = user?.email || "";
  const esPrueba = emailUsuario === "prueba@isakari.com";
  const colName = esPrueba ? "ordenes_pruebas" : "ordenes";

  // Formateo CLP
  const formatCLP = (v) => v ? v.toString().replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ".") : '';
  const getRawNumber = (v) => Number(v.toString().replace(/\./g, '')) || 0;
  const formatoPeso = (v) => (Number(v) || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });

  // Gestión de Autenticación
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Error de autenticación:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => { if (u) setUser(u); });
    return () => unsubscribe();
  }, []);

  // Escucha de datos
  useEffect(() => {
    if (!user) return;
    setCargando(true);
    const collectionRef = collection(db, colName);
    const unsub = onSnapshot(collectionRef, (snap) => {
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      lista.sort((a, b) => (b.fecha?.toMillis ? b.fecha.toMillis() : 0) - (a.fecha?.toMillis ? a.fecha.toMillis() : 0));
      setPedidos(lista);
      setCargando(false);
    }, (err) => {
      console.error("Error al cargar historial:", err);
      setCargando(false);
    });
    return () => unsub();
  }, [user, colName]);

  // --- ACCIONES DE PEDIDO ---
  const handleReimprimir = (pedido) => {
    if (ipcRenderer) {
      const itemsLimpios = (pedido.items && Array.isArray(pedido.items)) 
        ? JSON.parse(JSON.stringify(pedido.items)) 
        : [];

      ipcRenderer.send('imprimir-ticket-raw', {
        numeroPedido: pedido.numero_pedido || '...',
        cliente: pedido.nombre_cliente || 'Anónimo',
        items: itemsLimpios, 
        total: pedido.total_pagado || pedido.total || 0,
        tipoEntrega: pedido.tipo_entrega || 'LOCAL',
        direccion: pedido.direccion || '',
        telefono: pedido.telefono || '',
        descripcion: pedido.descripcion || '' 
      });
      notificar("Reimprimiendo ticket...", "success");
    } else {
      notificar("Impresora no detectada (Modo Web)", "info");
    }
  };

  const toggleEstado = async (pedido) => {
    const nuevoEstado = pedido.estado === 'entregado' ? 'pendiente' : 'entregado';
    try {
      await updateDoc(doc(db, colName, pedido.id), { estado: nuevoEstado });
      notificar(`Pedido marcado como ${nuevoEstado}`, "success");
    } catch (e) {
      notificar("Error al cambiar estado", "error");
    }
  };

  const eliminarPedido = async (pedido) => {
    if (window.confirm(`¿Eliminar pedido #${pedido.numero_pedido} definitivamente?`)) {
      try {
        await deleteDoc(doc(db, colName, pedido.id));
        notificar("Pedido eliminado", "success");
      } catch (e) {
        notificar("Error al eliminar", "error");
      }
    }
  };

  // --- LÓGICA DE COBRO ---
  const abrirModalPago = (p) => {
    setModalPago({ show: true, pedido: p });
    setModoPago('unico');
    setMetodosHabilitados({ Efectivo: true, Tarjeta: false, Transferencia: false, Otro: false });
    setMontosPago({ Efectivo: '', Tarjeta: '', Transferencia: '', Otro: '' });
    setAplicarDescuento(p.tiene_descuento || false);
  };

  const totalOriginal = modalPago.pedido?.total || 0;
  const montoDescuento = aplicarDescuento ? Math.round(totalOriginal * 0.10) : 0;
  const totalACobrar = totalOriginal - montoDescuento;

  const sumaPagos = Object.entries(montosPago)
    .filter(([m]) => metodosHabilitados[m])
    .reduce((acc, [_, val]) => acc + getRawNumber(val), 0);

  const faltante = Math.max(0, totalACobrar - sumaPagos);
  const vuelto = (metodosHabilitados.Efectivo && sumaPagos > totalACobrar) ? (sumaPagos - totalACobrar) : 0;

  const autocompletarMonto = (metodo) => {
    if (faltante <= 0) return;
    const montoActualEnCampo = getRawNumber(montosPago[metodo] || 0);
    const nuevoMonto = montoActualEnCampo + faltante;
    
    setMetodosHabilitados(prev => ({ ...prev, [metodo]: true }));
    setMontosPago(prev => ({
      ...prev,
      [metodo]: formatCLP(nuevoMonto)
    }));
  };

  const confirmarPago = async () => {
    if (modoPago === 'multiple' && faltante > 0) return;
    setProcesando(true);
    try {
      const p = modalPago.pedido;
      const detalles = modoPago === 'unico' 
        ? [{ metodo: metodoSeleccionadoUnico, monto: totalACobrar }]
        : Object.entries(montosPago).filter(([m]) => metodosHabilitados[m]).map(([m, v]) => ({ metodo: m, monto: getRawNumber(v) }));

      await updateDoc(doc(db, colName, p.id), {
        estado_pago: 'Pagado',
        metodo_pago: modoPago === 'unico' ? metodoSeleccionadoUnico : 'Múltiple',
        detalles_pago: detalles,
        tiene_descuento: aplicarDescuento,
        monto_descuento: montoDescuento,
        total_pagado: totalACobrar,
        fecha_pago: Timestamp.now()
      });
      setModalPago({ show: false, pedido: null });
      notificar("¡Cobro realizado con éxito!", "success");
    } catch (e) { 
        console.error(e);
        notificar("Error al procesar el pago", "error");
    } finally { setProcesando(false); }
  };

  if (cargando && pedidos.length === 0) return <div className="p-10 text-center animate-pulse font-black text-slate-400">CARGANDO HISTORIAL...</div>;

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-50 font-sans">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 m-0">Ventas</h2>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
            {esPrueba ? 'Entorno de Pruebas' : 'Operación Real'}
          </span>
        </div>
        <div className="flex bg-white rounded-2xl p-1 shadow-sm border border-slate-200">
          {['todos', 'pendiente', 'entregado'].map(f => (
            <button key={f} onClick={() => setFiltroEstado(f)} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${filtroEstado === f ? 'bg-slate-900 text-white shadow-md' : 'text-gray-400 hover:text-slate-600'}`}>{f}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 pb-24">
        {pedidos.filter(p => filtroEstado === 'todos' || p.estado === filtroEstado).map(pedido => {
          const isPaid = pedido.estado_pago === 'Pagado';
          const isDelivered = pedido.estado === 'entregado';
          const estaSiendoEditado = ordenParaEditar?.id === pedido.id;
          
          return (
            <div key={pedido.id} className={`p-5 rounded-[2.5rem] border-4 shadow-sm flex items-center justify-between bg-white transition-all ${estaSiendoEditado ? 'border-blue-500 ring-2 ring-blue-50' : (isDelivered ? 'border-green-500' : 'border-amber-400')}`}>
              <div className="flex items-center gap-5 w-[60%]">
                <div className={`w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center font-black text-white text-lg shadow-lg ${isDelivered ? 'bg-green-600 shadow-green-100' : 'bg-amber-500 shadow-amber-100'}`}>#{pedido.numero_pedido}</div>
                <div className="w-full">
                  <h4 className="font-black text-slate-900 uppercase text-base m-0 leading-tight">
                    {String(pedido.nombre_cliente || 'Anónimo')}
                  </h4>
                  <div className="mt-2 flex flex-col gap-1">
                    {pedido.items?.map((item, idx) => (
                      <span key={idx} className="text-[10px] text-slate-600 font-bold uppercase leading-none">• {item.cantidad}x {String(item.nombre)}</span>
                    ))}
                    {pedido.descripcion && (
                      <div className="mt-1 p-2 bg-yellow-50 rounded-lg border border-yellow-100">
                        <p className="text-[9px] text-yellow-800 font-black italic m-0 uppercase">Nota: {String(pedido.descripcion)}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 items-center mt-2">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{pedido.tipo_entrega} • {pedido.hora_pedido}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-6">
                <div className="text-right flex-shrink-0">
                  <div className="text-2xl font-black text-slate-900 tracking-tighter leading-none">{formatoPeso(pedido.total_pagado || pedido.total)}</div>
                  {isPaid && <div className="text-[9px] font-black text-green-600 uppercase tracking-widest mt-1">Pagado</div>}
                </div>
                
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => handleReimprimir(pedido)} className="w-10 h-10 flex items-center justify-center bg-white text-gray-400 rounded-xl border-2 border-gray-100 hover:text-blue-600 hover:border-blue-100 transition-all" title="Reimprimir"><i className="bi bi-printer-fill"></i></button>
                  <button onClick={() => onEditar(pedido)} className={`w-10 h-10 flex items-center justify-center rounded-xl border-2 transition-all ${estaSiendoEditado ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-600 border-blue-100 hover:bg-blue-50'}`} title="Editar"><i className="bi bi-pencil-fill"></i></button>
                  <button onClick={() => toggleEstado(pedido)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border-2 transition-all ${isDelivered ? 'bg-green-600 text-white border-green-600' : 'bg-white text-amber-600 border-amber-200 hover:bg-amber-50'}`}>{isDelivered ? 'ENTREGADO' : 'PENDIENTE'}</button>
                  
                  {!isPaid && <button onClick={() => abrirModalPago(pedido)} className="px-5 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase shadow-lg hover:bg-black transition-all">COBRAR</button>}
                  
                  <button onClick={() => eliminarPedido(pedido)} className="text-gray-300 hover:text-red-600 transition-colors px-2"><i className="bi bi-trash3-fill text-lg"></i></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL DE PAGO */}
      {modalPago.show && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-2" onClick={() => setModalPago({ show: false, pedido: null })}>
          <div className="bg-white rounded-[2rem] shadow-2xl p-5 w-full max-w-md border border-white max-h-[98vh] overflow-hidden flex flex-col scale-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-center font-black uppercase text-lg text-slate-900 mb-3 tracking-tight">Cobrar Pedido #{modalPago.pedido?.numero_pedido}</h3>
            
            <div className="bg-slate-50 p-3 rounded-2xl border-2 border-slate-100 mb-3">
                <div className="flex justify-between items-center mb-1 pb-1 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-[9px] font-black uppercase">¿10% DESC?</span>
                        <button onClick={() => setAplicarDescuento(!aplicarDescuento)} className={`w-8 h-5 rounded-full p-1 transition-colors ${aplicarDescuento ? 'bg-red-600' : 'bg-slate-300'}`}>
                            <div className={`w-3 h-3 bg-white rounded-full transition-transform ${aplicarDescuento ? 'translate-x-3' : ''}`}></div>
                        </button>
                    </div>
                    {aplicarDescuento && <span className="text-red-600 font-black text-[10px]">-{formatoPeso(montoDescuento)}</span>}
                </div>
                <div className="flex justify-between items-center leading-none mt-1">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total</span>
                  <span className="text-2xl font-black text-slate-900 tracking-tighter">{formatoPeso(totalACobrar)}</span>
                </div>
            </div>

            <div className="flex bg-gray-100 p-1 rounded-xl mb-3">
              <button onClick={() => setModoPago('unico')} className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${modoPago === 'unico' ? 'bg-white text-slate-900 shadow' : 'text-gray-400'}`}>Único</button>
              <button onClick={() => setModoPago('multiple')} className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${modoPago === 'multiple' ? 'bg-white text-slate-900 shadow' : 'text-gray-400'}`}>Mixto</button>
            </div>

            {modoPago === 'unico' ? (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {['Efectivo', 'Tarjeta', 'Transferencia', 'Otro'].map(m => (
                  <button key={m} onClick={() => setMetodoSeleccionadoUnico(m)} className={`py-3 rounded-xl font-black text-[10px] border-2 uppercase transition-all ${metodoSeleccionadoUnico === m ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-100 text-gray-400 hover:bg-gray-50'}`}>{m}</button>
                ))}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-2">
                  {['Efectivo', 'Tarjeta', 'Transferencia', 'Otro'].map(m => (
                    <div key={m} className={`flex flex-col p-2 rounded-xl border-2 transition-all ${metodosHabilitados[m] ? 'border-green-200 bg-white' : 'bg-gray-50 opacity-60 border-slate-100'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <div onClick={() => setMetodosHabilitados({...metodosHabilitados, [m]: !metodosHabilitados[m]})} className={`w-4 h-4 rounded flex items-center justify-center cursor-pointer border ${metodosHabilitados[m] ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300'}`}>
                              {metodosHabilitados[m] && <i className="bi bi-check-lg text-[8px]"></i>}
                          </div>
                          <span className="text-[8px] font-black uppercase text-slate-600">{m}</span>
                        </div>
                        {faltante > 0 && (
                          <button 
                            onClick={() => autocompletarMonto(m)}
                            className="w-4 h-4 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center hover:bg-indigo-600 hover:text-white transition-colors"
                            title="Completar saldo"
                          >
                            <i className="bi bi-magic text-[8px]"></i>
                          </button>
                        )}
                      </div>
                      <input 
                        type="text" 
                        className="w-full bg-transparent text-left font-black outline-none text-slate-900 text-[11px]" 
                        placeholder="$0" 
                        value={montosPago[m]} 
                        onChange={e => {
                          setMetodosHabilitados({...metodosHabilitados, [m]: true});
                          setMontosPago({...montosPago, [m]: formatCLP(e.target.value)});
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div className={`mt-3 p-2.5 rounded-xl flex justify-between items-center font-black ${faltante > 0 ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>
                    <span className="uppercase text-[9px] tracking-widest">{faltante > 0 ? 'Pendiente:' : 'Vuelto:'}</span>
                    <span className="text-base tracking-tighter leading-none">{formatoPeso(vuelto > 0 ? vuelto : Math.abs(faltante))}</span>
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
              <button onClick={() => setModalPago({ show: false, pedido: null })} className="flex-1 py-3 text-[10px] font-black text-slate-400 uppercase">Cancelar</button>
              <button onClick={confirmarPago} disabled={procesando || (modoPago === 'multiple' && faltante > 0)} className="flex-[2] py-3 bg-green-600 text-white rounded-xl text-[10px] font-black uppercase shadow-xl active:scale-95 disabled:opacity-50 transition-all">{procesando ? '...' : 'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .scale-in { animation: scaleIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        @keyframes scaleIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}

// Exportamos App
export default function App(props) {
  return (
    <UiProvider>
      <HistorialPedidos {...props} />
    </UiProvider>
  );
}