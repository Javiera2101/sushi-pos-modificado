import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  Timestamp,
  deleteDoc 
} from 'firebase/firestore';
import { db } from './firebase.js';
import { useUi } from './context/UiContext.jsx';
import Ticket from './Ticket.jsx'; 

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

// --- UTILIDAD DE FECHA LOCAL (CHILE) ---
const getLocalISODate = (dateInput) => {
  const d = dateInput ? (dateInput instanceof Date ? dateInput : (dateInput?.toDate ? dateInput.toDate() : new Date(dateInput))) : new Date();
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};

export default function HistorialPedidos({ onEditar, user }) {
  const { notificar } = useUi();
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('todos');
  
  // CORRECCIÓN: Inicializamos con la fecha local de Chile
  const [fechaFiltro, setFechaFiltro] = useState(getLocalISODate());
  
  const [pedidoParaCobrar, setPedidoParaCobrar] = useState(null);
  const [procesandoPago, setProcesandoPago] = useState(false);
  const [modoPago, setModoPago] = useState('unico'); 
  const [metodoUnico, setMetodoUnico] = useState('Efectivo');
  const [aplicarDescuento, setAplicarDescuento] = useState(false);
  
  const [montosMixtos, setMontosMixtos] = useState({ Efectivo: '', Tarjeta: '', Transferencia: '', Otro: '' });
  const [metodosHabilitados, setMetodosHabilitados] = useState({ Efectivo: true, Tarjeta: false, Transferencia: false, Otro: false });
  const [pedidoActivoParaImprimir, setPedidoActivoParaImprimir] = useState(null);

  const colOrdenes = user?.email === "prueba@isakari.com" ? "ordenes_pruebas" : "ordenes";
  const colMovimientos = user?.email === "prueba@isakari.com" ? "movimientos_pruebas" : "movimientos";

  const getRawNumber = (v) => Number(v.toString().replace(/\./g, '')) || 0;
  const formatPeso = (v) => (Number(v) || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
  const formatInput = (v) => v.toString().replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  useEffect(() => {
    if (!user) return;
    setCargando(true);
    
    const q = query(collection(db, colOrdenes), where("fechaString", "==", fechaFiltro));
    
    const unsubscribe = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          estado_pago: String(data.estado_pago || data.estadoPago || "Pendiente").trim(),
          metodo_pago: data.metodo_pago || data.medioPago || "N/A"
        };
      });
      docs.sort((a, b) => (b.numero_pedido || 0) - (a.numero_pedido || 0));
      setPedidos(docs);
      setCargando(false);
    }, (err) => {
      console.error("Error en historial:", err);
      setCargando(false);
    });
    return () => unsubscribe();
  }, [user, colOrdenes, fechaFiltro]);

  const ejecutarImpresionAutomatica = (pedido) => {
    notificar(`Imprimiendo ticket orden #${pedido.numero_pedido}...`, "success");
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

  const handleEliminarPedido = async (pedido) => {
    if (!window.confirm(`¿ESTÁS SEGURO? Eliminarás permanentemente el pedido #${pedido.numero_pedido} de ${pedido.nombre_cliente}.`)) return;
    try {
      await deleteDoc(doc(db, colOrdenes, pedido.id));
      notificar(`Pedido #${pedido.numero_pedido} eliminado`, "success");
    } catch (e) {
      console.error(e);
      notificar("Error al eliminar el pedido", "error");
    }
  };

  const handleAnularPago = () => {
    if (!pedidoParaCobrar) return;
    if (!window.confirm(`¿Quieres quitar el pago del pedido #${pedidoParaCobrar.numero_pedido}? Volverá a estar pendiente.`)) return;

    updateDoc(doc(db, colOrdenes, pedidoParaCobrar.id), {
      estado_pago: 'Pendiente',
      metodo_pago: 'N/A',
      detalles_pago: [],
      descuento: 0,
      total_pagado: 0,
      fecha_pago: null
    }).then(() => {
      addDoc(collection(db, colMovimientos), {
        tipo: 'egreso',
        categoria: 'ANULACION',
        monto: pedidoParaCobrar.total_pagado || pedidoParaCobrar.total,
        descripcion: `ANULACIÓN PAGO PEDIDO #${pedidoParaCobrar.numero_pedido}`,
        metodo: pedidoParaCobrar.metodo_pago || 'Otro',
        fecha: Timestamp.now(),
        usuario_id: user.uid,
        pedido_id: pedidoParaCobrar.id
      });
      setPedidoParaCobrar(null);
      setAplicarDescuento(false);
      notificar(`Pago anulado`, "success");
    });
  };

  const confirmarPago = () => {
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
    
    if (totalIngresado < totalACobrar) {
      notificar(`Faltan ${formatPeso(totalACobrar - totalIngresado)}`, "error");
      return;
    }

    setProcesandoPago(true);
    updateDoc(doc(db, colOrdenes, p.id), {
      estado_pago: 'Pagado',
      metodo_pago: modoPago === 'unico' ? metodoUnico : 'Mixto',
      detalles_pago: metodosFinales,
      descuento: montoDescuento,
      total_pagado: totalIngresado,
      fecha_pago: Timestamp.now()
    }).then(() => {
      metodosFinales.forEach(item => {
        addDoc(collection(db, colMovimientos), {
          tipo: 'ingreso',
          categoria: 'VENTA',
          monto: item.monto,
          descripcion: `VENTA PEDIDO #${p.numero_pedido}${aplicarDescuento ? ' (DESC 10%)' : ''}`,
          metodo: item.metodo,
          fecha: Timestamp.now(),
          usuario_id: user.uid,
          pedido_id: p.id
        });
      });
      notificar(`¡Pago registrado!`, "success");
      setPedidoParaCobrar(null);
      setAplicarDescuento(false);
      setProcesandoPago(false);
    });
  };

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-100 font-sans text-gray-800">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 m-0 leading-none">Ventas Registradas</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Isakari Sushi POS • Gestión de Historial</p>
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
        <div className="py-20 text-center font-black text-slate-300 animate-pulse uppercase tracking-widest text-xs">Cargando datos...</div>
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
                                    {item.observacion && <span className="text-[8px] text-amber-600 ml-10 italic lowercase">↳ {item.observacion}</span>}
                                </div>
                            </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-row md:flex-col items-center md:items-end gap-4 mt-4 md:mt-0 ml-0 md:ml-6 w-full md:w-auto">
                    <div className="text-left md:text-right flex-1 md:flex-initial">
                      <div className="text-2xl font-black text-slate-900">{formatPeso(pedido.total_pagado || pedido.total)}</div>
                      <div className={`text-[9px] font-black uppercase tracking-widest ${isPaid ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {isPaid ? `PAGADO (${pedido.metodo_pago})` : 'PAGO PENDIENTE'}
                        {pedido.descuento > 0 && <span className="ml-2 text-blue-500">-10% DESC.</span>}
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <button onClick={() => ejecutarImpresionAutomatica(pedido)} className="w-11 h-11 rounded-xl bg-slate-50 text-slate-400 hover:bg-slate-900 hover:text-white transition-all flex items-center justify-center shadow-sm" title="Imprimir"><i className="bi bi-printer"></i></button>
                      <button onClick={() => onEditar(pedido)} className="w-11 h-11 rounded-xl bg-slate-50 text-slate-400 hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center shadow-sm" title="Editar"><i className="bi bi-pencil"></i></button>
                      
                      <button onClick={() => handleEliminarPedido(pedido)} className="w-11 h-11 rounded-xl bg-red-50 text-red-500 hover:bg-red-600 hover:text-white transition-all flex items-center justify-center shadow-sm"><i className="bi bi-trash3-fill"></i></button>

                      <button 
                        onClick={async () => await updateDoc(doc(db, colOrdenes, pedido.id), { estado: isDelivered ? 'pendiente' : 'entregado' })} 
                        className={`px-4 h-11 rounded-xl text-[9px] font-black uppercase border-2 transition-all ${isDelivered ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-amber-600 border-amber-200'}`}
                      >
                        {isDelivered ? 'Listo' : 'Entregar'}
                      </button>

                      <button onClick={() => {
                        setPedidoParaCobrar(pedido);
                        setModoPago('unico');
                        setAplicarDescuento(false);
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
                <div className="grid grid-cols-2 gap-2 mb-8">
                    {['Efectivo', 'Tarjeta', 'Transferencia', 'Otro'].map(m => (
                        <button key={m} onClick={() => setMetodoUnico(m)} className={`py-4 rounded-2xl font-black text-[11px] border-2 uppercase transition-all ${metodoUnico === m ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-100 text-gray-400'}`}>{m}</button>
                    ))}
                </div>
            ) : (
                <div className="space-y-4 mb-8">
                    <div className="grid grid-cols-2 gap-3">
                        {['Efectivo', 'Tarjeta', 'Transferencia', 'Otro'].map(m => (
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
                                  className="w-full p-3 bg-slate-50 rounded-xl border-2 border-slate-100 outline-none text-right font-black text-xs focus:border-blue-400 disabled:opacity-30" 
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
              
              {String(pedidoParaCobrar.estado_pago).toLowerCase() === 'pagado' && (
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
            />
        </div>
      )}

      <style>{`
        @media print { 
            body * { visibility: hidden; } 
            .print\\:block, .print\\:block * { visibility: visible; } 
            .print\\:block { position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: white; } 
        }
      `}</style>
    </div>
  );
}