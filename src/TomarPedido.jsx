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
  where,
  limit,
  orderBy,
  onSnapshot 
} from 'firebase/firestore';

// --- COMPONENTE TICKET INTEGRADO (Para evitar errores de resolución de archivo) ---
const Ticket = ({ orden, total, numeroPedido, tipoEntrega, fecha, descripcion, logoUrl, cliente, hora, costoDespacho, direccion, telefono }) => {
  const formatoPeso = (valor) => valor.toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });
  const costoDespachoNum = parseInt(costoDespacho || 0);
  const totalNum = parseInt(total || 0);
  const subtotalProductos = totalNum - costoDespachoNum;

  return (
    <div className="ticket-container" style={{ padding: '10px', fontFamily: 'monospace', width: '280px', backgroundColor: 'white', color: 'black' }}>
      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        <h2 style={{ margin: '0' }}>ISAKARI SUSHI</h2>
        <p style={{ margin: '0', fontSize: '12px' }}>Calle Comercio #1757</p>
        <p style={{ margin: '0', fontSize: '12px' }}>+56 9 813 51797</p>
        <h3 style={{ borderTop: '1px dashed black', borderBottom: '1px dashed black', padding: '5px 0', margin: '10px 0' }}>Mesa {numeroPedido}</h3>
        {cliente && <p style={{ margin: '0', fontWeight: 'bold', textTransform: 'uppercase' }}>{cliente}</p>}
        {hora && <p style={{ margin: '0' }}>Hora: {hora}</p>}
        <p style={{ margin: '0', fontSize: '11px' }}>Fecha: {fecha}</p>
      </div>

      <div style={{ borderBottom: '1px dashed black', marginBottom: '5px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '12px' }}>
          <span>CANT</span>
          <span>PRODUCTO</span>
          <span>TOTAL</span>
        </div>
      </div>

      {orden.map((item, i) => (
        <div key={i} style={{ marginBottom: '8px', fontSize: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ flex: '0 0 30px' }}>{item.cantidad}</span>
            <span style={{ flex: '1' }}>{item.nombre}</span>
            <span>{formatoPeso(item.precio * item.cantidad)}</span>
          </div>
          {item.observacion && (
            <div style={{ backgroundColor: 'black', color: 'white', padding: '2px', textAlign: 'center', margin: '3px 0', fontWeight: 'bold' }}>
              ★ {item.observacion} ★
            </div>
          )}
        </div>
      ))}

      <div style={{ borderTop: '1px dashed black', paddingTop: '5px', marginTop: '5px' }}>
        {costoDespachoNum > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span>Subtotal</span>
            <span>{formatoPeso(subtotalProductos)}</span>
          </div>
        )}
        {costoDespachoNum > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 'bold' }}>
            <span>Despacho</span>
            <span>{formatoPeso(costoDespachoNum)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 'bold', marginTop: '5px' }}>
          <span>TOTAL</span>
          <span>{formatoPeso(totalNum)}</span>
        </div>
      </div>

      {tipoEntrega === 'REPARTO' && (direccion || telefono) && (
        <div style={{ marginTop: '15px', borderTop: '1px solid black', paddingTop: '5px' }}>
          <p style={{ margin: '0', fontWeight: 'bold', textAlign: 'center', fontSize: '12px' }}>DATOS DE DESPACHO</p>
          <p style={{ margin: '2px 0', fontSize: '12px', wordBreak: 'normal' }}><strong>Dir:</strong> {direccion}</p>
          <p style={{ margin: '2px 0', fontSize: '12px' }}><strong>Tel:</strong> {telefono}</p>
        </div>
      )}
    </div>
  );
};

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const POSIBLES_IDS = [
    'sushi', 
    'isakari-pos', 
    'default-app-id', 
    (typeof __app_id !== 'undefined' ? __app_id : 'sushi')
];
const APP_IDS_A_ESCANEAR = [...new Set(POSIBLES_IDS)];

