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
  updateDoc,
  Timestamp
} from 'firebase/firestore';

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// CORRECCIÓN: Apuntar a 'sushi' por defecto
const appId = typeof __app_id !== 'undefined' ? __app_id : 'sushi';

// --- DETECCIÓN SEGURA DE ELECTRON ---
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
  
  // Manejamos dos listas para la búsqueda híbrida
  const [pedidosRaiz, setPedidosRaiz] = useState([]);
  const [pedidosArtifact, setPedidosArtifact] = useState([]);
  
  // Lista combinada final
  const [pedidos, setPedidos] = useState([]);
  
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('todos');

  // --- ESTADOS PARA EL PAGO ---
  const [modalPago, setModalPago] = useState({ show: false, pedido: null });
  const [modoPago, setModoPago] = useState('unico'); // 'unico' o 'multiple'
  const [metodoSeleccionadoUnico, setMetodoSeleccionadoUnico] = useState('Efectivo');
  const [aplicarDescuento, setAplicarDescuento] = useState(false);
  const [procesando, setProcesando] = useState(false);
  
  // Estados para Pago Múltiple (Cuadrícula 2x2)
  const [metodosHabilitados, setMetodosHabilitados] = useState({
      Efectivo: true,
      Tarjeta: false,
      Transferencia: false,
      Otro: false
  });
  const [montosPago, setMontosPago] = useState({
      Efectivo: '',
      Tarjeta: '',
      Transferencia: '',
      Otro: ''
  });

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

  // Listeners
  useEffect(() => {
    if (!user) return;
    setCargando(true);
    const unsubRaiz = onSnapshot(collection(db, COL_ORDENES), (snapshot) => {
        setPedidosRaiz(snapshot.docs.map(d => ({ id: d.id, ...d.data(), _origen: 'raiz' })));
    });
    const unsubArtifact = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', COL_ORDENES), (snapshot) => {
        setPedidosArtifact(snapshot.docs.map(d => ({ id: d.id, ...d.data(), _origen: 'artifact' })));
    });
    return () => { unsubRaiz(); unsubArtifact(); };
  }, [user, appId, COL_ORDENES]);

  // Unificar pedidos
  useEffect(() => {
      const mapaPedidos = new Map();
      [...pedidosRaiz, ...pedidosArtifact].forEach(p => mapaPedidos.set(p.id, p));
      const listaUnica = Array.from(mapaPedidos.values());
      listaUnica.sort((a, b) => (b.fecha?.toMillis ? b.fecha.toMillis() : 0) - (a.fecha?.toMillis ? a.fecha.toMillis() : 0));
      setPedidos(listaUnica);
      setCargando(false);
  }, [pedidosRaiz, pedidosArtifact]);

  const cambiarEstado = async (id, nuevoEstado, origen) => {
    try {
      const pedidoRef = origen === 'raiz' 
        ? doc(db, COL_ORDENES, id) 
        : doc(db, 'artifacts', appId, 'public', 'data', COL_ORDENES, id);
      await updateDoc(pedidoRef, { estado: nuevoEstado });
    } catch (e) { console.error(e); }
  };

  const abrirModalPago = (pedido) => {
      setModalPago({ show: true, pedido });
      setModoPago('unico');
      setMetodoSeleccionadoUnico('Efectivo');
      setAplicarDescuento(pedido.tiene_descuento || false);
      setMetodosHabilitados({ Efectivo: true, Tarjeta: false, Transferencia: false, Otro: false });
      setMontosPago({ Efectivo: '', Tarjeta: '', Transferencia: '', Otro: '' });
  };

  // --- LÓGICA DE CÁLCULO ---
  const totalOriginal = modalPago.pedido?.total || 0;
  const montoDescuento = aplicarDescuento ? Math.round(totalOriginal * 0.10) : 0;
  const totalACobrar = totalOriginal - montoDescuento;

  const sumaPagosMultiples = Object.entries(montosPago)
    .filter(([metodo]) => metodosHabilitados[metodo])
    .reduce((acc, [_, val]) => acc + (parseInt(val) || 0), 0);
    
  const faltante = modoPago === 'unico' ? 0 : Math.max(0, totalACobrar - sumaPagosMultiples);
  const vuelto = modoPago === 'multiple' && metodosHabilitados.Efectivo && sumaPagosMultiples > totalACobrar 
                 ? sumaPagosMultiples - totalACobrar 
                 : 0;

  const autocompletarMonto = (metodo) => {
      const otrosMontos = Object.entries(montosPago)
        .filter(([key]) => key !== metodo && metodosHabilitados[key])
        .reduce((acc, [_, val]) => acc + (parseInt(val) || 0), 0);
      
      const nuevoMonto = Math.max(0, totalACobrar - otrosMontos);
      setMontosPago({ ...montosPago, [metodo]: nuevoMonto > 0 ? nuevoMonto.toString() : '' });
  };

  const toggleMetodo = (metodo) => {
      const nuevoEstado = !metodosHabilitados[metodo];
      setMetodosHabilitados({ ...metodosHabilitados, [metodo]: nuevoEstado });
      if (!nuevoEstado) {
          setMontosPago({ ...montosPago, [metodo]: '' });
      } else {
          autocompletarMonto(metodo);
      }
  };

  const confirmarPago = async () => {
      if (modoPago === 'multiple' && faltante > 0) return;
      
      setProcesando(true);
      try {
          const { id, _origen } = modalPago.pedido;
          const pedidoRef = _origen === 'raiz' 
            ? doc(db, COL_ORDENES, id) 
            : doc(db, 'artifacts', appId, 'public', 'data', COL_ORDENES, id);

          const detalles = modoPago === 'unico' 
            ? [{ metodo: metodoSeleccionadoUnico, monto: totalACobrar }]
            : Object.entries(montosPago)
                .filter(([metodo, monto]) => metodosHabilitados[metodo] && (parseInt(monto) || 0) > 0)
                .map(([metodo, monto]) => ({ metodo, monto: parseInt(monto) }));

          await updateDoc(pedidoRef, { 
              estado_pago: 'Pagado',
              metodo_pago: modoPago === 'unico' ? metodoSeleccionadoUnico : (detalles.length > 1 ? 'Múltiple' : detalles[0]?.metodo || 'Otro'),
              detalles_pago: detalles,
              tiene_descuento: aplicarDescuento,
              monto_descuento: montoDescuento,
              total_pagado: totalACobrar,
              fecha_pago: Timestamp.now()
          });
          setModalPago({ show: false, pedido: null });
      } catch (e) { 
          alert("Error al registrar el pago"); 
      } finally {
          setProcesando(false);
      }
  };

  const formatoPeso = (v) => v?.toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });

  return (
    <div className="flex flex-col h-full bg-slate-50 p-4 font-sans relative text-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-black text-gray-900 tracking-tighter uppercase">Historial de Pedidos</h2>
        <div className="flex bg-white rounded-xl p-1 shadow-sm border border-gray-100">
          {['todos', 'pendiente', 'entregado', 'cancelado'].map(estado => (
            <button key={estado} onClick={() => setFiltroEstado(estado)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all uppercase ${filtroEstado === estado ? 'bg-red-600 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'}`}>{estado}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 overflow-y-auto pr-1 pb-20">
        {pedidos.filter(p => filtroEstado === 'todos' || p.estado === filtroEstado).map(pedido => (
            <div key={pedido.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-black text-base shadow-inner ${pedido.estado === 'entregado' ? 'bg-green-50 text-green-600' : pedido.estado === 'pendiente' ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-600'}`}>#{pedido.numero_pedido}</div>
                <div>
                  <h3 className="font-black text-gray-800 uppercase leading-none text-sm">{pedido.nombre_cliente || 'Cliente Anónimo'}</h3>
                  <p className="text-[10px] text-gray-400 font-bold mt-1 uppercase tracking-widest">{pedido.tipo_entrega} • {pedido.hora_pedido}</p>
                </div>
              </div>
              <div className="flex-1 px-2">
                <div className="flex flex-wrap gap-1">
                  {pedido.items?.map((item, i) => (
                    <span key={i} className="bg-slate-50 px-2 py-0.5 rounded text-[9px] font-black text-gray-500 border border-slate-100 uppercase">{item.cantidad}x {item.nombre}</span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 min-w-[150px]">
                <div className="text-right">
                    {pedido.tiene_descuento && <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold mb-1 block">10% OFF</span>}
                    <span className="text-xl font-black text-gray-900 tracking-tighter">{formatoPeso(pedido.total_pagado || pedido.total)}</span>
                </div>
                <div className="flex gap-2">
                    <select value={pedido.estado} onChange={(e) => cambiarEstado(pedido.id, e.target.value, pedido._origen)} className="bg-slate-100 rounded-lg px-2 py-1 text-[9px] font-black uppercase text-gray-600 outline-none cursor-pointer">
                        <option value="pendiente">Pendiente</option>
                        <option value="entregado">Entregado</option>
                        <option value="cancelado">Cancelado</option>
                    </select>
                    {pedido.estado_pago === 'Pagado' ? (
                        <div className="flex items-center gap-1 text-[9px] font-black text-green-600 bg-green-50 px-2 py-1 rounded-lg border border-green-100 uppercase tracking-widest">PAGADO</div>
                    ) : (
                        <button onClick={() => abrirModalPago(pedido)} className="bg-slate-800 text-white px-3 py-1 rounded-lg text-[9px] font-black hover:bg-slate-700 transition-colors uppercase">Cobrar</button>
                    )}
                </div>
              </div>
            </div>
        ))}
      </div>

      {modalPago.show && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-fade-in border border-gray-100 max-h-[90vh] overflow-y-auto">
                  
                  <div className="text-center mb-4">
                      <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight">Cobrar Pedido #{modalPago.pedido?.numero_pedido}</h3>
                  </div>

                  {/* DESCUENTO Y RESUMEN */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-4">
                      <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-200">
                          <div className="flex items-center gap-2">
                              <span className="text-gray-600 text-[10px] font-black uppercase">¿10% OFF?</span>
                              <button onClick={() => setAplicarDescuento(!aplicarDescuento)} className={`w-8 h-5 rounded-full p-0.5 transition-colors ${aplicarDescuento ? 'bg-red-600' : 'bg-slate-300'}`}>
                                  <div className={`w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-transform ${aplicarDescuento ? 'translate-x-3' : ''}`}></div>
                              </button>
                          </div>
                          {aplicarDescuento && <span className="text-red-600 font-black text-[11px]">-{formatoPeso(montoDescuento)}</span>}
                      </div>
                      <div className="flex justify-between items-center">
                          <span className="text-gray-900 text-[10px] font-black uppercase tracking-widest">Total</span>
                          <div className="text-2xl font-black text-gray-900 tracking-tighter">{formatoPeso(totalACobrar)}</div>
                      </div>
                  </div>
                  
                  {/* SELECTOR DE MODO */}
                  <div className="flex bg-gray-100 p-1 rounded-lg mb-4">
                      <button onClick={() => setModoPago('unico')} className={`flex-1 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${modoPago === 'unico' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'}`}>Único</button>
                      <button onClick={() => setModoPago('multiple')} className={`flex-1 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${modoPago === 'multiple' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'}`}>Múltiple</button>
                  </div>

                  {/* CONTENIDO SEGÚN MODO */}
                  {modoPago === 'unico' ? (
                      <div className="grid grid-cols-2 gap-2 mb-6">
                          {['Efectivo', 'Tarjeta', 'Transferencia', 'Otro'].map(m => (
                              <button 
                                key={m} 
                                onClick={() => setMetodoSeleccionadoUnico(m)} 
                                className={`py-2.5 rounded-xl font-black text-[10px] border-2 transition-all flex items-center justify-center gap-1 uppercase ${metodoSeleccionadoUnico === m ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-100 text-gray-400 hover:bg-gray-50'}`}
                              >
                                  {m}
                              </button>
                          ))}
                      </div>
                  ) : (
                      <div className="mb-4">
                          <div className="grid grid-cols-2 gap-2 mb-4">
                              {['Efectivo', 'Tarjeta', 'Transferencia', 'Otro'].map(metodo => (
                                  <div key={metodo} className={`relative flex flex-col p-2 rounded-xl border transition-all ${metodosHabilitados[metodo] ? 'bg-white border-green-200 shadow-sm' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                                      <div className="flex justify-between items-center mb-1">
                                          <button onClick={() => toggleMetodo(metodo)} className={`w-4 h-4 rounded flex items-center justify-center transition-colors border ${metodosHabilitados[metodo] ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-gray-300 text-transparent'}`}>
                                              <i className="bi bi-check-lg text-[8px]"></i>
                                          </button>
                                          <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{metodo}</span>
                                      </div>
                                      
                                      <div className="flex items-center gap-1">
                                          <input 
                                              type="number" 
                                              placeholder="0"
                                              disabled={!metodosHabilitados[metodo]}
                                              className={`w-full bg-transparent border-none p-0 text-xs font-black text-gray-900 focus:ring-0 outline-none ${!metodosHabilitados[metodo] ? 'text-gray-300' : ''}`}
                                              value={montosPago[metodo]}
                                              onChange={(e) => setMontosPago({...montosPago, [metodo]: e.target.value})}
                                              onFocus={(e) => e.target.select()}
                                          />
                                          {metodosHabilitados[metodo] && (
                                              <button 
                                                  onClick={() => autocompletarMonto(metodo)}
                                                  className="text-green-600 hover:text-green-800 bg-green-50 p-1 rounded transition-colors flex items-center justify-center border border-green-100"
                                              >
                                                  <i className="bi bi-magic text-[10px]"></i>
                                              </button>
                                          )}
                                      </div>
                                  </div>
                              ))}
                          </div>

                          <div className={`p-3 rounded-xl border flex justify-between items-center ${faltante > 0 ? 'bg-amber-50 border-amber-100 text-amber-600' : (vuelto > 0 ? 'bg-blue-50 border-blue-100 text-blue-600' : 'bg-green-50 border-green-100 text-green-600')}`}>
                              <span className="text-[9px] font-black uppercase">{faltante > 0 ? 'Falta:' : (vuelto > 0 ? 'Vuelto:' : 'Listo:')}</span>
                              <span className="font-black text-lg tracking-tighter">{formatoPeso(vuelto > 0 ? vuelto : Math.abs(faltante))}</span>
                          </div>
                      </div>
                  )}

                  <div className="flex gap-2 mt-4">
                      <button onClick={() => setModalPago({ show: false, pedido: null })} className="flex-1 py-3 rounded-xl font-black text-gray-400 hover:bg-slate-100 transition-colors uppercase text-[10px]">Cancelar</button>
                      <button onClick={confirmarPago} disabled={(modoPago === 'multiple' && faltante > 0) || procesando} className="flex-[2] py-3 rounded-xl font-black bg-green-600 text-white shadow-lg shadow-green-100 hover:bg-green-700 disabled:opacity-30 transition-all uppercase text-[10px]">
                          {procesando ? '...' : 'Cobrar'}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

export default HistorialPedidos;