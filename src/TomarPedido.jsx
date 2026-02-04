import React, { useState, useEffect, useRef } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  Timestamp, 
  query, 
  where, 
  onSnapshot,
  getDocs,
  enableIndexedDbPersistence
} from 'firebase/firestore';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';

// --- CONFIGURACIÓN E INICIALIZACIÓN SEGURA DE FIREBASE ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);

// Habilitar persistencia local para modo offline
try {
    if (typeof window !== 'undefined') {
        enableIndexedDbPersistence(db).catch((err) => {
            if (err.code === 'failed-precondition') {
                console.warn('Persistencia falló: múltiples pestañas');
            } else if (err.code === 'unimplemented') {
                console.warn('Navegador no soporta persistencia');
            }
        });
    }
} catch (e) {}

// --- DETECCIÓN DE ELECTRON ---
const ipcRenderer = (function() {
  try {
    if (typeof window !== 'undefined' && window.require) {
      const electron = window.require('electron');
      return electron ? electron.ipcRenderer : null;
    }
  } catch (e) { return null; }
  return null;
})();

// --- UTILIDADES DE FECHA LOCAL (CHILE) ---
const getLocalISODate = () => {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
};

// --- COMPONENTE TICKET ---
const Ticket = ({ orden, total, numeroPedido, tipoEntrega, fecha, hora, cliente, direccion, telefono, descripcion, notaPersonal, costoDespacho }) => {
    const fechaChile = fecha && fecha.includes('-') ? fecha.split('-').reverse().join('/') : fecha;

    return (
        <div className="bg-white p-4 border border-gray-200 font-mono text-[10px] leading-tight max-w-[300px] mx-auto text-black shadow-inner">
            <div className="text-center font-black mb-1 uppercase text-xs">Isakari Sushi</div>
            <div className="text-center mb-2 font-black">Orden #{numeroPedido}</div>
            <div className="border-b border-dashed border-gray-400 mb-2"></div>
            <div className="mb-2 space-y-1">
                <div>FECHA: {fechaChile} {hora}</div>
                <div className="uppercase">CLIENTE: {cliente}</div>
                <div className="uppercase font-bold">TIPO: {tipoEntrega}</div>
                {tipoEntrega === 'REPARTO' && (
                    <>
                        {telefono && <div>TEL: {telefono}</div>}
                        {direccion && <div className="uppercase">DIR: {direccion}</div>}
                    </>
                )}
            </div>
            <div className="border-b border-dashed border-gray-400 mb-2"></div>
            <table className="w-full mb-2">
                <tbody>
                    {orden?.map((item, idx) => (
                        <tr key={idx} className="align-top border-b border-gray-50 last:border-0">
                            <td className="pr-1 font-bold">{item.cantidad}x</td>
                            <td className="w-full uppercase">
                                <div className="font-bold">{item.nombre}</div>
                                {item.observacion && <div className="text-[8px] italic lowercase mt-0.5 text-gray-600">↳ {item.observacion}</div>}
                            </td>
                            <td className="text-right whitespace-nowrap pl-1">
                                ${((Number(item.precio) || 0) * (Number(item.cantidad) || 0)).toLocaleString()}
                            </td>
                        </tr>
                    ))}
                    {tipoEntrega === 'REPARTO' && Number(costoDespacho) > 0 && (
                        <tr className="border-t border-dashed">
                            <td colSpan="2" className="pt-1 uppercase">Envío:</td>
                            <td className="text-right pt-1">${Number(costoDespacho).toLocaleString()}</td>
                        </tr>
                    )}
                </tbody>
            </table>
            <div className="border-t border-dashed border-gray-400 mt-2 pt-2 flex justify-between font-black text-sm">
                <span>TOTAL:</span>
                <span>${(Number(total) || 0).toLocaleString()}</span>
            </div>
            {(descripcion || (tipoEntrega === 'REPARTO' && notaPersonal)) && (
                <div className="mt-3 border-t border-dashed pt-1 space-y-1">
                    {tipoEntrega === 'REPARTO' && notaPersonal && <div className="uppercase font-bold text-[9px] bg-gray-50 p-1">Nota: {notaPersonal}</div>}
                    {descripcion && <div className="italic text-[8px] uppercase opacity-75">Obs Cocina: {descripcion}</div>}
                </div>
            )}
            <div className="text-center mt-4 border-t border-dashed pt-2 opacity-50 uppercase text-[8px]">Sistema POS Local - Chile</div>
        </div>
    );
};

