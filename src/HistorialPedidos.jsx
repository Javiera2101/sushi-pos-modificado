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
  deleteDoc,
  getDocs,
  enableIndexedDbPersistence,
  addDoc
} from 'firebase/firestore';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';

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

// --- COMPONENTE TICKET ---
const Ticket = ({ orden, total, numeroPedido, tipoEntrega, fecha, hora, cliente, direccion, telefono, descripcion, notaPersonal, costoDespacho, horaEntrega, estadoPago, metodoPago, detallesPago, descuento }) => {
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
                    {orden?.map((item, idx) => {
                        const nombreLimpio = String(item.nombre || '').toUpperCase();
                        const esProductoLargo = nombreLimpio.includes("MIXTO") || nombreLimpio.includes("PREMIUM");

                        return (
                            <tr key={idx} className="align-top border-b border-gray-50 last:border-0">
                                <td className="pr-1 font-bold">{item.cantidad}x</td>
                                <td className="w-full uppercase">
                                    <div className="font-bold">{item.nombre}</div>
                                    
                                    {(!esProductoLargo && item.descripcion) && (
                                        <div className="text-[8px] text-gray-500 leading-tight mt-0.5 whitespace-pre-wrap">{item.descripcion}</div>
                                    )}
                                    
                                    {item.observacion && <div className="text-[8px] italic lowercase mt-0.5 text-gray-600 whitespace-pre-wrap">↳ {item.observacion}</div>}
                                </td>
                                <td className="text-right whitespace-nowrap pl-1">
                                    ${((Number(item.precio) || 0) * (Number(item.cantidad) || 0)).toLocaleString('es-CL')}
                                </td>
                            </tr>
                        );
                    })}
                    {tipoEntrega === 'REPARTO' && Number(costoDespacho) > 0 && (
                        <tr className="border-t border-dashed">
                            <td colSpan="2" className="pt-1 uppercase">Envío:</td>
                            <td className="text-right pt-1">${Number(costoDespacho).toLocaleString('es-CL')}</td>
                        </tr>
                    )}
                </tbody>
            </table>
            
            <div className="border-t border-dashed border-gray-400 mt-2 pt-2 text-sm">
                {Number(descuento) > 0 ? (
                    <div className="flex flex-col gap-1">
                        <div className="flex justify-between font-bold text-[11px] opacity-75">
                            <span>SUBTOTAL:</span>
                            <span>${(Number(total) || 0).toLocaleString('es-CL')}</span>
                        </div>
                        <div className="flex justify-between font-black text-[11px] text-red-600 uppercase border border-red-200 bg-red-50 px-1 py-0.5 rounded">
                            <span>DCTO 10% (PROD):</span>
                            <span>-${Number(descuento).toLocaleString('es-CL')}</span>
                        </div>
                        <div className="flex justify-between font-black text-sm mt-1 border-t border-dashed pt-1">
                            <span>TOTAL FINAL:</span>
                            <span>${((Number(total) || 0) - Number(descuento)).toLocaleString('es-CL')}</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex justify-between font-black text-sm">
                        <span>TOTAL:</span>
                        <span>${(Number(total) || 0).toLocaleString('es-CL')}</span>
                    </div>
                )}
            </div>

            {(descripcion || (tipoEntrega === 'REPARTO' && notaPersonal)) && (
                <div className="mt-3 border-t border-dashed pt-1 space-y-1">
                    {tipoEntrega === 'REPARTO' && notaPersonal && <div className="uppercase font-bold text-[9px] bg-gray-50 p-1 whitespace-pre-wrap">Nota: {notaPersonal}</div>}
                    {descripcion && <div className="italic text-[8px] uppercase opacity-75 whitespace-pre-wrap">Obs Cocina: {descripcion}</div>}
                </div>
            )}

            <div className={`uppercase mt-3 border p-1 text-center font-bold ${estiloPago}`}>
                {textoPago}
            </div>

            <div className="text-center mt-2 opacity-50 uppercase text-[8px]">Sistema POS Local - Chile</div>
        </div>
    );
};