// --- UTILS ---
const getLocalDate = () => {
  const now = new Date();
  return now.toISOString().split('T')[0];
};

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

  const [categoriaActual, setCategoriaActual] = useState(null);
  
  const [cajaAbierta, setCajaAbierta] = useState(false); 
  const [cargando, setCargando] = useState(true); 
  const [editandoObservacionId, setEditandoObservacionId] = useState(null);
  const [observacionTemp, setObservacionTemp] = useState('');
  const [notificacion, setNotificacion] = useState(null);
  
  const [mostrarVistaPrevia, setMostrarVistaPrevia] = useState(false);

  const [debugInfo, setDebugInfo] = useState({ logs: [], ruta: '', modo: 'Iniciando...' });
  
  const [activeAppId, setActiveAppId] = useState(APP_IDS_A_ESCANEAR[0]);
  const [usarColeccionRaiz, setUsarColeccionRaiz] = useState(false); 

  const proximoNumeroSeguro = useRef(null);
  
  const emailUsuario = user ? user.email : "";
  const esPrueba = emailUsuario === "prueba@isakari.com";
  
  const COL_CAJAS = esPrueba ? "cajas_pruebas" : "cajas";
  const COL_ORDENES = esPrueba ? "ordenes_pruebas" : "ordenes";

  const notificar = (msg, tipo = "info") => {
    setNotificacion({ msg, tipo });
    setTimeout(() => setNotificacion(null), 3000);
  };

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

  useEffect(() => {
    if (!user) return;

    let menuRaiz = [];
    let menuArtifact = [];

    const actualizarMenu = () => {
        if (menuRaiz.length > 0) {
            setMenu(menuRaiz);
        } else if (menuArtifact.length > 0) {
            setMenu(menuArtifact);
        } else {
            setMenu([]);
        }
    };

    const unsubMenuRaiz = onSnapshot(collection(db, "menu"), (snapshot) => {
        menuRaiz = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        menuRaiz.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        actualizarMenu();
    });

    const unsubMenuArtifact = onSnapshot(collection(db, 'artifacts', activeAppId, 'public', 'data', 'menu'), (snapshot) => {
        menuArtifact = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        menuArtifact.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        actualizarMenu();
    });


    const unsubscribes = [];
    let cajaEncontradaEnAlgunSitio = false;

    try {
        const qRaiz = query(collection(db, COL_CAJAS), where("estado", "==", "abierta"));
        const unsubRaiz = onSnapshot(qRaiz, (snapshot) => {
            if (!snapshot.empty) {
                const cajaData = snapshot.docs[0].data();
                cajaEncontradaEnAlgunSitio = true;
                setCajaAbierta(true);
                setUsarColeccionRaiz(true); 
                const fechaRef = cajaData.fecha_apertura || cajaData.fecha || Timestamp.now();
                if (!ordenAEditar) calcularNumeroVisual(fechaRef, true, null);
                setDebugInfo(prev => ({...prev, ruta: `/${COL_CAJAS}`, modo: esPrueba ? 'PRUEBAS' : 'PROD'}));
            } else {
                if (!cajaEncontradaEnAlgunSitio) setCajaAbierta(false);
            }
            setCargando(false);
        });
        unsubscribes.push(unsubRaiz);
    } catch (e) {
        console.warn("Error escuchando raíz:", e);
    }

    APP_IDS_A_ESCANEAR.forEach(idToScan => {
        const qCajaArtifact = collection(db, 'artifacts', idToScan, 'public', 'data', COL_CAJAS);
        const unsubArtifact = onSnapshot(qCajaArtifact, (snapshot) => {
            if (cajaEncontradaEnAlgunSitio && usarColeccionRaiz) return;
            const registros = snapshot.docs.map(d => d.data());
            const cajaActiva = registros.find(c => c.estado && c.estado.toString().toLowerCase() === "abierta");
            if (cajaActiva) {
                cajaEncontradaEnAlgunSitio = true;
                setCajaAbierta(true);
                setUsarColeccionRaiz(false); 
                setActiveAppId(idToScan);
                const fechaRef = cajaActiva.fecha_apertura || cajaActiva.fecha || Timestamp.now();
                if (!ordenAEditar) calcularNumeroVisual(fechaRef, false, idToScan);
                setDebugInfo(prev => ({...prev, ruta: `artifacts/${idToScan}/...`}));
            } else {
                if (!cajaEncontradaEnAlgunSitio) setCajaAbierta(false);
            }
            setCargando(false);
        });
        unsubscribes.push(unsubArtifact);
    });

    return () => { 
        unsubMenuRaiz();
        unsubMenuArtifact();
        unsubscribes.forEach(u => u()); 
    };
  }, [user, ordenAEditar, COL_CAJAS]); 

  const calcularNumeroVisual = async (fechaInicioCaja, esRaiz, appIdArtifact) => {
    if (proximoNumeroSeguro.current !== null) { setNumeroPedidoVisual(proximoNumeroSeguro.current); return; }
    try {
        let qOrdenes;
        if (esRaiz) {
            try {
                qOrdenes = query(
                    collection(db, COL_ORDENES), 
                    where("fecha", ">=", fechaInicioCaja),
                    orderBy("numero_pedido", "desc"), 
                    limit(1)
                );
            } catch (e) {
                qOrdenes = collection(db, COL_ORDENES);
            }
        } else {
            qOrdenes = collection(db, 'artifacts', appIdArtifact, 'public', 'data', COL_ORDENES);
        }
        const snapshot = await getDocs(qOrdenes);
        const filtradas = snapshot.docs.map(d => d.data()).filter(o => {
            const ordenMillis = o.fecha?.toMillis ? o.fecha.toMillis() : 0;
            return ordenMillis >= (fechaInicioCaja?.toMillis ? fechaInicioCaja.toMillis() : 0);
        });
        const max = filtradas.reduce((m, o) => Math.max(m, o.numero_pedido || 0), 0);
        setNumeroPedidoVisual(max + 1);
    } catch (e) { 
        setNumeroPedidoVisual(1); 
    }
  };

  const numCostoDespacho = parseInt(costoDespacho) || 0;
  const totalFinal = orden.reduce((acc, item) => acc + (item.precio * item.cantidad), 0) + numCostoDespacho;
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

  const abrirVistaPrevia = () => {
      if (orden.length === 0) return notificar("⚠️ Orden vacía", "error");
      setMostrarVistaPrevia(true);
  };

  const handlePrint = () => {
    const datos = { numeroPedido: numeroPedidoVisual, cliente: nombreCliente, items: orden, total: totalFinal };
    if (ipcRenderer && ipcRenderer.send) ipcRenderer.send('imprimir-ticket-raw', datos);
  };

  const enviarCocina = async (imprimir = false) => {
    if (orden.length === 0) return notificar("⚠️ Orden vacía", "error");
    if (!cajaAbierta && !ordenAEditar) return notificar("⛔ Caja cerrada.", "error");
    
    setCargando(true);
    try {
        const datos = {
            items: orden,
            total: totalFinal,
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
            estado_pago: "Pendiente",
            fecha: Timestamp.now(),
            usuario_id: user?.uid || "anonimo"
        };

        const rutaColeccion = usarColeccionRaiz 
            ? collection(db, COL_ORDENES) 
            : collection(db, 'artifacts', activeAppId, 'public', 'data', COL_ORDENES);

        if (ordenAEditar) {
            await updateDoc(doc(rutaColeccion, ordenAEditar.id), datos);
            notificar("Pedido actualizado", "success");
            if (onTerminarEdicion) onTerminarEdicion();
        } else {
            await addDoc(rutaColeccion, datos);
            const sig = datos.numero_pedido + 1;
            proximoNumeroSeguro.current = sig;
            notificar(`¡Pedido #${datos.numero_pedido} creado!`, "success");
            limpiarFormulario(sig);
        }
        if (imprimir) handlePrint();
    } catch (e) { 
        notificar("Error: " + e.message, "error"); 
    } finally { setCargando(false); }
  };

  const limpiarFormulario = (sig) => {
    setOrden([]); setEditandoObservacionId(null); setDescripcionGeneral(''); setNombreCliente('');
    setCostoDespacho(''); setDireccion(''); setTelefono(''); setTipoEntrega('LOCAL');
    if (sig) setNumeroPedidoVisual(sig);
  };

  if (cargando && !orden.length && !ordenAEditar) 
    return <div className="h-screen w-full flex items-center justify-center bg-slate-100 text-slate-500 font-bold text-xl animate-pulse">Cargando...</div>;

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-gray-800 overflow-hidden relative">
      {notificacion && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl font-bold text-white transition-all transform animate-bounce ${notificacion.tipo === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
          {notificacion.msg}
        </div>
      )}

      <aside className="w-[400px] bg-white shadow-xl flex flex-col z-20 h-full border-r border-gray-200">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
           <div className={`mb-3 text-[10px] font-black uppercase tracking-widest text-center py-1 rounded border ${esPrueba ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-green-100 text-green-700 border-green-200'}`}>
               {esPrueba ? "🛠️ MODO PRUEBAS" : "🟢 MODO PRODUCCIÓN"}
           </div>

           <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center text-white shadow-lg"><i className="bi bi-basket2-fill"></i></div>
                  <div>
                    <h2 className="text-xl font-black text-gray-900 leading-none uppercase">Pedido</h2>
                    <span className="text-xs text-gray-400 font-bold">ORDEN #{numeroPedidoVisual}</span>
                  </div>
              </div>
           </div>
           
           <div className="space-y-2">
              <input type="text" placeholder="Nombre Cliente *" className="w-full p-2.5 rounded-xl border border-gray-100 bg-white focus:ring-2 focus:ring-red-100 outline-none text-sm font-bold" value={nombreCliente} onChange={e => setNombreCliente(e.target.value)} />
              <div className="flex bg-slate-100 rounded-xl p-1">
                <button className={`flex-1 py-2 rounded-lg text-xs font-black transition-all ${tipoEntrega === 'LOCAL' ? 'bg-white shadow-sm text-red-600' : 'text-gray-400'}`} onClick={() => { setTipoEntrega('LOCAL'); setCostoDespacho(''); }}>LOCAL</button>
                <button className={`flex-1 py-2 rounded-lg text-xs font-black transition-all ${tipoEntrega === 'REPARTO' ? 'bg-white shadow-sm text-orange-600' : 'text-gray-400'}`} onClick={() => setTipoEntrega('REPARTO')}>REPARTO</button>
              </div>
              
              {tipoEntrega === 'REPARTO' && (
                <div className="pt-2 animate-fade-in bg-orange-50 rounded-xl p-2 border border-orange-100 shadow-inner">
                  <div className="d-flex gap-2 mb-2">
                     <input type="text" placeholder="Dirección..." className="flex-[2] p-2 bg-white border border-orange-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-orange-300" value={direccion} onChange={e => setDireccion(e.target.value)} />
                     <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-orange-400 font-bold text-xs">$</span>
                        <input type="number" placeholder="Envío" className="w-full p-2 pl-4 bg-white border border-orange-200 rounded-lg text-xs font-bold text-right outline-none focus:ring-1 focus:ring-orange-300" value={costoDespacho} onChange={e => setCostoDespacho(e.target.value)} />
                     </div>
                  </div>
                  <input type="text" placeholder="Teléfono..." className="w-full p-2 bg-white border border-orange-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-orange-300" value={telefono} onChange={e => setTelefono(e.target.value)} />
                </div>
              )}
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {orden.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-300 text-center">
                    <p className="font-bold italic">Seleccione categorías para agregar productos</p>
                </div>
            ) : (
                orden.map((item) => (
                    <div key={item.id} className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
                        <div className="flex justify-between items-start">
                            <div className="flex-1">
                                <h4 className="font-black text-gray-800 text-sm uppercase leading-tight">{item.nombre}</h4>
                                <span className="font-black text-gray-400 text-xs">{formatoPeso(item.precio)} c/u</span>
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
                <div className="flex flex-col"><span className="text-gray-400 font-bold text-xs uppercase tracking-widest">Total</span></div>
                <span className="text-3xl font-black text-gray-900 tracking-tighter">{formatoPeso(totalFinal)}</span>
            </div>
            
            <div className="d-flex gap-2">
                <button className="p-3 rounded-2xl bg-slate-200 text-slate-600 hover:bg-slate-300 transition-colors shadow-sm" onClick={abrirVistaPrevia} disabled={!cajaAbierta && !ordenAEditar} title="Vista Previa Ticket"><i className="bi bi-eye-fill text-xl"></i></button>
                <button onClick={() => enviarCocina(true)} disabled={(!cajaAbierta && !ordenAEditar) || orden.length === 0} className="flex-1 py-4 rounded-2xl font-black text-white text-lg bg-red-600 shadow-xl shadow-red-100 hover:bg-red-700 disabled:opacity-30 transition-all flex items-center justify-center gap-2"><i className="bi bi-printer-fill"></i> {ordenAEditar ? 'GUARDAR' : 'CONFIRMAR'}</button>
            </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
         <div className="p-6">
             {!cajaAbierta && !ordenAEditar ? (
                <div className="flex flex-col items-center justify-center p-8 bg-white rounded-3xl shadow-xl border border-red-100">
                    <div className="bg-red-100 text-red-600 p-6 rounded-full mb-4 animate-pulse"><i className="bi bi-lock-fill text-4xl"></i></div>
                    <h2 className="text-3xl font-black text-gray-800 uppercase tracking-tight mb-2">Caja Cerrada</h2>
                    <p className="text-gray-400 font-medium mb-6 text-center max-w-md">No puedes tomar pedidos hasta que abras la caja.</p>
                </div>
             ) : (
                <div className="flex items-center gap-4">
                    {categoriaActual && <button onClick={() => setCategoriaActual(null)} className="p-3 bg-white rounded-2xl shadow-sm border border-gray-100 hover:bg-gray-50"><i className="bi bi-arrow-left text-xl text-red-600"></i></button>}
                    <h2 className="text-4xl font-black text-gray-900 uppercase tracking-tighter">{categoriaActual || "Categorías"}</h2>
                </div>
             )}
         </div>

         <div className="flex-1 overflow-y-auto px-6 pb-20">
             {(!cajaAbierta && !ordenAEditar) ? null : (!categoriaActual ? (
                 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {categoriasUnicas.map(cat => (
                        <button key={cat} onClick={() => setCategoriaActual(cat)} className="bg-white rounded-[2.5rem] p-8 shadow-sm hover:shadow-2xl hover:-translate-y-1 border border-gray-100 transition-all flex flex-col items-center justify-center text-center group h-52">
                           <div className="w-18 h-18 rounded-full bg-slate-50 mb-4 flex items-center justify-center group-hover:bg-red-50 transition-colors shadow-inner"><span className="text-3xl">📂</span></div>
                           <h3 className="font-black text-gray-800 text-xl uppercase group-hover:text-red-600 tracking-tight">{cat}</h3>
                           <span className="text-[10px] text-gray-300 font-bold mt-2 uppercase tracking-widest">{menu.filter(i => i.categoria === cat).length} productos</span>
                        </button>
                    ))}
                 </div>
             ) : (
                 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {productosFiltrados.map(item => (
                        <button key={item.id} onClick={() => agregarAlPedido(item)} className="bg-white rounded-[2.5rem] p-5 shadow-sm hover:shadow-2xl hover:-translate-y-1 border border-gray-100 transition-all flex flex-col items-center text-center group min-h-[260px] justify-between">
                            <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center group-hover:scale-110 transition-transform shadow-inner"><span className="text-3xl">🍣</span></div>
                            <div className="flex-1 flex flex-col justify-center py-4 w-full">
                                <h3 className="font-black text-gray-800 text-sm uppercase line-clamp-2 leading-tight group-hover:text-red-600">{item.nombre}</h3>
                                {item.descripcion && <p className="text-[12px] text-gray-500 italic line-clamp-3 mt-3 px-2 leading-snug font-medium">{item.descripcion}</p>}
                            </div>
                            <div className="w-full py-2 bg-red-50 rounded-xl font-black text-red-600 group-hover:bg-red-600 group-hover:text-white transition-colors shadow-sm">{formatoPeso(item.precio)}</div>
                        </button>
                    ))}
                 </div>
             ))}
         </div>
      </main>

      {mostrarVistaPrevia && (
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-2xl overflow-hidden max-w-sm w-full max-h-[90vh] flex flex-col">
                <div className="bg-slate-800 text-white p-3 flex justify-between items-center">
                    <h6 className="font-bold m-0 text-sm uppercase tracking-wider">Vista Previa Ticket</h6>
                    <button onClick={() => setMostrarVistaPrevia(false)} className="text-white/70 hover:text-white"><i className="bi bi-x-lg"></i></button>
                </div>
                <div className="p-4 overflow-y-auto bg-slate-100 flex justify-center">
                    <Ticket 
                        orden={orden} 
                        total={totalFinal} 
                        numeroPedido={numeroPedidoVisual} 
                        tipoEntrega={tipoEntrega} 
                        fecha={new Date().toLocaleDateString('es-CL')} 
                        descripcion={descripcionGeneral} 
                        cliente={nombreCliente} 
                        hora={horaPedido} 
                        costoDespacho={numCostoDespacho} 
                        direccion={direccion} 
                        telefono={telefono} 
                    />
                </div>
                <div className="p-3 border-t bg-white">
                    <button className="w-full py-2 bg-slate-200 text-slate-700 font-bold rounded-lg hover:bg-slate-300 transition-colors" onClick={() => setMostrarVistaPrevia(false)}>Cerrar</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}

export default TomarPedido;