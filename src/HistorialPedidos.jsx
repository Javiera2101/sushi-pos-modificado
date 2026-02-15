import React, { useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  Timestamp,
  deleteDoc,
  getDocs,
  enableIndexedDbPersistence
} from 'firebase/firestore';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
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

// --- UTILIDADES ---
const getLocalISODate = (dateInput) => {
  const d = dateInput ? (dateInput instanceof Date ? dateInput : (dateInput?.toDate ? dateInput.toDate() : new Date(dateInput))) : new Date();
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};

// --- COMPONENTE TICKET (INCLUIDO PARA EVITAR ERROR DE IMPORTACIÓN) ---
const Ticket = ({ orden, total, numeroPedido, tipoEntrega, fecha, hora, cliente, direccion, telefono, descripcion, notaPersonal, costoDespacho, horaEntrega, estadoPago, metodoPago, detallesPago }) => {
    const fechaChile = fecha && fecha.includes('-') ? fecha.split('-').reverse().join('/') : fecha;

    // Lógica para el texto del pago al final
    let textoPago = "PAGO PENDIENTE";
    let estiloPago = "border-black"; 

    if (String(estadoPago).toLowerCase() === 'pagado') {
        estiloPago = "border-black bg-black text-white"; 
        if (detallesPago && detallesPago.length > 0) {
            const metodos = detallesPago.map(d => d.metodo).join(' Y ');
            textoPago = `PAGADO CON ${metodos.toUpperCase()}`;
        } else {
            textoPago = `PAGADO CON ${(metodoPago || 'EFECTIVO').toUpperCase()}`;
        }
    }

    return (
        <div className="bg-white p-4 border border-gray-200 font-mono text-[10px] leading-tight max-w-[300px] mx-auto text-black shadow-inner">
            <div className="text-center font-black mb-1 uppercase text-xs">Isakari Sushi</div>
            <div className="text-center mb-2 font-black">Orden #{numeroPedido}</div>
            <div className="border-b border-dashed border-gray-400 mb-2"></div>
            
            <div className="mb-2 space-y-1">
                <div>FECHA: {fechaChile} {hora}</div>
                {horaEntrega && <div className="font-bold bg-black text-white inline-block px-1">ENTREGA: {horaEntrega}</div>}
                
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

            <div className={`uppercase mt-3 border p-1 text-center font-bold ${estiloPago}`}>
                {textoPago}
            </div>

            <div className="text-center mt-2 opacity-50 uppercase text-[8px]">Sistema POS Local - Chile</div>
        </div>
    );
};

