import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  Timestamp 
} from 'firebase/firestore';
// Se agregan extensiones explícitas para resolver errores de compilación en el entorno
import { db } from './firebase.js';
import { useUi } from './context/UiContext.jsx';
import Ticket from './Ticket.jsx'; 

// Detectar Electron para impresión directa
const ipcRenderer = (function() {
  try {
    if (typeof window !== 'undefined' && window.require) {
      const electron = window.require('electron');
      return electron ? electron.ipcRenderer : null;
    }
  } catch (e) { return null; }
  return null;
})();

export default function HistorialPedidos({ onEditar, user }) {
  const { notificar } = useUi();
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('todos');
  
  // Estado para filtrar por fecha (por defecto hoy)
  const [fechaFiltro, setFechaFiltro] = useState(new Date().toISOString().split('T')[0]);

  // Estados para procesos de Cobro
  const [pedidoParaCobrar, setPedidoParaCobrar] = useState(null);
  const [procesandoPago, setProcesandoPago] = useState(false);
  
  // Lógica de Pago Mixto y Autocompletado
  const [modoPago, setModoPago] = useState('unico'); 
  const [metodoUnico, setMetodoUnico] = useState('Efectivo');
  const [montosMixtos, setMontosMixtos] = useState({ Efectivo: '', Tarjeta: '', Transferencia: '', Otro: '' });
  const [metodosHabilitados, setMetodosHabilitados] = useState({ Efectivo: true, Tarjeta: false, Transferencia: false, Otro: false });

  const [pedidoActivoParaImprimir, setPedidoActivoParaImprimir] = useState(null);

  const colOrdenes = user?.email === "prueba@isakari.com" ? "ordenes_pruebas" : "ordenes";
  const colMovimientos = user?.email === "prueba@isakari.com" ? "movimientos_pruebas" : "movimientos";

  // Ayudantes de formato y cálculo
  const getRawNumber = (v) => Number(v.toString().replace(/\./g, '')) || 0;
  const formatPeso = (v) => (Number(v) || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });
  const formatInput = (v) => v.toString().replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  useEffect(() => {
    if (!user) return;
    setCargando(true);

    const q = query(collection(db, colOrdenes), where("fechaString", "==", fechaFiltro));
    
    const unsubscribe = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Ordenamos por número de pedido descendente localmente
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
            items: pedido.items,
            total: pedido.total,
            tipoEntrega: pedido.tipo_entrega,
            direccion: pedido.direccion,
            telefono: pedido.telefono,
            descripcion: pedido.descripcion
        });
    } else {
        setPedidoActivoParaImprimir(pedido);
        setTimeout(() => {
            window.print();
            setPedidoActivoParaImprimir(null);
        }, 500);
    }
  };

  // Lógica de Autocompletado: Al habilitar un método, sugiere el saldo pendiente
  const toggleMetodoMixto = (metodo) => {
    const nuevoEstado = !metodosHabilitados[metodo];
    const copiaHabilitados = { ...metodosHabilitados, [metodo]: nuevoEstado };
    setMetodosHabilitados(copiaHabilitados);

    if (nuevoEstado) {
      const sumaActual = Object.entries(montosMixtos)
        .filter(([m]) => metodosHabilitados[m] && m !== metodo)
        .reduce((acc, [_, v]) => acc + getRawNumber(v), 0);
      
      const faltante = Math.max(0, (pedidoParaCobrar?.total || 0) - sumaActual);
      setMontosMixtos(prev => ({ ...prev, [metodo]: formatInput(faltante) }));
    } else {
      setMontosMixtos(prev => ({ ...prev, [metodo]: '' }));
    }
  };

  const confirmarPago = async () => {
    if (!pedidoParaCobrar) return;
    const p = pedidoParaCobrar;
    setProcesandoPago(true);
    
    // Preparar detalles de pago
    const metodosFinales = modoPago === 'unico' 
      ? [{ metodo: metodoUnico, monto: p.total }]
      : Object.entries(montosMixtos)
          .filter(([m]) => metodosHabilitados[m] && getRawNumber(montosMixtos[m]) > 0)
          .map(([m, v]) => ({ metodo: m, monto: getRawNumber(v) }));

    const totalIngresado = metodosFinales.reduce((acc, item) => acc + item.monto, 0);

    if (totalIngresado < p.total) {
      notificar(`Faltan ${formatPeso(p.total - totalIngresado)} para completar el pago`, "error");
      setProcesandoPago(false);
      return;
    }

    try {
      await updateDoc(doc(db, colOrdenes, p.id), {
        estado_pago: 'Pagado',
        metodo_pago: modoPago === 'unico' ? metodoUnico : 'Mixto',
        detalles_pago: metodosFinales,
        fecha_pago: Timestamp.now()
      });

      const movPromises = metodosFinales.map(item => {
        return addDoc(collection(db, colMovimientos), {
          tipo: 'ingreso',
          categoria: 'VENTA',
          monto: item.monto,
          descripcion: `VENTA PEDIDO #${p.numero_pedido}`,
          metodo: item.metodo,
          fecha: Timestamp.now(),
          usuario_id: user.uid,
          pedido_id: p.id
        });
      });

      await Promise.all(movPromises);

      setPedidoParaCobrar(null);
      notificar(`¡Pedido #${p.numero_pedido} cobrado correctamente!`, "success");
      ejecutarImpresionAutomatica(p);

    } catch (e) {
      notificar("Error al registrar el cobro", "error");
    } finally {
      setProcesandoPago(false);
    }
  };

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-100 font-sans">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 m-0">Ventas Registradas</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Isakari Sushi POS • Gestión de Historial</p>
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
            .filter(p => {
              if (filtroEstado === 'todos') return true;
              return String(p.estado).toLowerCase() === filtroEstado.toLowerCase();
            })
            .map(pedido => {
              const isPaid = pedido.estado_pago === 'Pagado';
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
                      <p className="text-[10px] text-slate-500 font-bold uppercase m-0 mt-1">{pedido.tipo_entrega} • {pedido.hora_pedido} • {pedido.fechaString}</p>
                      
                      <div className="mt-3 space-y-1 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        {pedido.items?.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center text-[10px] font-black uppercase text-slate-600">
                                <div className="flex gap-2 items-center">
                                    <span className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-900 w-8 text-center">{item.cantidad}x</span>
                                    <span>{item.nombre}</span>
                                </div>
                            </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-row md:flex-col items-center md:items-end gap-4 mt-4 md:mt-0 ml-0 md:ml-6 w-full md:w-auto">
                    <div className="text-left md:text-right flex-1 md:flex-initial">
                      <div className="text-2xl font-black text-slate-900">{formatPeso(pedido.total)}</div>
                      <div className={`text-[9px] font-black uppercase tracking-widest ${isPaid ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {isPaid ? `PAGADO (${pedido.metodo_pago})` : 'PAGO PENDIENTE'}
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <button onClick={() => ejecutarImpresionAutomatica(pedido)} className="w-11 h-11 rounded-xl bg-slate-50 text-slate-400 hover:bg-slate-900 hover:text-white transition-all flex items-center justify-center shadow-sm" title="Imprimir"><i className="bi bi-printer"></i></button>
                      <button onClick={() => onEditar(pedido)} className="w-11 h-11 rounded-xl bg-slate-50 text-slate-400 hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center shadow-sm" title="Editar"><i className="bi bi-pencil"></i></button>
                      <button 
                        onClick={async () => await updateDoc(doc(db, colOrdenes, pedido.id), { estado: isDelivered ? 'pendiente' : 'entregado' })} 
                        className={`px-4 h-11 rounded-xl text-[9px] font-black uppercase border-2 transition-all ${isDelivered ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-amber-600 border-amber-200'}`}
                      >
                        {isDelivered ? 'Listo' : 'Pend.'}
                      </button>
                      {!isPaid && (
                        <button onClick={() => {
                          setPedidoParaCobrar(pedido);
                          setModoPago('unico');
                        }} className="px-5 h-11 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase shadow-lg active:scale-95 transition-all">Cobrar</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          {pedidos.length === 0 && (
            <div className="py-20 text-center flex flex-col items-center gap-3 opacity-20">
                <i className="bi bi-search text-5xl"></i>
                <span className="font-black uppercase text-xs tracking-[0.2em]">Sin registros para esta fecha</span>
            </div>
          )}
        </div>
      )}

      {/* MODAL DE PAGO */}
      {pedidoParaCobrar && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[3rem] shadow-2xl p-10 w-full max-w-md border border-white scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-8">
              <h3 className="font-black uppercase text-lg text-slate-900 m-0 tracking-tighter">Cobrar #{pedidoParaCobrar.numero_pedido}</h3>
              <button 
                onClick={() => setModoPago(modoPago === 'unico' ? 'mixto' : 'unico')} 
                className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase transition-all ${modoPago === 'mixto' ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}
              >
                {modoPago === 'mixto' ? 'Modo Mixto Activo' : 'Activar Pago Mixto'}
              </button>
            </div>

            <div className="bg-slate-50 p-6 rounded-[2rem] mb-8 border-2 border-slate-100 text-center">
                <span className="text-4xl font-black text-slate-900 tracking-tighter">{formatPeso(pedidoParaCobrar.total)}</span>
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

            <div className="flex gap-3">
              <button onClick={() => setPedidoParaCobrar(null)} className="flex-1 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Cancelar</button>
              <button onClick={confirmarPago} disabled={procesandoPago} className="flex-[2] py-4 bg-green-600 text-white rounded-2xl text-[10px] font-black uppercase shadow-xl active:scale-95 flex items-center justify-center gap-2">
                {procesandoPago ? 'Procesando...' : 'Finalizar Venta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ÁREA DE IMPRESIÓN INVISIBLE */}
      {pedidoActivoParaImprimir && (
        <div className="hidden print:block fixed inset-0 bg-white z-[10000]">
            <Ticket 
                orden={pedidoActivoParaImprimir.items} 
                total={pedidoActivoParaImprimir.total} 
                numeroPedido={pedidoActivoParaImprimir.numero_pedido} 
                tipoEntrega={pedidoActivoParaImprimir.tipo_entrega} 
                fecha={pedidoActivoParaImprimir.fechaString} 
                hora={pedidoActivoParaImprimir.hora_pedido} 
                cliente={pedidoActivoParaImprimir.nombre_cliente} 
                descripcion={pedidoActivoParaImprimir.descripcion} 
            />
        </div>
      )}

      <style>{`.scale-in { animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1); } @keyframes scaleIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } } @media print { body * { visibility: hidden; } .print\\:block, .print\\:block * { visibility: visible; } .print\\:block { position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: white; } }`}</style>
    </div>
  );
}