// --- COMPONENTE PRINCIPAL ---
export default function TomarPedido({ ordenAEditar, onTerminarEdicion, user: propUser }) {
  const [user, setUser] = useState(propUser || null);
  const [menu, setMenu] = useState([]);
  const [orden, setOrden] = useState([]);
  const [numeroPedidoVisual, setNumeroPedidoVisual] = useState(1); 
  const [tipoEntrega, setTipoEntrega] = useState('LOCAL');
  const [nombreCliente, setNombreCliente] = useState('');
  const [direccion, setDireccion] = useState('');
  const [telefono, setTelefono] = useState('');
  const [notaPersonal, setNotaPersonal] = useState('');
  const [costoDespacho, setCostoDespacho] = useState('');
  const [descripcionGeneral, setDescripcionGeneral] = useState('');
  const [horaPedido, setHoraPedido] = useState(new Date().toLocaleTimeString('es-CL', { 
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' 
  }));
  
  const [categoriaActual, setCategoriaActual] = useState(null);
  const [cargando, setCargando] = useState(true); 
  const [mostrarVistaPrevia, setMostrarVistaPrevia] = useState(false);
  const [ultimoPedidoParaImprimir, setUltimoPedidoParaImprimir] = useState(null); 
  const [cajaAbierta, setCajaAbierta] = useState(false);

  const esPrueba = user?.email === "prueba@isakari.com";
  const COL_ORDENES = esPrueba ? "ordenes_pruebas" : "ordenes";
  const COL_MENU = "menu";
  const COL_CAJAS = esPrueba ? "cajas_pruebas" : "cajas";
  
  const inputStyle = "w-full p-4 rounded-2xl border-2 border-gray-100 bg-white focus:ring-2 focus:ring-red-100 outline-none text-sm font-black uppercase transition-all shadow-sm placeholder:text-gray-300";

  // Autenticación
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error("Auth error:", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // ESCUCHA DE CAJA (Apuntando a la raíz)
  useEffect(() => {
    if (!user) return;
    const colRef = collection(db, COL_CAJAS);
    
    const unsubscribe = onSnapshot(colRef, (snap) => {
        const docs = snap.docs.map(d => d.data());
        const hayAbierta = docs.some(c => c.estado === "abierta");
        setCajaAbierta(hayAbierta);
    }, (err) => {
        console.error("Error al verificar Caja en raíz:", err);
        setCajaAbierta(false);
    });
    return () => unsubscribe();
  }, [user, COL_CAJAS]);

  // CARGA DE MENÚ (Apuntando a la raíz)
  useEffect(() => {
    if (!user) return;
    const cargarMenu = async () => {
        try {
            const snap = await getDocs(collection(db, COL_MENU));
            setMenu(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.nombre || '').localeCompare(b.nombre || '')));
        } catch (e) { console.error("Error Menu en raíz:", e); }
        finally { setCargando(false); }
    };
    cargarMenu();
  }, [user]);

  // CONTADOR DE PEDIDOS (Apuntando a la raíz + Cálculo en memoria para evitar errores)
  useEffect(() => {
    if (!user || ordenAEditar) return;
    
    const hoy = getLocalISODate();
    const colRef = collection(db, COL_ORDENES);
    
    const unsubscribe = onSnapshot(colRef, (snap) => {
        const pedidosHoy = snap.docs
            .map(d => d.data())
            .filter(d => d.fechaString === hoy);

        if (pedidosHoy.length > 0) {
            // Buscamos el número más alto registrado hoy
            const numeros = pedidosHoy.map(p => Number(p.numero_pedido) || 0);
            const maxActual = Math.max(...numeros);
            setNumeroPedidoVisual(maxActual + 1);
        } else {
            setNumeroPedidoVisual(1);
        }
        
        if (!ordenAEditar) {
            setHoraPedido(new Date().toLocaleTimeString('es-CL', { 
                hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' 
            }));
        }
    }, (err) => {
        console.error("Error sincronización contador en raíz:", err);
    });
    
    return () => unsubscribe();
  }, [user, ordenAEditar, COL_ORDENES]);

  // CARGA DE DATOS AL EDITAR
  useEffect(() => {
    if (ordenAEditar) {
      setOrden(ordenAEditar.items || []);
      setNombreCliente(ordenAEditar.nombre_cliente || '');
      setTipoEntrega(ordenAEditar.tipo_entrega || 'LOCAL');
      setDireccion(ordenAEditar.direccion || '');
      setTelefono(ordenAEditar.telefono || '');
      setNotaPersonal(ordenAEditar.nota_personal || '');
      setCostoDespacho(ordenAEditar.costo_despacho || '');
      setNumeroPedidoVisual(ordenAEditar.numero_pedido);
      setDescripcionGeneral(ordenAEditar.descripcion || '');
      setHoraPedido(ordenAEditar.hora_pedido || '');
    }
  }, [ordenAEditar]);

  const totalFinal = orden.reduce((acc, item) => acc + ((Number(item.precio) || 0) * (Number(item.cantidad) || 0)), 0) + (tipoEntrega === 'REPARTO' ? (parseInt(costoDespacho) || 0) : 0);

  const ejecutarImpresion = (datos) => {
    if (ipcRenderer) {
        ipcRenderer.send('imprimir-ticket-raw', {
            numeroPedido: datos.numero_pedido,
            cliente: datos.nombre_cliente,
            orden: datos.items, 
            total: datos.total,
            costoDespacho: datos.costo_despacho || 0,
            tipoEntrega: datos.tipo_entrega,
            direccion: datos.direccion,
            telefono: datos.telefono,
            descripcion: datos.descripcion,
            notaPersonal: datos.nota_personal,
            fecha: String(datos.fechaString).split('-').reverse().join('/'),
            descuento: 0
        });
    } else {
        setUltimoPedidoParaImprimir(datos);
        setTimeout(() => {
            window.print();
            setUltimoPedidoParaImprimir(null);
        }, 800);
    }
  };

  const enviarCocina = async () => {
    if (orden.length === 0) return;
    if (!cajaAbierta) {
        alert("¡ATENCIÓN! Abra el turno en el módulo de CAJA para poder registrar pedidos.");
        return;
    }

    const hoy = getLocalISODate();
    const datos = {
        items: JSON.parse(JSON.stringify(orden)), 
        total: totalFinal,
        costo_despacho: tipoEntrega === 'REPARTO' ? (parseInt(costoDespacho) || 0) : 0, 
        tipo_entrega: tipoEntrega, 
        nombre_cliente: String(nombreCliente || 'CLIENTE').toUpperCase(),
        hora_pedido: String(horaPedido), 
        direccion: tipoEntrega === 'REPARTO' ? String(direccion) : '', 
        telefono: tipoEntrega === 'REPARTO' ? String(telefono) : '',
        nota_personal: tipoEntrega === 'REPARTO' ? String(notaPersonal).toUpperCase() : '',
        descripcion: String(descripcionGeneral).toUpperCase(), 
        fechaString: ordenAEditar ? (ordenAEditar.fechaString || hoy) : hoy,
        numero_pedido: ordenAEditar ? ordenAEditar.numero_pedido : numeroPedidoVisual,
        estado: ordenAEditar ? ordenAEditar.estado : "pendiente", 
        estado_pago: ordenAEditar ? ordenAEditar.estado_pago : "Pendiente",
        fecha: ordenAEditar ? ordenAEditar.fecha : Timestamp.now(), 
        usuario_id: user?.uid || "anonimo"
    };

    try {
        const colRef = collection(db, COL_ORDENES);
        if (ordenAEditar) {
            await updateDoc(doc(db, COL_ORDENES, ordenAEditar.id), datos);
            if (onTerminarEdicion) onTerminarEdicion();
        } else {
            await addDoc(colRef, datos);
            setNombreCliente(''); setDireccion(''); setTelefono(''); setNotaPersonal(''); setCostoDespacho(''); setDescripcionGeneral('');
            setOrden([]);
        }
        ejecutarImpresion(datos);
    } catch (error) {
        console.error("Error al procesar orden:", error);
    }
  };

  const agregarAlPedido = (p) => {
    if (!cajaAbierta) { alert("¡ATENCIÓN! No se pueden agregar productos porque el turno está cerrado."); return; }
    const existe = orden.find(item => item.id === p.id);
    if (existe) setOrden(prev => prev.map(item => item.id === p.id ? { ...item, cantidad: item.cantidad + 1 } : item));
    else setOrden(prev => [...prev, { ...p, cantidad: 1, observacion: '' }]);
  };

  const ajustarCantidad = (id, delta) => {
    setOrden(prev => prev.map(item => item.id === id ? { ...item, cantidad: Math.max(0, item.cantidad + delta) } : item).filter(item => item.cantidad > 0));
  };

  const handleNotaItemChange = (idx, valor) => {
    setOrden(prev => {
        const nuevaOrden = [...prev];
        nuevaOrden[idx] = { ...nuevaOrden[idx], observacion: valor.toUpperCase() };
        return nuevaOrden;
    });
  };

  const categorias = [...new Set(menu.map(m => m.categoria))].filter(Boolean);

  if (cargando && !orden.length) return <div className="h-full flex items-center justify-center font-black uppercase text-slate-300 animate-pulse bg-slate-50 italic tracking-widest">Iniciando Isakari POS...</div>;

  return (
    <div className="flex h-full bg-slate-100 overflow-hidden font-sans text-gray-800 relative main-app-container">
      <aside className="w-[400px] h-full bg-white shadow-xl flex flex-col z-20 border-r border-gray-200 flex-shrink-0 no-print">
        <div className="p-3 border-b border-gray-100 bg-gray-50 flex-shrink-0 space-y-2">
           <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-gray-900 uppercase tracking-tighter leading-none">Pedido #{numeroPedidoVisual}</h2>
                <span className={`text-[10px] font-black uppercase tracking-widest ${tipoEntrega === 'LOCAL' ? 'text-red-600' : 'text-orange-600'}`}>{tipoEntrega}</span>
              </div>
              <div className="flex gap-2">
                  <button onClick={() => setMostrarVistaPrevia(true)} className="p-2 bg-white border border-gray-200 rounded-2xl text-gray-400 hover:text-red-600 shadow-sm transition-all">👁️</button>
                  <button 
                    onClick={enviarCocina} 
                    disabled={!cajaAbierta}
                    className={`${!cajaAbierta ? 'bg-slate-300 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 active:scale-95'} text-white px-4 py-2 rounded-2xl text-[10px] font-black uppercase shadow-lg transition-all`}
                  >
                      {!cajaAbierta ? 'CAJA CERRADA' : (ordenAEditar ? 'ACTUALIZAR' : 'CONFIRMAR')}
                  </button>
              </div>
           </div>

           {!cajaAbierta && (
               <div className="bg-amber-50 border border-amber-200 p-2 rounded-xl text-center">
                   <p className="text-[10px] font-black text-amber-600 uppercase m-0 tracking-tighter">⚠️ Debe abrir caja para comenzar a tomar pedidos</p>
               </div>
           )}
           
           <input type="text" placeholder="NOMBRE CLIENTE *" className={inputStyle} value={nombreCliente} onChange={e => setNombreCliente(e.target.value)} />
           
           <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
             <button className={`flex-1 py-2 rounded-lg text-[10px] font-black transition-all ${tipoEntrega === 'LOCAL' ? 'bg-white shadow-sm text-red-600' : 'text-gray-400'}`} onClick={() => { setTipoEntrega('LOCAL'); setCostoDespacho(''); setDireccion(''); setTelefono(''); setNotaPersonal(''); }}>LOCAL</button>
             <button className={`flex-1 py-2 rounded-lg text-[10px] font-black transition-all ${tipoEntrega === 'REPARTO' ? 'bg-white shadow-sm text-orange-600' : 'text-gray-400'}`} onClick={() => setTipoEntrega('REPARTO')}>REPARTO</button>
           </div>
           
           {tipoEntrega === 'REPARTO' && (
             <div className="space-y-2 p-2.5 rounded-2xl border-2 border-orange-100 bg-orange-50/50 shadow-inner animate-in fade-in zoom-in-95 duration-200">
               <input type="text" placeholder="Dirección de entrega..." className={inputStyle + " border-orange-200"} value={direccion} onChange={e => setDireccion(e.target.value)} />
               <div className="flex gap-2">
                 <input type="text" placeholder="Tel" className={inputStyle + " flex-1 border-orange-200"} value={telefono} onChange={e => setTelefono(e.target.value)} />
                 <input type="number" placeholder="Envío" className={inputStyle + " border-orange-200 w-24 text-right"} value={costoDespacho} onChange={e => setCostoDespacho(e.target.value)} />
               </div>
               <input type="text" placeholder="NOTA TICKET CLIENTE..." className={inputStyle + " border-blue-100"} value={notaPersonal} onChange={e => setNotaPersonal(e.target.value)} />
             </div>
           )}
           
           <div className="px-3 py-3 bg-slate-900 text-white rounded-xl flex justify-between items-center shadow-lg border border-slate-800">
              <span className="text-[10px] font-black uppercase opacity-60 tracking-widest">Total</span>
              <span className="text-2xl font-black tracking-tighter leading-none">${totalFinal.toLocaleString('es-CL')}</span>
           </div>

           <textarea 
             placeholder="OBSERVACIONES PARA COCINA..." 
             className="w-full p-3 border-2 border-gray-100 rounded-2xl text-[10px] uppercase font-bold focus:border-red-500 outline-none resize-none h-16 bg-white shadow-inner" 
             value={descripcionGeneral} 
             onChange={e => setDescripcionGeneral(e.target.value)} 
           />
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-gray-50/50 custom-scrollbar">
          {orden.map((item, idx) => (
            <div key={idx} className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm flex flex-col animate-in fade-in">
                <div className="flex justify-between font-black text-[11px] uppercase text-slate-800">
                    <span className="flex-1 mr-2 leading-tight">{item.nombre}</span>
                    <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded-lg h-fit text-[10px]">{item.cantidad}x</span>
                </div>
                <div className="mt-2 flex gap-2 items-center">
                    <input 
                        type="text"
                        placeholder="Nota item..."
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[9px] font-black uppercase outline-none focus:border-blue-400 focus:bg-white transition-all shadow-inner"
                        value={item.observacion || ''}
                        onChange={(e) => handleNotaItemChange(idx, e.target.value)}
                    />
                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5 flex-shrink-0">
                        <button onClick={() => ajustarCantidad(item.id, -1)} className="px-2 text-gray-500 font-black">-</button>
                        <span className="px-2 text-[10px] font-black text-gray-800 bg-white rounded shadow-sm">{item.cantidad}</span>
                        <button onClick={() => ajustarCantidad(item.id, 1)} className="px-2 text-gray-500 font-black">+</button>
                    </div>
                </div>
            </div>
          ))}
          {orden.length === 0 && <div className="p-8 text-center text-slate-300 font-black uppercase text-[10px] tracking-widest mt-10 italic">Carrito Vacío</div>}
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto bg-slate-50 custom-scrollbar no-print">
        {!categoriaActual ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 animate-in slide-in-from-bottom-4 duration-300">
            {categorias.length > 0 ? categorias.map(cat => (
              <button key={cat} onClick={() => setCategoriaActual(cat)} className="h-48 bg-white border-4 border-slate-100 rounded-[3.5rem] shadow-sm hover:shadow-2xl transition-all font-black uppercase text-xs flex flex-col items-center justify-center gap-4 group">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-3xl group-hover:bg-red-50 transition-colors shadow-inner">🍱</div>
                <span>{cat}</span>
              </button>
            )) : (
              <div className="col-span-full py-20 text-center text-slate-300 font-black uppercase text-xs tracking-[0.3em]">
                {cargando ? "Cargando Menú..." : "No hay productos en el Menú"}
              </div>
            )}
          </div>
        ) : (
          <div className="animate-fade-in">
            <button onClick={() => setCategoriaActual(null)} className="mb-6 p-3 bg-white rounded-2xl border-2 border-slate-100 text-red-600 shadow-sm transition-colors hover:bg-red-50 font-black text-xs uppercase">⬅ Volver</button>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {menu.filter(m => m.categoria === categoriaActual).map(item => (
                <button key={item.id} onClick={() => agregarAlPedido(item)} className="p-6 bg-white border-2 border-slate-100 rounded-[2.5rem] flex flex-col items-center justify-between shadow-sm hover:shadow-2xl transition-all active:scale-95 min-h-[18rem] group">
                  <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-4xl group-hover:scale-110 transition-transform shadow-inner">🍣</div>
                  <div className="flex flex-col items-center gap-2 w-full flex-1 justify-center mt-4">
                    <span className="font-black text-[13px] uppercase text-center text-slate-800 line-clamp-2 leading-tight px-1">{item.nombre}</span>
                  </div>
                  <div className="w-full py-3 bg-red-600 text-white rounded-2xl font-black text-xs mt-3 shadow-lg group-hover:bg-red-700 transition-colors">
                    ${item.precio.toLocaleString('es-CL')}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {mostrarVistaPrevia && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[99999] flex items-center justify-center p-4 animate-in fade-in" onClick={() => setMostrarVistaPrevia(false)}>
            <div className="bg-white rounded-[3rem] p-8 max-w-sm w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                <Ticket 
                  orden={orden} 
                  total={totalFinal} 
                  numeroPedido={numeroPedidoVisual} 
                  tipoEntrega={tipoEntrega} 
                  fecha={getLocalISODate()} 
                  hora={horaPedido} 
                  cliente={nombreCliente} 
                  direccion={direccion}
                  telefono={telefono}
                  notaPersonal={notaPersonal}
                  descripcion={descripcionGeneral} 
                  costoDespacho={costoDespacho}
                />
                <button onClick={() => setMostrarVistaPrevia(false)} className="w-full mt-6 py-4 bg-slate-900 text-white font-black uppercase rounded-2xl shadow-xl no-print hover:bg-black transition-colors">Cerrar Vista</button>
            </div>
        </div>
      )}

      {ultimoPedidoParaImprimir && (
        <div className="hidden print:block fixed inset-0 bg-white z-[10000]">
            <Ticket 
              orden={ultimoPedidoParaImprimir.items} 
              total={ultimoPedidoParaImprimir.total} 
              numeroPedido={ultimoPedidoParaImprimir.numero_pedido} 
              tipoEntrega={ultimoPedidoParaImprimir.tipo_entrega} 
              fecha={ultimoPedidoParaImprimir.fechaString} 
              hora={ultimoPedidoParaImprimir.hora_pedido} 
              cliente={ultimoPedidoParaImprimir.nombre_cliente} 
              direccion={ultimoPedidoParaImprimir.direccion}
              telefono={ultimoPedidoParaImprimir.telefono}
              notaPersonal={ultimoPedidoParaImprimir.nota_personal}
              descripcion={ultimoPedidoParaImprimir.descripcion} 
              costoDespacho={ultimoPedidoParaImprimir.costo_despacho}
            />
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        
        @media print { 
          body * { visibility: hidden; } 
          .print\\:block, .print\\:block * { visibility: visible; } 
          .print\\:block { position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: white; z-index: 10000; } 
        }
      `}</style>
    </div>
  );
}