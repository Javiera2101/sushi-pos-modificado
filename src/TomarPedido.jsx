import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc, Timestamp, query, where, onSnapshot } from 'firebase/firestore';
// Corregimos las rutas de importación eliminando las extensiones para el compilador
import { db } from './firebase'; 
import { useUi } from './context/UiContext';
import Ticket from './Ticket';

// Detectar Electron de forma segura para impresión directa en térmicas (Modo POS)
const ipcRenderer = (function() {
  try {
    if (typeof window !== 'undefined' && window.require) {
      const electron = window.require('electron');
      return electron ? electron.ipcRenderer : null;
    }
  } catch (e) { return null; }
  return null;
})();

export default function TomarPedido({ ordenAEditar, onTerminarEdicion, user }) {
  const { notificar } = useUi();
  
  // --- ESTADOS DE DATOS ---
  const [menu, setMenu] = useState([]);
  const [orden, setOrden] = useState([]);
  const [numeroPedidoVisual, setNumeroPedidoVisual] = useState('...'); 
  const [tipoEntrega, setTipoEntrega] = useState('LOCAL');
  const [nombreCliente, setNombreCliente] = useState('');
  const [direccion, setDireccion] = useState('');
  const [telefono, setTelefono] = useState('');
  const [costoDespacho, setCostoDespacho] = useState('');
  const [descripcionGeneral, setDescripcionGeneral] = useState('');
  const [horaPedido, setHoraPedido] = useState(new Date().toLocaleTimeString('es-CL', {hour: '2-digit', minute:'2-digit'}));
  
  // --- ESTADOS DE UI ---
  const [categoriaActual, setCategoriaActual] = useState(null);
  const [cajaAbierta, setCajaAbierta] = useState(false); 
  const [cargando, setCargando] = useState(true); 
  const [mostrarVistaPrevia, setMostrarVistaPrevia] = useState(false);
  const [ultimoPedidoParaImprimir, setUltimoPedidoParaImprimir] = useState(null); 

  // Edición de notas por producto
  const [editandoNotaIndex, setEditandoNotaIndex] = useState(null);
  const [textoNotaTemp, setTextoNotaTemp] = useState('');
  const inputNotaRef = useRef(null);

  const COL_CAJAS = user?.email === "prueba@isakari.com" ? "cajas_pruebas" : "cajas";
  const COL_ORDENES = user?.email === "prueba@isakari.com" ? "ordenes_pruebas" : "ordenes";

  // Cargar datos en modo edición
  useEffect(() => {
    if (ordenAEditar) {
      setOrden(ordenAEditar.items || []);
      setNombreCliente(ordenAEditar.nombre_cliente || '');
      setTipoEntrega(ordenAEditar.tipo_entrega || 'LOCAL');
      setDireccion(ordenAEditar.direccion || '');
      setTelefono(ordenAEditar.telefono || '');
      setCostoDespacho(ordenAEditar.costo_despacho || '');
      setNumeroPedidoVisual(ordenAEditar.numero_pedido);
      setDescripcionGeneral(ordenAEditar.descripcion || '');
      setHoraPedido(ordenAEditar.hora_pedido || '');
    }
  }, [ordenAEditar]);

  // Suscripción al Menú y Estado de Caja
  useEffect(() => {
    if (!user) return;
    const unsubMenu = onSnapshot(collection(db, "menu"), (snap) => {
        setMenu(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.nombre || '').localeCompare(b.nombre || '')));
    }, err => console.error(err));

    const unsubCaja = onSnapshot(query(collection(db, COL_CAJAS), where("estado", "==", "abierta")), (snap) => {
        setCajaAbierta(!snap.empty);
        if (!snap.empty && !ordenAEditar) {
            const hoy = new Date().toISOString().split('T')[0];
            getDocs(collection(db, COL_ORDENES)).then(oSnap => {
                const max = oSnap.docs.map(doc => doc.data()).filter(o => o.fechaString === hoy).reduce((m, o) => Math.max(m, Number(o.numero_pedido) || 0), 0);
                setNumeroPedidoVisual(max + 1);
            });
        }
        setCargando(false);
    });

    return () => { unsubMenu(); unsubCaja(); };
  }, [user, COL_CAJAS, ordenAEditar]);

  // Foco automático en el input de nota
  useEffect(() => {
    if (editandoNotaIndex !== null && inputNotaRef.current) inputNotaRef.current.focus();
  }, [editandoNotaIndex]);

  const totalFinal = orden.reduce((acc, item) => acc + ((Number(item.precio) || 0) * (Number(item.cantidad) || 0)), 0) + (parseInt(costoDespacho) || 0);

  const resetearFormulario = () => {
    setOrden([]); 
    setNombreCliente(''); 
    setDireccion(''); 
    setTelefono(''); 
    setCostoDespacho(''); 
    setDescripcionGeneral('');
    setCategoriaActual(null);
  };

  const enviarCocina = async () => {
    if (orden.length === 0) {
      notificar("⚠️ Orden vacía", "error");
      return;
    }
    
    try {
        const hoy = new Date().toISOString().split('T')[0];
        const datos = {
            items: JSON.parse(JSON.stringify(orden)), 
            total: totalFinal,
            costo_despacho: parseInt(costoDespacho) || 0, 
            tipo_entrega: tipoEntrega, 
            nombre_cliente: String(nombreCliente).toUpperCase(),
            hora_pedido: String(horaPedido), 
            direccion: String(direccion), 
            telefono: String(telefono),
            descripcion: String(descripcionGeneral).toUpperCase(), 
            fechaString: hoy,
            numero_pedido: ordenAEditar ? ordenAEditar.numero_pedido : numeroPedidoVisual,
            estado: ordenAEditar ? ordenAEditar.estado : "pendiente", 
            estado_pago: ordenAEditar ? ordenAEditar.estado_pago : "Pendiente",
            fecha: ordenAEditar ? ordenAEditar.fecha : Timestamp.now(), 
            usuario_id: user?.uid || "anonimo"
        };

        if (ordenAEditar) {
            // MODO EDICIÓN: Optimista Offline
            updateDoc(doc(db, COL_ORDENES, ordenAEditar.id), datos).catch(err => console.error(err));
            notificar("¡Pedido Actualizado!", "success");
            resetearFormulario();
            if (onTerminarEdicion) onTerminarEdicion();
        } else {
            // MODO CREACIÓN: Optimista Offline
            addDoc(collection(db, COL_ORDENES), datos).catch(err => console.error(err));
            notificar("¡Orden Confirmada!", "success");
            
            // Notificación de Impresión Automática
            notificar(`Imprimiendo ticket orden #${datos.numero_pedido}...`, "success");
            
            setUltimoPedidoParaImprimir(datos);
            resetearFormulario();

            if (ipcRenderer) {
                ipcRenderer.send('imprimir-ticket-raw', {
                    numeroPedido: datos.numero_pedido,
                    cliente: datos.nombre_cliente,
                    items: datos.items,
                    total: datos.total,
                    tipoEntrega: datos.tipo_entrega,
                    direccion: datos.direccion,
                    telefono: datos.telefono,
                    descripcion: datos.descripcion
                });
            } else {
                setTimeout(() => { 
                    window.print(); 
                    setUltimoPedidoParaImprimir(null);
                }, 1200);
            }
        }
    } catch (e) { 
        notificar("Error al procesar el pedido", "error"); 
    }
  };

  const agregarAlPedido = (p) => {
    const existe = orden.find(item => item.id === p.id);
    if (existe) setOrden(orden.map(item => item.id === p.id ? { ...item, cantidad: item.cantidad + 1 } : item));
    else setOrden([...orden, { ...p, cantidad: 1, observacion: '' }]);
  };

  const ajustarCantidad = (id, delta) => {
    setOrden(orden.map(item => item.id === id ? { ...item, cantidad: Math.max(0, item.cantidad + delta) } : item).filter(item => item.cantidad > 0));
  };

  const guardarNotaItem = (index) => {
    setOrden(prev => {
        const nueva = [...prev];
        nueva[index] = { ...nueva[index], observacion: textoNotaTemp.toUpperCase() };
        return nueva;
    });
    setEditandoNotaIndex(null);
  };

  if (cargando && !orden.length) return <div className="h-full flex items-center justify-center font-black uppercase text-slate-400 animate-pulse">Cargando Pedido...</div>;

  return (
    <div className="flex h-full bg-slate-100 overflow-hidden font-sans text-gray-800 relative">
      
      {/* SECCIÓN IZQUIERDA: CARRITO */}
      <aside className="w-[400px] h-full bg-white shadow-xl flex flex-col z-20 border-r border-gray-200 flex-shrink-0">
        <div className="p-3 border-b border-gray-100 bg-gray-50 flex-shrink-0 space-y-2">
           <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-gray-900 uppercase tracking-tighter leading-none">Orden #{numeroPedidoVisual}</h2>
                <span className="text-[10px] font-black uppercase text-red-600 tracking-widest">{tipoEntrega}</span>
              </div>
              <div className="flex gap-2">
                  <button onClick={() => setMostrarVistaPrevia(true)} className="p-2 bg-white border border-gray-200 rounded-2xl text-gray-400 hover:text-red-600 transition-colors shadow-sm"><i className="bi bi-eye-fill"></i></button>
                  <button onClick={enviarCocina} className="bg-red-600 text-white px-4 py-2 rounded-2xl text-[10px] font-black uppercase shadow-lg hover:bg-red-700 active:scale-95 transition-all">
                      {ordenAEditar ? 'ACTUALIZAR' : 'CONFIRMAR'}
                  </button>
              </div>
           </div>
           
           <input type="text" placeholder="NOMBRE CLIENTE *" className="w-full p-2.5 rounded-2xl border-2 border-gray-100 bg-white focus:ring-2 focus:ring-red-100 outline-none text-xs font-black uppercase" value={nombreCliente} onChange={e => setNombreCliente(e.target.value)} />
           
           <div className="flex bg-slate-100 rounded-xl p-1">
             <button className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${tipoEntrega === 'LOCAL' ? 'bg-white shadow-sm text-red-600' : 'text-gray-400'}`} onClick={() => { setTipoEntrega('LOCAL'); setCostoDespacho(''); }}>LOCAL</button>
             <button className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${tipoEntrega === 'REPARTO' ? 'bg-white shadow-sm text-orange-600' : 'text-gray-400'}`} onClick={() => setTipoEntrega('REPARTO')}>REPARTO</button>
           </div>
           
           {tipoEntrega === 'REPARTO' && (
             <div className="space-y-2 bg-orange-50 p-2 rounded-2xl border border-orange-100">
               <input type="text" placeholder="Dirección..." className="w-full p-2 bg-white border border-orange-200 rounded-lg text-[10px] font-bold outline-none" value={direccion} onChange={e => setDireccion(e.target.value)} />
               <div className="flex gap-2">
                 <input type="text" placeholder="Teléfono" className="flex-1 p-2 bg-white border border-orange-200 rounded-lg text-[10px] font-bold outline-none" value={telefono} onChange={e => setTelefono(e.target.value)} />
                 <input type="number" placeholder="Envío" className="w-20 p-2 bg-white border border-orange-200 rounded-lg text-[10px] font-black text-right outline-none" value={costoDespacho} onChange={e => setCostoDespacho(e.target.value)} />
               </div>
             </div>
           )}
           
           <div className="px-3 py-2 bg-slate-900 text-white rounded-xl flex justify-between items-center shadow-lg border border-slate-800">
              <span className="text-[9px] font-black uppercase opacity-60 tracking-widest">Total</span>
              <span className="text-xl font-black tracking-tighter leading-none">${totalFinal.toLocaleString('es-CL')}</span>
           </div>
           
           <textarea 
             placeholder="NOTAS GENERALES..." 
             className="w-full p-2 border border-gray-200 rounded-xl text-[9px] uppercase font-bold focus:border-blue-600 outline-none resize-none h-10 bg-white shadow-inner" 
             value={descripcionGeneral} 
             onChange={e => setDescripcionGeneral(e.target.value)} 
           />
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-gray-50/50 custom-scrollbar">
          {orden.map((item, idx) => (
            <div key={idx} className="bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                <div className="flex justify-between font-black text-xs uppercase text-slate-800">
                    <span className="flex-1 mr-2 leading-tight">{item.nombre}</span>
                    <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded-lg h-fit text-[10px]">{item.cantidad}x</span>
                </div>
                
                <div className="mt-2 flex justify-between items-center">
                    {editandoNotaIndex === idx ? (
                        <div className="flex gap-1 w-full">
                            <input ref={inputNotaRef} type="text" className="flex-1 p-1.5 border-2 border-blue-200 rounded-lg text-[10px] font-bold uppercase outline-none" placeholder="Nota..." value={textoNotaTemp} onChange={(e) => setTextoNotaTemp(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') guardarNotaItem(idx); }} />
                            <button onClick={() => guardarNotaItem(idx)} className="bg-blue-600 text-white px-2 rounded-lg text-[10px]"><i className="bi bi-check-lg"></i></button>
                        </div>
                    ) : (
                        <>
                            <button onClick={() => { setTextoNotaTemp(item.observacion || ''); setEditandoNotaIndex(idx); }} className="text-[10px] font-black text-blue-600 uppercase bg-blue-50 px-2 py-1 rounded-lg">Nota</button>
                            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                                <button onClick={() => ajustarCantidad(item.id, -1)} className="px-2 text-gray-500 font-black">-</button>
                                <span className="px-2 text-[10px] font-black text-gray-800 bg-white rounded">{item.cantidad}</span>
                                <button onClick={() => ajustarCantidad(item.id, 1)} className="px-2 text-gray-500 font-black">+</button>
                            </div>
                        </>
                    )}
                </div>
                {item.observacion && editandoNotaIndex !== idx && (
                    <div className="mt-1 text-[9px] font-black text-amber-600 italic">★ {item.observacion}</div>
                )}
            </div>
          ))}
          {orden.length === 0 && <div className="p-8 text-center text-slate-300 font-black uppercase text-xs tracking-widest">Carrito Vacío</div>}
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto bg-slate-50">
        {!categoriaActual ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[...new Set(menu.map(m => m.categoria))].filter(Boolean).map(cat => (
              <button key={cat} onClick={() => setCategoriaActual(cat)} className="h-48 bg-white border-4 border-slate-100 rounded-[3.5rem] shadow-sm hover:shadow-2xl transition-all font-black uppercase text-xs flex flex-col items-center justify-center gap-4 group">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-3xl group-hover:bg-red-50 transition-colors shadow-inner">📂</div>
                <span>{cat}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="animate-fade-in">
            <button onClick={() => setCategoriaActual(null)} className="mb-6 p-3 bg-white rounded-2xl border-2 border-slate-100 text-red-600 shadow-sm transition-colors hover:bg-red-50"><i className="bi bi-arrow-left text-xl"></i></button>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {menu.filter(m => m.categoria === categoriaActual).map(item => (
                <button key={item.id} onClick={() => agregarAlPedido(item)} className="p-6 bg-white border-2 border-slate-100 rounded-[2.5rem] flex flex-col items-center justify-between shadow-sm hover:shadow-2xl transition-all active:scale-95 min-h-[18rem] group">
                  <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-4xl group-hover:scale-110 transition-transform shadow-inner">🍣</div>
                  
                  <div className="flex flex-col items-center gap-2 w-full flex-1 justify-center mt-4">
                    <span className="font-black text-[13px] uppercase text-center text-slate-800 line-clamp-2 leading-tight px-1">{item.nombre}</span>
                    
                    {item.descripcion && (
                      <span className="text-[10px] text-gray-500 font-bold uppercase text-center px-2 italic bg-slate-50 rounded-lg py-1 w-full line-clamp-2">
                        {item.descripcion}
                      </span>
                    )}
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

      {/* TICKET INVISIBLE PARA IMPRESIÓN AUTOMÁTICA (WEB) */}
      {ultimoPedidoParaImprimir && (
        <div className="hidden print:block fixed inset-0 bg-white z-[10000]">
            <Ticket 
              orden={ultimoPedidoParaImprimir.items} 
              total={ultimoPedidoParaImprimir.total} 
              numeroPedido={ultimoPedidoParaImprimir.numero_pedido} 
              tipoEntrega={ultimoPedidoParaImprimir.tipo_entrega} 
              fecha={new Date().toLocaleDateString('es-CL')} 
              hora={ultimoPedidoParaImprimir.hora_pedido} 
              cliente={ultimoPedidoParaImprimir.nombre_cliente} 
              descripcion={ultimoPedidoParaImprimir.descripcion} 
            />
        </div>
      )}

      {/* VISTA PREVIA MODAL */}
      {mostrarVistaPrevia && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[99999] flex items-center justify-center p-4" onClick={() => setMostrarVistaPrevia(false)}>
            <div className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <Ticket 
                  orden={orden} 
                  total={totalFinal} 
                  numeroPedido={numeroPedidoVisual} 
                  tipoEntrega={tipoEntrega} 
                  fecha={new Date().toLocaleDateString('es-CL')} 
                  hora={horaPedido} 
                  cliente={nombreCliente} 
                  descripcion={descripcionGeneral} 
                />
                <button onClick={() => setMostrarVistaPrevia(false)} className="w-full mt-6 py-4 bg-slate-900 text-white font-black uppercase rounded-2xl">Cerrar Vista</button>
            </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        @media print {
            body * { visibility: hidden; }
            .print\\:block, .print\\:block * { visibility: visible; }
            .print\\:block { position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: white; }
        }
      `}</style>
    </div>
  );
}