export default function HistorialPedidos({ onEditar, user }) {
  const [notificacion, setNotificacion] = useState({ mostrar: false, mensaje: '', tipo: '' });
  const notificar = (mensaje, tipo = 'success') => {
    setNotificacion({ mostrar: true, mensaje, tipo });
    setTimeout(() => setNotificacion({ mostrar: false, mensaje: '', tipo: '' }), 3000);
  };

  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [fechaFiltro, setFechaFiltro] = useState(getLocalISODate());
  
  const [pedidoParaCobrar, setPedidoParaCobrar] = useState(null);
  const [pedidoParaEliminar, setPedidoParaEliminar] = useState(null); 
  const [procesandoPago, setProcesandoPago] = useState(false);
  const [modoPago, setModoPago] = useState('unico'); 
  const [metodoUnico, setMetodoUnico] = useState('Efectivo');
  const [aplicarDescuento, setAplicarDescuento] = useState(false);
  
  const [montosMixtos, setMontosMixtos] = useState({ Efectivo: '', Transferencia: '', Débito: '' });
  const [metodosHabilitados, setMetodosHabilitados] = useState({ Efectivo: true, Transferencia: false, Débito: false });
  const [pedidoActivoParaImprimir, setPedidoActivoParaImprimir] = useState(null);

  // --- CORRECCIÓN DE RUTAS A RAÍZ ---
  const colOrdenes = user?.email === "prueba@isakari.com" ? "ordenes_pruebas" : "ordenes";
  const colMovimientos = user?.email === "prueba@isakari.com" ? "movimientos_pruebas" : "movimientos";

  const getRawNumber = (v) => Number(v.toString().replace(/\./g, '')) || 0;
  const formatPeso = (v) => (Number(v) || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
  const formatInput = (v) => v.toString().replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  // OPTIMIZACIÓN DE LECTURAS (Con ruta corregida a la raíz)
  useEffect(() => {
    if (!user) return;
    setCargando(true);
    
    const hoy = getLocalISODate();
    // Usamos collection(db, colOrdenes) directamente para apuntar a la raíz
    const q = query(collection(db, colOrdenes), where("fechaString", "==", fechaFiltro));
    
    let unsubscribe;

    if (fechaFiltro === hoy) {
        unsubscribe = onSnapshot(q, (snap) => {
            const docs = snap.docs.map(d => ({
                id: d.id,
                ...d.data(),
                estado_pago: String(d.data().estado_pago || "Pendiente").trim()
            }));
            docs.sort((a, b) => (b.numero_pedido || 0) - (a.numero_pedido || 0));
            setPedidos(docs);
            setCargando(false);
        }, (err) => {
            console.error("Error historial hoy:", err);
            setCargando(false);
        });
    } else {
        getDocs(q).then((snap) => {
            const docs = snap.docs.map(d => ({
                id: d.id,
                ...d.data(),
                estado_pago: String(d.data().estado_pago || "Pendiente").trim()
            }));
            docs.sort((a, b) => (b.numero_pedido || 0) - (a.numero_pedido || 0));
            setPedidos(docs);
            setCargando(false);
        }).catch(err => {
            console.error("Error historial pasado:", err);
            setCargando(false);
        });
    }

    return () => unsubscribe && unsubscribe();
  }, [user, fechaFiltro, colOrdenes]);

  const ejecutarImpresionAutomatica = (pedido) => {
    if (ipcRenderer) {
        ipcRenderer.send('imprimir-ticket-raw', {
            numeroPedido: pedido.numero_pedido,
            cliente: pedido.nombre_cliente,
            orden: pedido.items, 
            total: pedido.total_pagado || pedido.total,
            costoDespacho: pedido.costo_despacho || 0,
            tipoEntrega: pedido.tipo_entrega,
            direccion: pedido.direccion,
            telefono: pedido.telefono,
            descripcion: pedido.descripcion,
            notaPersonal: pedido.nota_personal || '',
            fecha: pedido.fechaString ? pedido.fechaString.split('-').reverse().join('/') : getLocalISODate().split('-').reverse().join('/'),
            horaEntrega: pedido.hora_entrega,
            estadoPago: pedido.estado_pago,
            metodoPago: pedido.metodo_pago,
            detallesPago: pedido.detalles_pago,
            descuento: pedido.descuento || 0
        });
    } else {
        setPedidoActivoParaImprimir(pedido);
        setTimeout(() => {
            window.print();
            setPedidoActivoParaImprimir(null);
        }, 800);
    }
  };

  const ejecutarEliminacion = async () => {
    if (!pedidoParaEliminar) return;
    try {
        await deleteDoc(doc(db, colOrdenes, pedidoParaEliminar.id));
        notificar(`PEDIDO #${pedidoParaEliminar.numero_pedido} ELIMINADO CORRECTAMENTE`, "success");
        setPedidoParaEliminar(null);
    } catch (error) {
        console.error(error);
        notificar("ERROR AL ELIMINAR PEDIDO", "error");
    }
  };

  const toggleMetodoMixto = (metodo) => {
    const nuevoEstado = !metodosHabilitados[metodo];
    setMetodosHabilitados(prev => ({ ...prev, [metodo]: nuevoEstado }));
    const totalOriginal = pedidoParaCobrar?.total || 0;
    const desc = aplicarDescuento ? Math.round(totalOriginal * 0.1) : 0;
    const totalObjetivo = totalOriginal - desc;

    if (nuevoEstado) {
      const sumaActual = Object.entries(montosMixtos)
        .filter(([m]) => metodosHabilitados[m] && m !== metodo)
        .reduce((acc, [_, v]) => acc + getRawNumber(v), 0);
      const faltante = Math.max(0, totalObjetivo - sumaActual);
      setMontosMixtos(prev => ({ ...prev, [metodo]: formatInput(faltante) }));
    } else {
      setMontosMixtos(prev => ({ ...prev, [metodo]: '' }));
    }
  };

  const confirmarPago = async () => {
    if (!pedidoParaCobrar) return;
    const p = pedidoParaCobrar;
    const montoDescuento = aplicarDescuento ? Math.round(p.total * 0.1) : 0;
    const totalACobrar = p.total - montoDescuento;

    const metodosFinales = modoPago === 'unico' 
      ? [{ metodo: metodoUnico, monto: totalACobrar }]
      : Object.entries(montosMixtos)
          .filter(([m]) => metodosHabilitados[m] && getRawNumber(montosMixtos[m]) > 0)
          .map(([m, v]) => ({ metodo: m, monto: getRawNumber(v) }));
    
    const totalIngresado = metodosFinales.reduce((acc, item) => acc + item.monto, 0);
    
    if (totalIngresado < totalACobrar && modoPago === 'mixto') {
      notificar(`FALTAN ${formatPeso(totalACobrar - totalIngresado)}`, "error");
      return;
    }

    setProcesandoPago(true);

    const datosPago = {
      estado_pago: 'Pagado',
      metodo_pago: modoPago === 'unico' ? metodoUnico : 'Mixto',
      detalles_pago: metodosFinales,
      descuento: montoDescuento,
      total_pagado: totalIngresado,
      fecha_pago: Timestamp.now()
    };

    try {
        const pedidoRef = doc(db, colOrdenes, p.id);
        await updateDoc(pedidoRef, datosPago);

        const movRef = collection(db, colMovimientos);
        for (const item of metodosFinales) {
            await addDoc(movRef, {
                tipo: 'ingreso',
                categoria: 'VENTA',
                monto: item.monto,
                descripcion: `VENTA PEDIDO #${p.numero_pedido}${aplicarDescuento ? ' (DESC 10%)' : ''}`,
                metodo: item.metodo,
                fecha: Timestamp.now(),
                usuario_id: user.uid,
                pedido_id: p.id
            });
        }

        notificar(`PAGO REGISTRADO CORRECTAMENTE`, "success");
        
        ejecutarImpresionAutomatica({
            ...p,
            ...datosPago 
        });

    } catch (err) {
        console.error("Error sincronización pago:", err);
        notificar("ERROR AL REGISTRAR PAGO", "error");
    } finally {
        setPedidoParaCobrar(null);
        setAplicarDescuento(false);
        setProcesandoPago(false);
    }
  };

  const handleAnularPago = async () => {
    if (!pedidoParaCobrar) return;
    if (!window.confirm(`¿Quieres quitar el pago del pedido #${pedidoParaCobrar.numero_pedido}?`)) return;

    const p = pedidoParaCobrar;
    
    try {
        await updateDoc(doc(db, colOrdenes, p.id), {
            estado_pago: 'Pendiente',
            metodo_pago: 'N/A',
            detalles_pago: [],
            descuento: 0,
            total_pagado: 0,
            fecha_pago: null
        });

        await addDoc(collection(db, colMovimientos), {
            tipo: 'egreso',
            categoria: 'ANULACION',
            monto: p.total_pagado || p.total,
            descripcion: `ANULACIÓN PAGO PEDIDO #${p.numero_pedido}`,
            metodo: p.metodo_pago || 'Otro',
            fecha: Timestamp.now(),
            usuario_id: user.uid,
            pedido_id: p.id
        });

        setPedidoParaCobrar(null);
        setAplicarDescuento(false);
        notificar(`PAGO ANULADO CORRECTAMENTE`, "success");
    } catch (e) {
        console.error(e);
        notificar("ERROR AL ANULAR PAGO", "error");
    }
  };

  const toggleEstado = async (pedido) => {
    const nuevoEstado = pedido.estado === 'entregado' ? 'pendiente' : 'entregado';
    try {
      await updateDoc(doc(db, colOrdenes, pedido.id), { estado: nuevoEstado });
      const msg = nuevoEstado === 'entregado' 
        ? `PEDIDO #${pedido.numero_pedido} ENTREGADO CORRECTAMENTE` 
        : `PEDIDO #${pedido.numero_pedido} DEVUELTO A PENDIENTE CORRECTAMENTE`;
      notificar(msg, "success");
    } catch (e) {
      console.error(e);
      notificar("ERROR AL ACTUALIZAR ESTADO", "error");
    }
  };

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-100 font-sans text-gray-800 relative">
      {notificacion.mostrar && (
        <div className={`fixed top-4 right-4 z-[100000] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 transition-all duration-500 ${notificacion.tipo === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`} style={{ animation: 'slideIn 0.3s ease-out forwards' }}>
            <span className="text-2xl">{notificacion.tipo === 'error' ? '🚫' : '✅'}</span>
            <div>
                <h4 className="font-black uppercase text-xs opacity-75">{notificacion.tipo === 'error' ? 'Error' : 'Éxito'}</h4>
                <p className="font-bold text-sm leading-tight">{notificacion.mensaje}</p>
            </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 m-0 leading-none">Ventas Registradas</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Gestión Histórica • {pedidos.length} Pedidos</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-3xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 px-3 border-r border-slate-100">
            <i className="bi bi-calendar-event text-red-500"></i>
            <input 
              type="date" 
              className="outline-none text-[11px] font-black uppercase text-slate-700 bg-transparent cursor-pointer"
              value={fechaFiltro}
              onChange={(e) => setFechaFiltro(e.target.value)}
            />
          </div>

          <div className="flex gap-1">
            {['todos', 'pendiente', 'entregado'].map(f => (
              <button 
                key={f} 
                onClick={() => setFiltroEstado(f)} 
                className={`px-5 py-2 rounded-2xl text-[10px] font-black uppercase transition-all ${filtroEstado === f ? 'bg-slate-900 text-white shadow-md' : 'text-gray-400 hover:text-slate-600'}`}
              >
                {f === 'todos' ? 'Ver Todos' : f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {cargando ? (
        <div className="py-20 text-center font-black text-slate-300 animate-pulse uppercase tracking-widest text-xs">Cargando datos del servidor...</div>
      ) : (
        <div className="grid gap-4 pb-32">
          {pedidos
            .filter(p => filtroEstado === 'todos' || String(p.estado).toLowerCase() === filtroEstado.toLowerCase())
            .map(pedido => {
              const isPaid = String(pedido.estado_pago || '').toLowerCase() === 'pagado';
              const isDelivered = String(pedido.estado).toLowerCase() === 'entregado';
              
              return (
                <div key={pedido.id} className={`p-6 rounded-[2.5rem] border-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between bg-white transition-all ${isDelivered ? 'border-emerald-500/20' : 'border-amber-400/20'}`}>
                  <div className="flex items-start gap-5 flex-1 min-w-0">
                    <div className={`w-14 h-14 rounded-2xl flex-shrink-0 flex items-center justify-center font-black text-white text-lg shadow-lg ${isDelivered ? 'bg-emerald-600' : 'bg-amber-500'}`}>
                      #{pedido.numero_pedido}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                          <h4 className="font-black text-slate-900 uppercase text-base m-0 truncate">{pedido.nombre_cliente || 'Cliente'}</h4>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase ${isDelivered ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {pedido.estado}
                          </span>
                      </div>
                      <p className="text-[10px] text-slate-500 font-bold uppercase m-0 mt-1">
                        {pedido.tipo_entrega} • {pedido.hora_pedido} • {pedido.fechaString?.split('-').reverse().join('/')}
                      </p>
                      
                      <div className="mt-3 space-y-1 bg-slate-50 p-3 rounded-2xl border border-slate-100 max-w-md">
                        {pedido.items?.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center text-[10px] font-black uppercase text-slate-600">
                                <div className="flex flex-col">
                                    <div className="flex gap-2 items-center">
                                        <span className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-900 w-8 text-center">{item.cantidad}x</span>
                                        <span>{item.nombre}</span>
                                    </div>
                                    {item.descripcion && <span className="text-[8px] text-slate-400 font-bold ml-10 italic lowercase">({item.descripcion})</span>}
                                    {item.observacion && <span className="text-[8px] text-blue-600 ml-10 italic lowercase">↳ {item.observacion}</span>}
                                </div>
                            </div>
                        ))}
                      </div>

                      {pedido.descripcion && (
                        <div className="mt-2 p-2.5 bg-amber-50 border border-amber-100 rounded-xl max-w-md">
                            <span className="text-[8px] font-black text-amber-600 uppercase tracking-widest block mb-0.5">Observaciones de Cocina:</span>
                            <p className="text-[10px] font-bold text-slate-700 m-0 uppercase leading-tight italic">{pedido.descripcion}</p>
                        </div>
                      )}

                      {pedido.tipo_entrega === 'REPARTO' && pedido.nota_personal && (
                          <div className="mt-2 p-2.5 bg-blue-50 border border-blue-100 rounded-xl max-w-md">
                            <span className="text-[8px] font-black text-blue-600 uppercase tracking-widest block mb-0.5">Nota de Reparto:</span>
                            <p className="text-[10px] font-bold text-slate-700 m-0 uppercase leading-tight italic">{pedido.nota_personal}</p>
                          </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-row md:flex-col items-center md:items-end gap-4 mt-4 md:mt-0 ml-0 md:ml-6 w-full md:w-auto">
                    <div className="text-left md:text-right flex-1 md:flex-initial">
                      <div className="text-2xl font-black text-slate-900">{formatPeso(pedido.total_pagado || pedido.total)}</div>
                      <div className={`text-[9px] font-black uppercase tracking-widest ${isPaid ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {isPaid ? `PAGADO (${pedido.metodo_pago})` : 'PAGO PENDIENTE'}
                        {pedido.descuento > 0 && <span className="ml-2 text-blue-500">-{formatPeso(pedido.descuento)}</span>}
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <button onClick={() => ejecutarImpresionAutomatica(pedido)} className="w-11 h-11 rounded-xl bg-slate-50 text-slate-400 hover:bg-slate-900 hover:text-white transition-all flex items-center justify-center shadow-sm" title="Imprimir"><i className="bi bi-printer"></i></button>
                      <button onClick={() => onEditar(pedido)} className="w-11 h-11 rounded-xl bg-slate-50 text-slate-400 hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center shadow-sm" title="Editar"><i className="bi bi-pencil"></i></button>
                      
                      <button 
                        onClick={() => setPedidoParaEliminar(pedido)} 
                        className="w-11 h-11 rounded-xl bg-red-50 text-red-500 hover:bg-red-600 hover:text-white transition-all flex items-center justify-center shadow-sm" 
                        title="Eliminar"
                      >
                        <i className="bi bi-trash3"></i>
                      </button>

                      <button 
                        onClick={() => toggleEstado(pedido)} 
                        className={`px-4 h-11 rounded-xl text-[9px] font-black uppercase border-2 transition-all ${isDelivered ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-amber-600 border-amber-200'}`}
                      >
                        {isDelivered ? 'Listo' : 'Entregar'}
                      </button>

                      <button onClick={() => {
                        setPedidoParaCobrar(pedido);
                        setModoPago('unico');
                        setAplicarDescuento(false);
                        setMontosMixtos({ Efectivo: '', Transferencia: '', Débito: '' });
                      }} className={`px-5 h-11 rounded-xl text-[10px] font-black uppercase shadow-lg active:scale-95 transition-all ${isPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-900 text-white'}`}>
                        {isPaid ? 'Pago' : 'Cobrar'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {pedidoParaEliminar && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[9999] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-[3rem] shadow-2xl p-10 w-full max-w-sm border border-white text-center scale-in">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-red-100 shadow-inner">
                <i className="bi bi-exclamation-triangle-fill text-3xl"></i>
            </div>
            <h3 className="font-black uppercase text-xl text-slate-900 m-0 tracking-tighter">¿Eliminar Pedido?</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-4 leading-tight">
                ESTA ACCIÓN BORRARÁ EL PEDIDO #{pedidoParaEliminar.numero_pedido} DEFINITIVAMENTE.
            </p>
            <div className="flex gap-4 mt-8">
                <button 
                  onClick={() => setPedidoParaEliminar(null)} 
                  className="flex-1 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:bg-slate-50 rounded-2xl transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={ejecutarEliminacion} 
                  className="flex-[2] py-4 bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase shadow-xl shadow-red-200 hover:bg-red-700 active:scale-95 transition-all"
                >
                  Sí, Eliminar
                </button>
            </div>
          </div>
        </div>
      )}

      {pedidoParaCobrar && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[3rem] shadow-2xl p-10 w-full max-w-md border border-white scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-6">
              <div>
                  <h3 className="font-black uppercase text-lg text-slate-900 m-0 tracking-tighter">
                    {String(pedidoParaCobrar.estado_pago).toLowerCase() === 'pagado' ? 'Modificar Pago' : 'Cobrar'} #{pedidoParaCobrar.numero_pedido}
                  </h3>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{pedidoParaCobrar.nombre_cliente}</span>
              </div>
              <button 
                onClick={() => setModoPago(modoPago === 'unico' ? 'mixto' : 'unico')} 
                className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase transition-all ${modoPago === 'mixto' ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}
              >
                {modoPago === 'mixto' ? 'Pago Mixto' : 'Activar Mixto'}
              </button>
            </div>

            <div className="flex flex-col gap-4 mb-8">
                <div className="bg-slate-50 p-6 rounded-[2rem] border-2 border-slate-100 text-center relative overflow-hidden">
                    <div className="flex flex-col items-center">
                        <span className="text-4xl font-black text-slate-900 tracking-tighter">
                            {formatPeso(pedidoParaCobrar.total - (aplicarDescuento ? Math.round(pedidoParaCobrar.total * 0.1) : 0))}
                        </span>
                        {aplicarDescuento && (
                            <span className="text-[10px] font-black text-red-500 uppercase mt-1 line-through opacity-50">
                                Original: {formatPeso(pedidoParaCobrar.total)}
                            </span>
                        )}
                    </div>
                </div>

                <button 
                    onClick={() => setAplicarDescuento(!aplicarDescuento)}
                    className={`w-full py-4 rounded-2xl border-2 font-black uppercase text-[11px] transition-all flex items-center justify-center gap-3 ${aplicarDescuento ? 'bg-emerald-50 border-emerald-500 text-emerald-600 shadow-inner' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200'}`}
                >
                    <i className={`bi ${aplicarDescuento ? 'bi-check-circle-fill' : 'bi-percent'}`}></i>
                    {aplicarDescuento ? 'DESCUENTO 10% APLICADO' : 'APLICAR DESCUENTO 10%'}
                </button>
            </div>

            {modoPago === 'unico' ? (
                <div className="grid grid-cols-3 gap-2 mb-8">
                    {['Efectivo', 'Transferencia', 'Débito'].map(m => (
                        <button key={m} onClick={() => setMetodoUnico(m)} className={`py-4 rounded-2xl font-black text-[10px] border-2 uppercase transition-all ${metodoUnico === m ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-100 text-gray-400'}`}>{m}</button>
                    ))}
                </div>
            ) : (
                <div className="space-y-4 mb-8">
                    <div className="grid grid-cols-3 gap-2">
                        {['Efectivo', 'Transferencia', 'Débito'].map(m => (
                            <div key={m} className="flex flex-col gap-2">
                                <button 
                                  onClick={() => toggleMetodoMixto(m)} 
                                  className={`py-2 rounded-xl border-2 text-[9px] font-black uppercase transition-all ${metodosHabilitados[m] ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-300'}`}
                                >
                                    {m}
                                </button>
                                <input 
                                  type="text" 
                                  disabled={!metodosHabilitados[m]} 
                                  className="w-full p-2 bg-slate-50 rounded-xl border-2 border-slate-100 outline-none text-right font-black text-[10px] focus:border-blue-400 disabled:opacity-30" 
                                  placeholder="0" 
                                  value={montosMixtos[m]} 
                                  onChange={(e) => setMontosMixtos(prev => ({...prev, [m]: formatInput(e.target.value)}))} 
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button onClick={() => { setPedidoParaCobrar(null); setAplicarDescuento(false); }} className="flex-1 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Cancelar</button>
                <button onClick={confirmarPago} disabled={procesandoPago} className="flex-[2] py-4 bg-green-600 text-white rounded-2xl text-[10px] font-black uppercase shadow-xl active:scale-95 flex items-center justify-center gap-2">
                  {procesandoPago ? 'Guardando...' : 'Confirmar Cobro'}
                </button>
              </div>
              
              {pedidoParaCobrar && String(pedidoParaCobrar.estado_pago).toLowerCase() === 'pagado' && (
                <button 
                  onClick={handleAnularPago} 
                  disabled={procesandoPago}
                  className="w-full py-3 bg-red-50 text-red-600 rounded-2xl text-[9px] font-black uppercase border border-red-100 hover:bg-red-600 hover:text-white transition-all shadow-sm mt-2"
                >
                  <i className="bi bi-x-circle-fill mr-2"></i>
                  Quitar Pago (Volver a Pendiente)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {pedidoActivoParaImprimir && (
        <div className="hidden print:block fixed inset-0 bg-white z-[10000]">
            <Ticket 
                orden={pedidoActivoParaImprimir.items} 
                total={pedidoActivoParaImprimir.total_pagado || pedidoActivoParaImprimir.total} 
                numeroPedido={pedidoActivoParaImprimir.numero_pedido} 
                tipoEntrega={pedidoActivoParaImprimir.tipo_entrega} 
                fecha={pedidoActivoParaImprimir.fechaString?.split('-').reverse().join('/')} 
                hora={pedidoActivoParaImprimir.hora_pedido} 
                cliente={pedidoActivoParaImprimir.nombre_cliente} 
                direccion={pedidoActivoParaImprimir.direccion}
                telefono={pedidoActivoParaImprimir.telefono}
                costoDespacho={pedidoActivoParaImprimir.costo_despacho}
                descripcion={pedidoActivoParaImprimir.descripcion} 
                notaPersonal={pedidoActivoParaImprimir.nota_personal || ''}
                descuento={pedidoActivoParaImprimir.descuento || 0}
                horaEntrega={pedidoActivoParaImprimir.hora_entrega} 
                estadoPago={pedidoActivoParaImprimir.estado_pago} 
                metodoPago={pedidoActivoParaImprimir.metodo_pago} 
                detallesPago={pedidoActivoParaImprimir.detalles_pago} 
            />
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @media print { 
            body * { visibility: hidden; } 
            .print\\:block, .print\\:block * { visibility: visible; } 
            .print\\:block { position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: white; z-index: 10000; } 
        }
        .scale-in { animation: scaleIn 0.2s ease-out; }
        @keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}