export default function HistorialPedidos({ onEditar, user: propUser }) {
  const [user, setUser] = useState(propUser || null);
  const [notificacion, setNotificacion] = useState({ mostrar: false, mensaje: '', tipo: '' });
  
  const notificar = (mensaje, tipo = 'success') => {
    setNotificacion({ mostrar: true, mensaje, tipo });
    setTimeout(() => setNotificacion({ mostrar: false, mensaje: '', tipo: '' }), 3000);
  };

  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [fechaFiltro, setFechaFiltro] = useState(getLocalISODate());
  const [busqueda, setBusqueda] = useState(''); 
  
  const [pedidoParaCobrar, setPedidoParaCobrar] = useState(null);
  const [pedidoParaEliminar, setPedidoParaEliminar] = useState(null); 
  const [procesandoPago, setProcesandoPago] = useState(false);
  const [modoPago, setModoPago] = useState('unico'); 
  const [metodoUnico, setMetodoUnico] = useState(''); 
  const [aplicarDescuento, setAplicarDescuento] = useState(false);
  
  const [montosMixtos, setMontosMixtos] = useState({ Efectivo: '', Transferencia: '', Débito: '' });
  const [metodosHabilitados, setMetodosHabilitados] = useState({ Efectivo: true, Transferencia: false, Débito: false });
  const [pedidoActivoParaImprimir, setPedidoActivoParaImprimir] = useState(null);

  // --- CORRECCIÓN DE RUTAS A RAÍZ ---
  const colOrdenes = user?.email === "prueba@isakari.com" ? "ordenes_pruebas" : "ordenes";
  const colMovimientos = user?.email === "prueba@isakari.com" ? "movimientos_pruebas" : "movimientos";

  // BLINDAJE CONTRA UNDEFINED EN CÁLCULOS
  const getRawNumber = (v) => Number(String(v || '').replace(/\./g, '')) || 0;
  const formatPeso = (v) => (Number(v) || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
  const formatInput = (v) => String(v || '').replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  // Asegurarnos de que el usuario se mantenga sincronizado
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // OPTIMIZACIÓN DE LECTURAS
  useEffect(() => {
    if (!user) return;
    setCargando(true);
    
    const hoy = getLocalISODate();
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
            total: pedido.total, 
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
    
    const totalOriginal = Number(pedidoParaCobrar?.total) || 0;
    const subtotalProductos = (pedidoParaCobrar?.items || []).reduce((acc, item) => acc + ((Number(item.precio) || 0) * (Number(item.cantidad) || 0)), 0);
    const desc = aplicarDescuento ? Math.round(subtotalProductos * 0.1) : 0;
    const totalObjetivo = totalOriginal - desc;

    if (nuevoEstado) {
      const sumaActual = Object.entries(montosMixtos)
        .filter(([m]) => metodosHabilitados[m] && m !== metodo)
        .reduce((acc, [m, v]) => acc + getRawNumber(v), 0);
      const faltante = Math.max(0, totalObjetivo - sumaActual);
      setMontosMixtos(prev => ({ ...prev, [metodo]: formatInput(faltante) }));
    } else {
      setMontosMixtos(prev => ({ ...prev, [metodo]: '' }));
    }
  };

  const confirmarPago = async () => {
    if (!pedidoParaCobrar) return;
    const p = pedidoParaCobrar;
    const wasPaid = String(p.estado_pago).toLowerCase() === 'pagado';
    setProcesandoPago(true); 
    
    try {
        const subtotalProductos = (p.items || []).reduce((acc, item) => acc + ((Number(item.precio) || 0) * (Number(item.cantidad) || 0)), 0);
        const montoDescuento = aplicarDescuento ? Math.round(subtotalProductos * 0.1) : 0;
        const totalACobrar = Math.max(0, (Number(p.total) || 0) - montoDescuento);

        let metodosFinales = [];
        let metodoGeneral = '';

        if (modoPago === 'unico') {
            if (!metodoUnico) {
                await updateDoc(doc(db, colOrdenes, String(p.id)), {
                    descuento: Number(montoDescuento) || 0
                });
                notificar("OPCIONES GUARDADAS. EL PEDIDO SIGUE PENDIENTE.", "success");
                setPedidoParaCobrar(null);
                setAplicarDescuento(false);
                setProcesandoPago(false);
                return;
            }
            metodosFinales = [{ metodo: String(metodoUnico), monto: totalACobrar }];
            metodoGeneral = String(metodoUnico);
        } else {
            metodosFinales = Object.entries(montosMixtos)
                .filter(([m]) => metodosHabilitados[m] && getRawNumber(montosMixtos[m]) > 0)
                .map(([m, v]) => ({ metodo: String(m), monto: getRawNumber(v) || 0 }));
            
            if (metodosFinales.length === 0) {
                await updateDoc(doc(db, colOrdenes, String(p.id)), {
                    descuento: Number(montoDescuento) || 0
                });
                notificar("OPCIONES GUARDADAS. EL PEDIDO SIGUE PENDIENTE.", "success");
                setPedidoParaCobrar(null);
                setAplicarDescuento(false);
                setProcesandoPago(false);
                return;
            }
            metodoGeneral = 'Mixto';
        }
        
        const totalIngresado = metodosFinales.reduce((acc, item) => acc + item.monto, 0);
        
        if (totalIngresado < totalACobrar && modoPago === 'mixto') {
          notificar(`FALTAN ${formatPeso(totalACobrar - totalIngresado)}`, "error");
          setProcesandoPago(false);
          return;
        }

        const datosPago = {
          estado_pago: 'Pagado',
          metodo_pago: metodoGeneral,
          detalles_pago: metodosFinales,
          descuento: Number(montoDescuento) || 0,
          total_pagado: Number(totalIngresado) || 0,
          fecha_pago: Timestamp.now()
        };

        const pedidoRef = doc(db, colOrdenes, String(p.id));
        await updateDoc(pedidoRef, datosPago);

        if (wasPaid) {
            await addDoc(collection(db, colMovimientos), {
                tipo: 'egreso',
                categoria: 'ANULACION',
                monto: Number(p.total_pagado) || Number(p.total) || 0,
                descripcion: `REEMPLAZO PAGO PEDIDO #${p.numero_pedido || 'S/N'}`,
                metodo: String(p.metodo_pago || 'Otro'),
                fecha: Timestamp.now(),
                usuario_id: user?.uid || 'anonimo',
                pedido_id: String(p.id || '')
            });
        }

        const movRef = collection(db, colMovimientos);
        for (const item of metodosFinales) {
            await addDoc(movRef, {
                tipo: 'ingreso',
                categoria: 'VENTA',
                monto: Number(item.monto) || 0, 
                descripcion: `VENTA PEDIDO #${p.numero_pedido || 'S/N'}${aplicarDescuento ? ' (DESC 10%)' : ''}`,
                metodo: String(item.metodo),
                fecha: Timestamp.now(),
                usuario_id: user?.uid || 'anonimo', 
                pedido_id: String(p.id || '')
            });
        }

        notificar(`PAGO REGISTRADO CORRECTAMENTE`, "success");
        setPedidoParaCobrar(null);
        setAplicarDescuento(false);

    } catch (err) {
        console.error("Error sincronización pago:", err);
        notificar("ERROR AL REGISTRAR PAGO", "error");
    } finally {
        setProcesandoPago(false);
    }
  };

  const handleAnularPago = async () => {
    if (!pedidoParaCobrar) return;
    if (!window.confirm(`¿Quieres quitar el pago del pedido #${pedidoParaCobrar.numero_pedido}?`)) return;

    const p = pedidoParaCobrar;
    setProcesandoPago(true); 
    
    try {
        await updateDoc(doc(db, colOrdenes, String(p.id)), {
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
            monto: Number(p.total_pagado) || Number(p.total) || 0,
            descripcion: `ANULACIÓN PAGO PEDIDO #${p.numero_pedido || 'S/N'}`,
            metodo: String(p.metodo_pago || 'Otro'),
            fecha: Timestamp.now(),
            usuario_id: user?.uid || 'anonimo',
            pedido_id: String(p.id || '')
        });

        setPedidoParaCobrar(null);
        setAplicarDescuento(false);
        notificar(`PAGO ANULADO CORRECTAMENTE`, "success");
    } catch (e) {
        console.error("Error al anular pago:", e);
        notificar("ERROR AL ANULAR PAGO", "error");
    } finally {
        setProcesandoPago(false); 
    }
  };

  // --- NUEVA LÓGICA DE ENTREGA (CON BLOQUEO SI NO ESTÁ PAGADO) ---
  const toggleEstado = async (pedido) => {
    const isPaid = String(pedido.estado_pago || '').toLowerCase().trim() === 'pagado';
    const isDelivered = String(pedido.estado || '').toLowerCase().trim() === 'entregado';
    const nuevoEstado = isDelivered ? 'pendiente' : 'entregado';

    // CANDADO DE SEGURIDAD 1: Validación lógica
    if (nuevoEstado === 'entregado' && !isPaid) {
        notificar("NO SE PUEDE ENTREGAR: EL PEDIDO AÚN NO HA SIDO COBRADO", "error");
        return;
    }

    try {
      await updateDoc(doc(db, colOrdenes, String(pedido.id)), { estado: nuevoEstado });
      const msg = nuevoEstado === 'entregado' 
        ? `PEDIDO #${pedido.numero_pedido} ENTREGADO CORRECTAMENTE` 
        : `PEDIDO #${pedido.numero_pedido} DEVUELTO A PENDIENTE CORRECTAMENTE`;
      notificar(msg, "success");
    } catch (e) {
      console.error(e);
      notificar("ERROR AL ACTUALIZAR ESTADO", "error");
    }
  };

  const subtotalProductosModal = (pedidoParaCobrar?.items || []).reduce((acc, item) => acc + ((Number(item.precio) || 0) * (Number(item.cantidad) || 0)), 0);
  const descuentoUI = aplicarDescuento ? Math.round(subtotalProductosModal * 0.1) : 0;
  
  const isMetodoSeleccionado = modoPago === 'unico' 
    ? metodoUnico !== '' 
    : Object.values(montosMixtos).some(v => getRawNumber(v) > 0);

  const pedidosFiltrados = pedidos
    .filter(p => filtroEstado === 'todos' || String(p.estado).toLowerCase() === filtroEstado.toLowerCase())
    .filter(p => {
        if (!busqueda) return true;
        const searchLower = busqueda.toLowerCase();
        
        const matchNombre = String(p.nombre_cliente || '').toLowerCase().includes(searchLower);
        const matchNumero = String(p.numero_pedido || '').includes(searchLower);
        
        const matchItems = p.items && p.items.some(item => 
            String(item.nombre || '').toLowerCase().includes(searchLower) ||
            String(item.observacion || '').toLowerCase().includes(searchLower) ||
            String(item.descripcion || '').toLowerCase().includes(searchLower)
        );

        const matchNotas = String(p.descripcion || '').toLowerCase().includes(searchLower) || 
                           String(p.nota_personal || '').toLowerCase().includes(searchLower) ||
                           String(p.direccion || '').toLowerCase().includes(searchLower);

        return matchNombre || matchNumero || matchItems || matchNotas;
    });

  return (
    <div className="p-6 h-full overflow-y-auto bg-slate-100 font-sans text-gray-800 relative">
      
      {notificacion.mostrar && (
        <div className={`fixed bottom-4 right-4 z-[100000] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 transition-all duration-500 ${notificacion.tipo === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`} style={{ animation: 'slideIn 0.3s ease-out forwards' }}>
            <span className="text-2xl">{notificacion.tipo === 'error' ? '🚫' : '✅'}</span>
            <div>
                <h4 className="font-black uppercase text-xs opacity-75">{notificacion.tipo === 'error' ? 'Error' : 'Atención'}</h4>
                <p className="font-bold text-sm leading-tight">{notificacion.mensaje}</p>
            </div>
        </div>
      )}

      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter text-slate-900 m-0 leading-none">Ventas Registradas</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Gestión Histórica • {pedidos.length} Pedidos</p>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap items-center gap-3 w-full xl:w-auto">
          <div className="relative group w-full sm:w-auto flex-1 md:min-w-[320px]">
            <i className="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-red-500 transition-colors text-sm"></i>
            <input 
                type="text" 
                placeholder="BUSCAR CLIENTE, N° ORDEN O PRODUCTO..." 
                className="w-full pl-10 pr-10 py-3 rounded-3xl border-2 border-slate-100 bg-white font-black uppercase text-[10px] outline-none focus:border-red-300 focus:shadow-md transition-all placeholder:text-slate-300 shadow-sm"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
            />
            {busqueda && (
                <button onClick={() => setBusqueda('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-500 transition-colors text-lg leading-none">
                    <i className="bi bi-x-circle-fill"></i>
                </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-3xl shadow-sm border border-slate-200 w-full sm:w-auto">
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
      </div>

      {cargando ? (
        <div className="py-20 text-center font-black text-slate-300 animate-pulse uppercase tracking-widest text-xs">Cargando datos del servidor...</div>
      ) : (
        <div className="grid gap-4 pb-32">
          {pedidosFiltrados.map(pedido => {
              const isPaid = String(pedido.estado_pago || '').toLowerCase().trim() === 'pagado';
              const isDelivered = String(pedido.estado || '').toLowerCase().trim() === 'entregado';
              
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
                        {pedido.tipo_entrega} • Pedido: {pedido.hora_pedido} {pedido.hora_entrega && `• Entrega: ${pedido.hora_entrega}`} • {pedido.fechaString?.split('-').reverse().join('/')}
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
                                    {item.observacion && <span className="text-[8px] text-blue-600 ml-10 italic lowercase whitespace-pre-wrap">↳ {item.observacion}</span>}
                                </div>
                            </div>
                        ))}
                      </div>

                      {pedido.descripcion && (
                        <div className="mt-2 p-2.5 bg-amber-50 border border-amber-100 rounded-xl max-w-md">
                            <span className="text-[8px] font-black text-amber-600 uppercase tracking-widest block mb-0.5">Observaciones de Cocina:</span>
                            <p className="text-[10px] font-bold text-slate-700 m-0 uppercase leading-tight italic whitespace-pre-wrap">{pedido.descripcion}</p>
                        </div>
                      )}

                      {pedido.tipo_entrega === 'REPARTO' && (
                          <div className="mt-2 p-2.5 bg-blue-50 border border-blue-100 rounded-xl max-w-md">
                            <span className="text-[8px] font-black text-blue-600 uppercase tracking-widest block mb-1">Datos de Reparto:</span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[10px] text-slate-700 uppercase font-bold">
                                {pedido.direccion && <div><span className="text-blue-500">Dir:</span> {pedido.direccion}</div>}
                                {pedido.telefono && <div><span className="text-blue-500">Tel:</span> {pedido.telefono}</div>}
                                {Number(pedido.costo_despacho) > 0 && <div><span className="text-blue-500">Envío:</span> {formatPeso(pedido.costo_despacho)}</div>}
                            </div>
                            {pedido.nota_personal && (
                                <div className="mt-1 pt-1 border-t border-blue-100/50">
                                    <span className="text-[8px] font-black text-blue-600 uppercase tracking-widest block mb-0.5">Nota:</span>
                                    <p className="text-[10px] font-bold text-slate-700 m-0 uppercase leading-tight italic whitespace-pre-wrap">{pedido.nota_personal}</p>
                                </div>
                            )}
                          </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-row md:flex-col items-center md:items-end gap-4 mt-4 md:mt-0 ml-0 md:ml-6 w-full md:w-auto">
                    <div className="flex flex-col items-start md:items-end flex-1 md:flex-initial">
                      <div className="flex flex-col w-full md:w-36 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 border-b border-slate-100 pb-1">
                        <div className="flex justify-between gap-2">
                          <span>Prod:</span>
                          <span className="text-slate-600">{formatPeso((Number(pedido.total) || 0) - (Number(pedido.costo_despacho) || 0))}</span>
                        </div>
                        {Number(pedido.costo_despacho) > 0 && (
                          <div className="flex justify-between gap-2">
                            <span>Envío:</span>
                            <span className="text-slate-600">+{formatPeso(pedido.costo_despacho)}</span>
                          </div>
                        )}
                        {Number(pedido.descuento) > 0 && (
                          <div className="flex justify-between gap-2 text-blue-500">
                            <span>Dcto:</span>
                            <span>-{formatPeso(pedido.descuento)}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-2xl font-black text-slate-900 leading-none mt-1">
                        {formatPeso((Number(pedido.total) || 0) - (Number(pedido.descuento) || 0))}
                      </div>
                      <div className={`text-[9px] font-black uppercase tracking-widest mt-1 ${isPaid ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {isPaid ? `PAGADO (${pedido.metodo_pago})` : 'PAGO PENDIENTE'}
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

                      {/* CANDADO DE SEGURIDAD 2: El botón detiene la acción antes de enviarla si no está pagado */}
                      <button 
                        onClick={() => {
                            const pagado = String(pedido.estado_pago || '').toLowerCase().trim() === 'pagado';
                            const entregado = String(pedido.estado || '').toLowerCase().trim() === 'entregado';
                            if (!entregado && !pagado) {
                                notificar("NO SE PUEDE ENTREGAR: EL PEDIDO AÚN NO HA SIDO COBRADO", "error");
                                return;
                            }
                            toggleEstado(pedido);
                        }} 
                        className={`px-4 h-11 rounded-xl text-[9px] font-black uppercase border-2 transition-all ${isDelivered ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-amber-600 border-amber-200'} ${!isPaid && !isDelivered ? 'opacity-50' : 'hover:shadow-md'}`}
                        title={!isPaid && !isDelivered ? 'Debe cobrar el pedido primero' : ''}
                      >
                        {isDelivered ? 'Listo' : 'Entregar'}
                      </button>

                      <button onClick={() => {
                        setPedidoParaCobrar(pedido);
                        if (!isPaid) {
                            setModoPago('unico');
                            setMetodoUnico(''); 
                            setAplicarDescuento((pedido.descuento || 0) > 0); 
                            setMontosMixtos({ Efectivo: '', Transferencia: '', Débito: '' });
                            setMetodosHabilitados({ Efectivo: true, Transferencia: false, Débito: false });
                        } else {
                            setModoPago(pedido.metodo_pago === 'Mixto' ? 'mixto' : 'unico');
                            setMetodoUnico(pedido.metodo_pago !== 'Mixto' ? pedido.metodo_pago : '');
                            setAplicarDescuento((pedido.descuento || 0) > 0);
                        }
                      }} className={`px-5 h-11 rounded-xl text-[10px] font-black uppercase shadow-lg active:scale-95 transition-all ${isPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-900 text-white'}`}>
                        {isPaid ? 'Pago' : 'Cobrar'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {pedidosFiltrados.length === 0 && (
                <div className="col-span-full py-20 text-center text-slate-300 font-black uppercase text-xs tracking-[0.3em]">
                    No se encontraron pedidos
                </div>
            )}
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
                            {formatPeso((Number(pedidoParaCobrar?.total) || 0) - descuentoUI)}
                        </span>
                        {aplicarDescuento && (
                            <span className="text-[10px] font-black text-red-500 uppercase mt-1 line-through opacity-50">
                                Original: {formatPeso(pedidoParaCobrar?.total || 0)}
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
                        <button 
                            key={m} 
                            onClick={() => setMetodoUnico(metodoUnico === m ? '' : m)} 
                            className={`py-4 rounded-2xl font-black text-[10px] border-2 uppercase transition-all ${metodoUnico === m ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-100 text-gray-400'}`}
                        >
                            {m}
                        </button>
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
                <button onClick={() => { setPedidoParaCobrar(null); setAplicarDescuento(false); }} className="flex-1 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:bg-slate-50 rounded-2xl">Cancelar</button>
                <button onClick={confirmarPago} disabled={procesandoPago} className="flex-[2] py-4 bg-green-600 text-white rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-green-700 active:scale-95 transition-all">
                  {isMetodoSeleccionado ? 'Confirmar Cobro' : 'Guardar y Dejar Pendiente'}
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

      {/* ELEMENTO DE IMPRESIÓN WEB */}
      {pedidoActivoParaImprimir && (
        <div className="hidden print:block fixed inset-0 bg-white z-[10000]">
            <Ticket 
                orden={pedidoActivoParaImprimir.items} 
                total={pedidoActivoParaImprimir.total} 
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