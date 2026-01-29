import React, { useState, useEffect, useRef } from 'react';
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
  getDocs, 
  addDoc, 
  updateDoc, 
  doc, 
  Timestamp, 
  query, 
  onSnapshot 
} from 'firebase/firestore';

// --- CONFIGURACIÓN DE FIREBASE (CON PROTECCIÓN CONTRA DUPLICADOS Y REFERENCEERROR) ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

// Corregimos el error "app/duplicate-app" verificando si ya existe una instancia
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'isakari-pos';

// --- UTILS ---
const getLocalDate = () => {
  const now = new Date();
  return now.toISOString().split('T')[0];
};

// Corregimos la detección de ipcRenderer para evitar TypeError: window.require is not a function
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

// Exportación nombrada para compatibilidad con App.jsx
export function TomarPedido({ ordenAEditar, onTerminarEdicion }) {
  const [user, setUser] = useState(null);
  
  // --- ESTADOS ---
  const [menu, setMenu] = useState([]);
  const [orden, setOrden] = useState(ordenAEditar ? ordenAEditar.items : []);
  const [numeroPedidoVisual, setNumeroPedidoVisual] = useState(ordenAEditar ? ordenAEditar.numero_pedido : '...'); 
  const [tipoEntrega, setTipoEntrega] = useState(ordenAEditar ? (ordenAEditar.tipo_entrega || 'LOCAL') : 'LOCAL');
  
  const [nombreCliente, setNombreCliente] = useState(ordenAEditar ? (ordenAEditar.nombre_cliente || '') : '');
  const [direccion, setDireccion] = useState(ordenAEditar ? (ordenAEditar.direccion || '') : '');
  const [telefono, setTelefono] = useState(ordenAEditar ? (ordenAEditar.telefono || '') : '');
  const [costoDespacho, setCostoDespacho] = useState(ordenAEditar ? (ordenAEditar.costo_despacho || '') : '');
  const [descripcionGeneral, setDescripcionGeneral] = useState(ordenAEditar ? (ordenAEditar.descripcion || '') : '');
  const [horaPedido, setHoraPedido] = useState(ordenAEditar ? (ordenAEditar.hora_pedido || '') : new Date().toLocaleTimeString('es-CL', {hour: '2-digit', minute:'2-digit'}));

  const [aplicarDescuento, setAplicarDescuento] = useState(ordenAEditar ? (ordenAEditar.tiene_descuento || false) : false);
  const [categoriaActual, setCategoriaActual] = useState(null);
  
  const [cajaAbierta, setCajaAbierta] = useState(false); 
  const [cargando, setCargando] = useState(true); 
  const [editandoObservacionId, setEditandoObservacionId] = useState(null);
  const [observacionTemp, setObservacionTemp] = useState('');
  const [notificacion, setNotificacion] = useState(null);

  const proximoNumeroSeguro = useRef(null);

  const emailUsuario = user ? user.email : "";
  const esPrueba = emailUsuario === "prueba@isakari.com";
  const COL_CAJAS = esPrueba ? "cajas_pruebas" : "cajas";
  const COL_ORDENES = esPrueba ? "ordenes_pruebas" : "ordenes";

  const notificar = (msg, tipo = "info") => {
    setNotificacion({ msg, tipo });
    setTimeout(() => setNotificacion(null), 3000);
  };

  // --- AUTH (RULE 3) ---
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

  // --- LISTENERS (RULE 1 & 2) ---
  useEffect(() => {
    if (!user) return;

    const qMenu = collection(db, 'artifacts', appId, 'public', 'data', 'menu');
    const unsubscribeMenu = onSnapshot(qMenu, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      setMenu(docs);
    });

    const qCajas = collection(db, 'artifacts', appId, 'public', 'data', COL_CAJAS);
    const unsubscribeCaja = onSnapshot(qCajas, (snapshot) => {
      const abierta = snapshot.docs.map(d => d.data()).find(c => c.estado === "abierta");
      if (abierta) {
        setCajaAbierta(true);
        if (!ordenAEditar) calcularNumeroVisual(abierta.fecha_apertura);
      } else {
        setCajaAbierta(false);
      }
      setCargando(false);
    });

    return () => { unsubscribeMenu(); unsubscribeCaja(); };
  }, [user, appId, COL_CAJAS, ordenAEditar]);

  const calcularNumeroVisual = async (fechaInicioCaja) => {
    if (proximoNumeroSeguro.current !== null) { setNumeroPedidoVisual(proximoNumeroSeguro.current); return; }
    try {
        const qOrdenes = collection(db, 'artifacts', appId, 'public', 'data', COL_ORDENES);
        const snapshot = await getDocs(qOrdenes);
        const filtradas = snapshot.docs.map(d => d.data()).filter(o => o.fecha && o.fecha.toMillis() >= (fechaInicioCaja?.toMillis ? fechaInicioCaja.toMillis() : 0));
        const max = filtradas.reduce((m, o) => Math.max(m, o.numero_pedido || 0), 0);
        setNumeroPedidoVisual(max + 1);
    } catch (e) { setNumeroPedidoVisual(1); }
  };

  const numCostoDespacho = parseInt(costoDespacho) || 0;
  const subTotalProductos = orden.reduce((acc, item) => acc + (item.precio * item.cantidad), 0);
  const montoDescuento = aplicarDescuento ? Math.round(subTotalProductos * 0.10) : 0;
  const totalFinal = (subTotalProductos - montoDescuento) + numCostoDespacho;
  const formatoPeso = (v) => v.toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });

  const categoriasUnicas = [...new Set(menu.map(item => item.categoria))];
  const productosFiltrados = categoriaActual ? menu.filter(item => item.categoria === categoriaActual) : [];

  const agregarAlPedido = (p) => {
    if (!cajaAbierta && !ordenAEditar) return notificar("⛔ Caja cerrada.", "error");
    const existe = orden.find(item => item.id === p.id);
    if (existe) {
      setOrden(orden.map(item => item.id === p.id ? { ...item, cantidad: item.cantidad + 1 } : item));
    } else {
      setOrden([...orden, { ...p, cantidad: 1, observacion: '', precio_base: p.precio }]);
    }
  };

  const ajustarCantidad = (id, delta) => {
    const nueva = orden.map(item => item.id === id ? { ...item, cantidad: Math.max(0, item.cantidad + delta) } : item);
    setOrden(nueva.filter(item => item.cantidad > 0));
  };

  const guardarObservacion = (id) => {
    setOrden(orden.map(item => item.id === id ? { ...item, observacion: observacionTemp } : item));
    setEditandoObservacionId(null);
  };

  const handlePrint = () => {
    const datos = { numeroPedido: numeroPedidoVisual, cliente: nombreCliente, items: orden, total: totalFinal };
    if (ipcRenderer && ipcRenderer.send) ipcRenderer.send('imprimir-ticket-raw', datos);
    else console.log("Print Sim:", datos);
  };

  const enviarCocina = async (imprimir = false) => {
    if (orden.length === 0) return notificar("⚠️ Orden vacía", "error");
    if (!cajaAbierta && !ordenAEditar) return notificar("⛔ Caja cerrada.", "error");
    
    setCargando(true);
    try {
        const datos = {
            items: orden,
            total: totalFinal,
            tiene_descuento: aplicarDescuento,
            monto_descuento: montoDescuento,
            costo_despacho: numCostoDespacho,
            tipo_entrega: tipoEntrega,
            descripcion: descripcionGeneral,
            nombre_cliente: nombreCliente,
            hora_pedido: horaPedido,
            direccion: direccion, 
            telefono: telefono,   
            fechaString: getLocalDate(),
            numero_pedido: ordenAEditar ? ordenAEditar.numero_pedido : (proximoNumeroSeguro.current || numeroPedidoVisual),
            estado: "pendiente",
            estadoPago: "Pendiente",
            fecha: Timestamp.now(),
            usuario_id: user?.uid || "anonimo"
        };

        if (ordenAEditar) {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', COL_ORDENES, ordenAEditar.id), datos);
            notificar("Pedido actualizado", "success");
            if (onTerminarEdicion) onTerminarEdicion();
        } else {
            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', COL_ORDENES), datos);
            const sig = datos.numero_pedido + 1;
            proximoNumeroSeguro.current = sig;
            notificar(`¡Pedido #${datos.numero_pedido} creado!`, "success");
            limpiarFormulario(sig);
        }
        if (imprimir) handlePrint();
    } catch (e) { notificar("Error: " + e.message, "error"); }
    finally { setCargando(false); }
  };

  const limpiarFormulario = (sig) => {
    setOrden([]); setEditandoObservacionId(null); setDescripcionGeneral(''); setNombreCliente('');
    setCostoDespacho(''); setDireccion(''); setTelefono(''); setTipoEntrega('LOCAL');
    setAplicarDescuento(false); setCategoriaActual(null);
    if (sig) setNumeroPedidoVisual(sig);
  };

  if (cargando && !orden.length && !ordenAEditar) 
    return <div className="h-screen w-full flex items-center justify-center bg-slate-100 text-slate-500 font-bold text-xl animate-pulse">Cargando Isakari...</div>;

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-gray-800 overflow-hidden relative">
      {notificacion && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl font-bold text-white transition-all transform animate-bounce ${notificacion.tipo === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
          {notificacion.msg}
        </div>
      )}

      {/* SIDEBAR IZQUIERDA */}
      <aside className="w-[400px] bg-white shadow-xl flex flex-col z-20 h-full border-r border-gray-200">
        <div className="p-4 border-b border-gray-100">
           <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center text-white shadow-lg"><i className="bi bi-basket2-fill"></i></div>
                  <div>
                    <h2 className="text-xl font-black text-gray-900 leading-none uppercase">Pedido</h2>
                    <span className="text-xs text-gray-400 font-bold">ORDEN #{numeroPedidoVisual}</span>
                  </div>
              </div>
              <button onClick={() => setAplicarDescuento(!aplicarDescuento)} className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all border ${aplicarDescuento ? 'bg-red-600 text-white border-red-700' : 'bg-slate-50 text-gray-400 border-gray-200'}`}>10% OFF</button>
           </div>
           <div className="space-y-2">
              <input type="text" placeholder="Nombre Cliente *" className="w-full p-2.5 rounded-xl border border-gray-100 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-red-100 outline-none text-sm font-bold" value={nombreCliente} onChange={e => setNombreCliente(e.target.value)} />
              <div className="flex bg-slate-100 rounded-xl p-1">
                <button className={`flex-1 py-2 rounded-lg text-xs font-black transition-all ${tipoEntrega === 'LOCAL' ? 'bg-white shadow-sm text-red-600' : 'text-gray-400'}`} onClick={() => { setTipoEntrega('LOCAL'); setCostoDespacho(''); }}>LOCAL</button>
                <button className={`flex-1 py-2 rounded-lg text-xs font-black transition-all ${tipoEntrega === 'REPARTO' ? 'bg-white shadow-sm text-orange-600' : 'text-gray-400'}`} onClick={() => setTipoEntrega('REPARTO')}>REPARTO</button>
              </div>
              {tipoEntrega === 'REPARTO' && (
                <div className="pt-2 space-y-2 animate-fade-in">
                  <input type="text" placeholder="Dirección..." className="w-full p-2.5 bg-orange-50 border-orange-100 rounded-xl text-sm outline-none" value={direccion} onChange={e => setDireccion(e.target.value)} />
                  <div className="flex gap-2">
                    <input type="text" placeholder="Teléfono..." className="flex-1 p-2.5 bg-orange-50 border-orange-100 rounded-xl text-sm outline-none" value={telefono} onChange={e => setTelefono(e.target.value)} />
                    <input type="number" placeholder="$" className="w-20 p-2.5 bg-orange-50 border-orange-100 rounded-xl text-sm font-bold text-right outline-none" value={costoDespacho} onChange={e => setCostoDespacho(e.target.value)} />
                  </div>
                </div>
              )}
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {orden.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-300">
                    <i className="bi bi-cart-x text-6xl mb-2"></i>
                    <p className="font-bold italic">Vaciando el mar...</p>
                </div>
            ) : (
                orden.map((item) => (
                    <div key={item.id} className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
                        <div className="flex justify-between items-start">
                            <div className="flex-1">
                                <h4 className="font-black text-gray-800 text-sm uppercase leading-tight">{item.nombre}</h4>
                                {item.descripcion && <p className="text-[11px] text-gray-500 italic line-clamp-2 mt-1 leading-tight">{item.descripcion}</p>}
                            </div>
                            <span className="font-black text-gray-800 text-sm ml-2">{formatoPeso(item.precio * item.cantidad)}</span>
                        </div>
                        {(item.observacion || editandoObservacionId === item.id) && (
                            <div className="mt-2 bg-amber-50 p-2 rounded-lg border border-amber-100">
                                {editandoObservacionId === item.id ? (
                                    <input autoFocus className="w-full bg-transparent border-b border-amber-300 outline-none text-xs" value={observacionTemp} onChange={e => setObservacionTemp(e.target.value)} onBlur={() => guardarObservacion(item.id)} onKeyDown={e => e.key === 'Enter' && guardarObservacion(item.id)} />
                                ) : (
                                    <div className="flex justify-between text-[10px] text-amber-800 italic"><span>{item.observacion}</span><button onClick={() => {setEditandoObservacionId(item.id); setObservacionTemp(item.observacion)}}><i className="bi bi-pencil-fill"></i></button></div>
                                )}
                            </div>
                        )}
                        <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-50">
                            <button className="text-gray-300 hover:text-blue-500" onClick={() => {setEditandoObservacionId(item.id); setObservacionTemp(item.observacion || '')}}><i className="bi bi-pencil-fill text-xs"></i></button>
                            <div className="flex items-center bg-slate-100 rounded-lg overflow-hidden">
                                <button className="px-2 py-1 text-gray-400 hover:text-red-600 font-black" onClick={() => ajustarCantidad(item.id, -1)}>-</button>
                                <span className="px-3 text-xs font-black">{item.cantidad}</span>
                                <button className="px-2 py-1 text-gray-400 hover:bg-green-50 hover:text-green-600 font-black" onClick={() => ajustarCantidad(item.id, 1)}>+</button>
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>

        <div className="p-4 bg-white border-t border-gray-100">
            <div className="flex justify-between items-end mb-4">
                <div className="flex flex-col"><span className="text-gray-400 font-bold text-xs uppercase tracking-widest">Total</span>{aplicarDescuento && <span className="text-red-500 font-bold text-[10px]">- {formatoPeso(montoDescuento)}</span>}</div>
                <span className="text-3xl font-black text-gray-900 tracking-tighter">{formatoPeso(totalFinal)}</span>
            </div>
            <button onClick={() => enviarCocina(true)} disabled={(!cajaAbierta && !ordenAEditar) || orden.length === 0} className="w-full py-4 rounded-2xl font-black text-white text-lg bg-red-600 shadow-xl shadow-red-100 hover:bg-red-700 disabled:opacity-30 transition-all flex items-center justify-center gap-2"><i className="bi bi-printer-fill"></i> {ordenAEditar ? 'GUARDAR CAMBIOS' : 'CONFIRMAR'}</button>
            {ordenAEditar && <button onClick={onTerminarEdicion} className="w-full mt-2 py-2 text-gray-400 font-bold text-sm uppercase tracking-widest">Cancelar Edición</button>}
        </div>
      </aside>

      {/* AREA PRINCIPAL */}
      <main className="flex-1 flex flex-col h-full bg-slate-50">
         <div className="p-6">
             {!cajaAbierta && !ordenAEditar ? (
                <div className="bg-red-600 text-white p-4 rounded-2xl text-center font-black shadow-lg animate-pulse uppercase tracking-widest"><i className="bi bi-lock-fill mr-2"></i> Caja Cerrada</div>
             ) : (
                <div className="flex items-center gap-4">
                    {categoriaActual && <button onClick={() => setCategoriaActual(null)} className="p-3 bg-white rounded-2xl shadow-sm border border-gray-100 hover:bg-gray-50"><i className="bi bi-arrow-left text-xl text-red-600"></i></button>}
                    <h2 className="text-4xl font-black text-gray-900 uppercase tracking-tighter">{categoriaActual || "Categorías"}</h2>
                </div>
             )}
         </div>
         <div className="flex-1 overflow-y-auto px-6 pb-20">
             {!categoriaActual ? (
                 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {categoriasUnicas.map(cat => (
                        <button key={cat} onClick={() => setCategoriaActual(cat)} className="bg-white rounded-[2.5rem] p-8 shadow-sm hover:shadow-2xl hover:-translate-y-1 border border-gray-100 transition-all flex flex-col items-center justify-center text-center group h-52 active:scale-95">
                           <div className="w-18 h-18 rounded-full bg-slate-50 mb-4 flex items-center justify-center group-hover:bg-red-50 transition-colors shadow-inner"><span className="text-3xl">📂</span></div>
                           <h3 className="font-black text-gray-800 text-xl uppercase group-hover:text-red-600 tracking-tight">{cat}</h3>
                           <span className="text-[10px] text-gray-300 font-bold mt-2 uppercase tracking-widest">{menu.filter(i => i.categoria === cat).length} productos</span>
                        </button>
                    ))}
                 </div>
             ) : (
                 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {productosFiltrados.map(item => (
                        <button key={item.id} onClick={() => agregarAlPedido(item)} className="bg-white rounded-[2.5rem] p-5 shadow-sm hover:shadow-2xl hover:-translate-y-1 border border-gray-100 transition-all flex flex-col items-center text-center group min-h-[260px] justify-between active:scale-95">
                            <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center group-hover:scale-110 transition-transform shadow-inner"><span className="text-3xl">🍣</span></div>
                            <div className="flex-1 flex flex-col justify-center py-4 w-full">
                                <h3 className="font-black text-gray-800 text-sm uppercase line-clamp-2 leading-tight group-hover:text-red-600">{item.nombre}</h3>
                                {item.descripcion && <p className="text-[12px] text-gray-500 italic line-clamp-3 mt-3 px-2 leading-snug font-medium">{item.descripcion}</p>}
                            </div>
                            <div className="w-full py-2 bg-red-50 rounded-xl font-black text-red-600 group-hover:bg-red-600 group-hover:text-white transition-colors shadow-sm">{formatoPeso(item.precio)}</div>
                        </button>
                    ))}
                 </div>
             )}
         </div>
      </main>
    </div>
  );
}


export default TomarPedido;