import React, { useState, useEffect, useRef } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
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

const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { 
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "", 
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "", 
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "", 
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "", 
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "", 
      appId: import.meta.env.VITE_FIREBASE_APP_ID || "" 
    };

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);

try {
    if (typeof window !== 'undefined') {
        enableIndexedDbPersistence(db).catch(() => {});
    }
} catch (e) {}

const ipcRenderer = (function() {
  try {
    if (typeof window !== 'undefined' && window.require) {
      const electron = window.require('electron');
      return electron ? electron.ipcRenderer : null;
    }
  } catch (e) { return null; }
  return null;
})();

const getLocalISODate = () => {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
};

const getCurrentTimeForInput = () => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
};

const Ticket = ({ orden, total, numeroPedido, tipoEntrega, fecha, hora, cliente, direccion, telefono, descripcion, notaPersonal, costoDespacho, horaEntrega, estadoPago, metodoPago, detallesPago }) => {
    const fechaChile = fecha && fecha.includes('-') ? fecha.split('-').reverse().join('/') : fecha;
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
            <div className={`uppercase mt-3 border p-1 text-center font-bold ${estiloPago}`}>{textoPago}</div>
            <div className="text-center mt-2 opacity-50 uppercase text-[8px]">Sistema POS Local - Chile</div>
        </div>
    );
};

export default function TomarPedido({ ordenAEditar, onTerminarEdicion, user: propUser, cajaAbiertaGlobal }) {
  const [notificacion, setNotificacion] = useState({ mostrar: false, mensaje: '', tipo: '' });

  const notificar = (mensaje, tipo = 'success') => {
    setNotificacion({ mostrar: true, mensaje, tipo });
    setTimeout(() => { setNotificacion({ mostrar: false, mensaje: '', tipo: '' }); }, 4000);
  };

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
  
  const [horaEntrega, setHoraEntrega] = useState(getCurrentTimeForInput());
  const [mostrarModalPago, setMostrarModalPago] = useState(false);
  const [pagoTemporal, setPagoTemporal] = useState(null); 
  
  const [modoPago, setModoPago] = useState('unico'); 
  const [metodoUnico, setMetodoUnico] = useState('Efectivo');
  const [aplicarDescuento, setAplicarDescuento] = useState(false);
  const [montosMixtos, setMontosMixtos] = useState({ Efectivo: '', Transferencia: '', Débito: '' });
  const [metodosHabilitados, setMetodosHabilitados] = useState({ Efectivo: true, Transferencia: false, Débito: false });
  
  const [categoriaActual, setCategoriaActual] = useState(null);
  const [cargando, setCargando] = useState(true); 
  const [mostrarVistaPrevia, setMostrarVistaPrevia] = useState(false);
  const [ultimoPedidoParaImprimir, setUltimoPedidoParaImprimir] = useState(null); 
  
  const cajaAbierta = cajaAbiertaGlobal !== undefined ? cajaAbiertaGlobal : true;

  const esPrueba = user?.email === "prueba@isakari.com";
  const COL_ORDENES = esPrueba ? "ordenes_pruebas" : "ordenes";
  const COL_MENU = "menu";
  const COL_MOVIMIENTOS = esPrueba ? "movimientos_pruebas" : "movimientos";
  
  const inputStyle = "w-full p-4 rounded-2xl border-2 border-gray-100 bg-white focus:ring-2 focus:ring-red-100 outline-none text-sm font-black uppercase transition-all shadow-sm placeholder:text-gray-300";

  const getRawNumber = (v) => Number(v.toString().replace(/\./g, '')) || 0;
  const formatPeso = (v) => (Number(v) || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
  const formatInput = (v) => v.toString().replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  // --- FUNCIÓN LIMPIADORA CENTRALIZADA ---
  const limpiarFormulario = () => {
    setOrden([]);
    setNombreCliente('');
    setTipoEntrega('LOCAL');
    setDireccion('');
    setTelefono('');
    setNotaPersonal('');
    setCostoDespacho('');
    setDescripcionGeneral('');
    setHoraEntrega(getCurrentTimeForInput());
    setPagoTemporal(null);
  };

  useEffect(() => {
    if (!user) return;
    const colRef = collection(db, COL_MENU);
    const unsubscribe = onSnapshot(colRef, (snap) => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setMenu(items.sort((a,b) => (a.nombre || '').localeCompare(b.nombre || '')));
        setCargando(false);
    }, (error) => {
        console.error("Error Menu:", error);
        setCargando(false);
    });
    return () => unsubscribe();
  }, [user, COL_MENU]);

  useEffect(() => {
    if (!user || ordenAEditar) return;
    const hoy = getLocalISODate();
    const colRef = collection(db, COL_ORDENES);
    const q = query(colRef, where("fechaString", "==", hoy));
    
    const unsubscribe = onSnapshot(q, (snap) => {
        if (!snap.empty) {
            const numeros = snap.docs.map(d => Number(d.data().numero_pedido) || 0);
            setNumeroPedidoVisual(Math.max(...numeros) + 1);
        } else {
            setNumeroPedidoVisual(1);
        }
        if (!ordenAEditar) setHoraPedido(new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }));
    }, (err) => console.error("Error contador:", err));
    return () => unsubscribe();
  }, [user, ordenAEditar, COL_ORDENES]);

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
      setHoraEntrega(ordenAEditar.hora_entrega || getCurrentTimeForInput());
      setPagoTemporal(null); 
    } else {
      // SI ORDEN A EDITAR ES NULO, LIMPIAMOS COMPLETAMENTE LA MEMORIA LOCAL
      limpiarFormulario();
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
            horaEntrega: datos.hora_entrega,
            estadoPago: datos.estado_pago,
            metodoPago: datos.metodo_pago,
            descuento: datos.descuento || 0,
            detallesPago: datos.detalles_pago
        });
    } else {
        setUltimoPedidoParaImprimir(datos);
        setTimeout(() => {
            window.print();
            setUltimoPedidoParaImprimir(null);
        }, 800);
    }
  };

  const toggleMetodoMixto = (metodo) => {
    const nuevoEstado = !metodosHabilitados[metodo];
    setMetodosHabilitados(prev => ({ ...prev, [metodo]: nuevoEstado }));
    const totalOriginal = totalFinal;
    const desc = aplicarDescuento ? Math.round(totalOriginal * 0.1) : 0;
    const totalObjetivo = totalOriginal - desc;
    if (nuevoEstado) {
      const sumaActual = Object.entries(montosMixtos).filter(([m]) => metodosHabilitados[m] && m !== metodo).reduce((acc, [_, v]) => acc + getRawNumber(v), 0);
      const faltante = Math.max(0, totalObjetivo - sumaActual);
      setMontosMixtos(prev => ({ ...prev, [metodo]: formatInput(faltante) }));
    } else {
      setMontosMixtos(prev => ({ ...prev, [metodo]: '' }));
    }
  };

  const handleConfirmarCobro = () => {
    const totalOriginal = totalFinal;
    const montoDescuento = aplicarDescuento ? Math.round(totalOriginal * 0.1) : 0;
    const totalACobrar = totalOriginal - montoDescuento;

    let metodosFinales = [];
    let metodoGeneral = '';

    if (modoPago === 'unico') {
        metodosFinales = [{ metodo: metodoUnico, monto: totalACobrar }];
        metodoGeneral = metodoUnico;
    } else {
        metodosFinales = Object.entries(montosMixtos)
          .filter(([m]) => metodosHabilitados[m] && getRawNumber(montosMixtos[m]) > 0)
          .map(([m, v]) => ({ metodo: m, monto: getRawNumber(v) }));
        metodoGeneral = 'Mixto';
    }

    const totalIngresado = metodosFinales.reduce((acc, item) => acc + item.monto, 0);

    if (totalIngresado < totalACobrar && modoPago === 'mixto') {
        notificar(`FALTAN ${formatPeso(totalACobrar - totalIngresado)}`, "error");
        return;
    }

    const datosPago = {
        estado_pago: 'Pagado',
        metodo_pago: metodoGeneral,
        detalles_pago: metodosFinales,
        descuento: montoDescuento,
        total_pagado: totalIngresado,
        fecha_pago: Timestamp.now()
    };

    setPagoTemporal(datosPago);
    setMostrarModalPago(false); 
    notificar("¡COBRO REGISTRADO! GUARDE EL PEDIDO PARA FINALIZAR.", "success");
  };

  const enviarCocina = async () => {
    if (orden.length === 0) {
        notificar("EL PEDIDO ESTÁ VACÍO. AGREGA PRODUCTOS ANTES DE CONFIRMAR.", "error");
        return;
    }
    
    if (!cajaAbierta) {
        notificar("¡ATENCIÓN! ABRA EL TURNO EN CAJA PARA CONTINUAR.", "error");
        return;
    }

    const hoy = getLocalISODate();
    
    let sourcePago = null;
    if (pagoTemporal) {
        sourcePago = pagoTemporal;
    } else if (ordenAEditar && String(ordenAEditar.estado_pago).toLowerCase() === 'pagado') {
        sourcePago = ordenAEditar;
    }

    const nuevoEstadoPago = sourcePago ? "Pagado" : "Pendiente";
    const nuevoMetodoPago = sourcePago ? sourcePago.metodo_pago : (ordenAEditar?.metodo_pago || "N/A");
    
    let detallesPago = sourcePago?.detalles_pago || [];
    let totalPagado = sourcePago?.total_pagado || 0;
    let fechaPago = sourcePago?.fecha_pago || null;
    let descuento = sourcePago?.descuento || 0;

    if (!sourcePago && !ordenAEditar) {
        detallesPago = []; totalPagado = 0; fechaPago = null; descuento = 0;
    }

    const datos = {
        items: JSON.parse(JSON.stringify(orden)), 
        total: totalFinal,
        costo_despacho: tipoEntrega === 'REPARTO' ? (parseInt(costoDespacho) || 0) : 0, 
        tipo_entrega: tipoEntrega, 
        nombre_cliente: String(nombreCliente || 'CLIENTE').toUpperCase(),
        hora_pedido: String(horaPedido), 
        hora_entrega: String(horaEntrega), 
        direccion: tipoEntrega === 'REPARTO' ? String(direccion) : '', 
        telefono: tipoEntrega === 'REPARTO' ? String(telefono) : '',
        nota_personal: tipoEntrega === 'REPARTO' ? String(notaPersonal).toUpperCase() : '',
        descripcion: String(descripcionGeneral).toUpperCase(), 
        fechaString: ordenAEditar ? (ordenAEditar.fechaString || hoy) : hoy,
        numero_pedido: ordenAEditar ? ordenAEditar.numero_pedido : numeroPedidoVisual,
        estado: ordenAEditar ? ordenAEditar.estado : "pendiente", 
        estado_pago: nuevoEstadoPago, 
        metodo_pago: nuevoMetodoPago,
        detalles_pago: detallesPago,
        total_pagado: totalPagado,
        fecha_pago: fechaPago,
        descuento: descuento,
        fecha: ordenAEditar ? ordenAEditar.fecha : Timestamp.now(), 
        usuario_id: user?.uid || "anonimo"
    };

    try {
        const colRef = collection(db, COL_ORDENES);
        let pedidoIdGuardado;

        if (ordenAEditar) {
            await updateDoc(doc(db, COL_ORDENES, ordenAEditar.id), datos);
            pedidoIdGuardado = ordenAEditar.id;
            notificar(`PEDIDO #${datos.numero_pedido} ACTUALIZADO CORRECTAMENTE`, "success"); 
            
            // LIMPIEZA FORZOSA TRAS ACTUALIZAR
            limpiarFormulario();
            
            if (onTerminarEdicion) onTerminarEdicion();
        } else {
            const docRef = await addDoc(colRef, datos);
            pedidoIdGuardado = docRef.id;
            notificar(`PEDIDO #${datos.numero_pedido} GUARDADO EXITOSAMENTE`, "success"); 
            
            // LIMPIEZA FORZOSA TRAS GUARDAR NUEVO
            limpiarFormulario();
        }

        if (pagoTemporal && detallesPago && detallesPago.length > 0) {
            const movRef = collection(db, COL_MOVIMIENTOS);
            for (const detalle of detallesPago) {
                await addDoc(movRef, {
                    tipo: 'ingreso',
                    categoria: 'VENTA',
                    monto: detalle.monto,
                    descripcion: `VENTA PEDIDO #${datos.numero_pedido}${descuento > 0 ? ' (DESC 10%)' : ''}`,
                    metodo: detalle.metodo,
                    fecha: Timestamp.now(),
                    usuario_id: user?.uid || 'anonimo',
                    pedido_id: pedidoIdGuardado
                });
            }
        }

        setPagoTemporal(null);
        ejecutarImpresion(datos);
        setMostrarModalPago(false); 
    } catch (error) {
        console.error("Error al procesar orden:", error);
        notificar("ERROR AL GUARDAR EL PEDIDO", "error");
    }
  };

  const agregarAlPedido = (p) => {
    if (!cajaAbierta) { notificar("¡ATENCIÓN! CAJA CERRADA. ABRA TURNO PRIMERO.", "error"); return; }
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
      {/* NOTIFICACIÓN FLOTANTE */}
      {notificacion.mostrar && (
        <div className={`fixed top-4 right-4 z-[100000] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 transition-all duration-500 ${notificacion.tipo === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`} style={{ animation: 'slideIn 0.3s ease-out forwards' }}>
            <span className="text-2xl">{notificacion.tipo === 'error' ? '🚫' : '✅'}</span>
            <div>
                <h4 className="font-black uppercase text-xs opacity-75">{notificacion.tipo === 'error' ? 'Error' : 'Éxito'}</h4>
                <p className="font-bold text-sm leading-tight">{notificacion.mensaje}</p>
            </div>
        </div>
      )}

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
                    onClick={() => {
                        setMostrarModalPago(true);
                        setAplicarDescuento(false);
                        setModoPago('unico');
                        setMontoAbono('');
                        setMetodosHabilitados({ Efectivo: true, Transferencia: false, Débito: false });
                        setMontosMixtos({ Efectivo: '', Transferencia: '', Débito: '' });
                    }} 
                    disabled={!cajaAbierta || orden.length === 0}
                    className={`${!cajaAbierta || orden.length === 0 ? 'bg-slate-300 cursor-not-allowed' : (pagoTemporal ? 'bg-emerald-500 text-white ring-2 ring-emerald-300' : 'bg-green-600 hover:bg-green-700 active:scale-95 text-white')} px-3 py-2 rounded-2xl text-[10px] font-black uppercase shadow-lg transition-all`}
                  >
                      {pagoTemporal ? '¡COBRADO! (LISTO)' : 'COBRAR'}
                  </button>
                  <button 
                    onClick={() => enviarCocina()} 
                    disabled={!cajaAbierta}
                    className={`${!cajaAbierta ? 'bg-slate-300 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 active:scale-95'} text-white px-3 py-2 rounded-2xl text-[10px] font-black uppercase shadow-lg transition-all`}
                  >
                      {!cajaAbierta ? 'CAJA CERRADA' : (ordenAEditar ? 'ACTUALIZAR' : 'GUARDAR')}
                  </button>
              </div>
           </div>

           {!cajaAbierta && <div className="bg-amber-50 border border-amber-200 p-2 rounded-xl text-center"><p className="text-[10px] font-black text-amber-600 uppercase m-0 tracking-tighter">⚠️ Debe abrir caja para comenzar a tomar pedidos</p></div>}
           
           <input type="text" placeholder="NOMBRE CLIENTE *" className={inputStyle} value={nombreCliente} onChange={e => setNombreCliente(e.target.value)} />
           
           <div className="flex gap-2">
             <div className="flex bg-slate-100 rounded-xl p-1 gap-1 flex-1">
               <button className={`flex-1 py-2 rounded-lg text-[10px] font-black transition-all ${tipoEntrega === 'LOCAL' ? 'bg-white shadow-sm text-red-600' : 'text-gray-400'}`} onClick={() => { setTipoEntrega('LOCAL'); setCostoDespacho(''); setDireccion(''); setTelefono(''); setNotaPersonal(''); }}>LOCAL</button>
               <button className={`flex-1 py-2 rounded-lg text-[10px] font-black transition-all ${tipoEntrega === 'REPARTO' ? 'bg-white shadow-sm text-orange-600' : 'text-gray-400'}`} onClick={() => setTipoEntrega('REPARTO')}>REPARTO</button>
             </div>
             <div className="w-24 relative group">
                <input type="time" className="w-full h-full p-1 text-center rounded-xl border-2 border-gray-100 bg-white font-black text-xs outline-none focus:border-red-200" value={horaEntrega} onChange={(e) => setHoraEntrega(e.target.value)} />
                <span className="absolute -top-2 left-2 bg-white px-1 text-[8px] font-black text-gray-400 uppercase">Hora</span>
             </div>
           </div>
           
           {tipoEntrega === 'REPARTO' && (
             <div className="space-y-2 p-2.5 rounded-2xl border-2 border-orange-100 bg-orange-50/50 shadow-inner animate-in fade-in zoom-in-95 duration-200">
               <input type="text" placeholder="Dirección de entrega..." className={inputStyle + " border-orange-200"} value={direccion} onChange={e => setDireccion(e.target.value)} />
               <div className="flex gap-2">
                 <input type="text" placeholder="Tel" className={inputStyle + " flex-1 border-orange-200"} value={telefono} onChange={e => setTelefono(e.target.value)} />
                 <input type="number" placeholder="Envío" className={inputStyle + " border-orange-200 w-24 text-right"} value={costoDespacho} onChange={e => setCostoDespacho(e.target.value)} />
               </div>
             </div>
           )}
           
           <div className="px-3 py-3 bg-slate-900 text-white rounded-xl flex justify-between items-center shadow-lg border border-slate-800">
              <span className="text-[10px] font-black uppercase opacity-60 tracking-widest">Total</span>
              <span className="text-2xl font-black tracking-tighter leading-none">${totalFinal.toLocaleString('es-CL')}</span>
           </div>

           <textarea placeholder="OBSERVACIONES PARA COCINA..." className="w-full p-3 border-2 border-gray-100 rounded-2xl text-[10px] uppercase font-bold focus:border-red-500 outline-none resize-none h-16 bg-white shadow-inner" value={descripcionGeneral} onChange={e => setDescripcionGeneral(e.target.value)} />
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-gray-50/50 custom-scrollbar">
          {orden.map((item, idx) => (
            <div key={idx} className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm flex flex-col animate-in fade-in">
                <div className="flex justify-between font-black text-[11px] uppercase text-slate-800">
                    <span className="flex-1 mr-2 leading-tight">{item.nombre}</span>
                    <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded-lg h-fit text-[10px]">{item.cantidad}x</span>
                </div>
                <div className="mt-2 flex gap-2 items-center">
                    <input type="text" placeholder="Nota item..." className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[9px] font-black uppercase outline-none focus:border-blue-400 focus:bg-white transition-all shadow-inner" value={item.observacion || ''} onChange={(e) => handleNotaItemChange(idx, e.target.value)} />
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
                    {item.descripcion && <span className="text-[10px] text-slate-600 text-center line-clamp-3 px-1 leading-tight lowercase first-letter:uppercase italic font-medium">{item.descripcion}</span>}
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

      {/* --- MODAL DE COBRO --- */}
      {mostrarModalPago && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[99999] flex items-center justify-center p-4 animate-in fade-in" onClick={() => setMostrarModalPago(false)}>
            <div className="bg-white rounded-[3rem] p-8 max-w-sm w-full shadow-2xl space-y-6 scale-in border border-white" onClick={e => e.stopPropagation()}>
                
                <div className="flex justify-between items-start">
                  <div>
                      <h3 className="font-black uppercase text-lg text-slate-900 m-0 tracking-tighter">Cobrar Pedido</h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">#{numeroPedidoVisual} • {nombreCliente || 'Cliente'}</p>
                  </div>
                  <button onClick={() => setModoPago(modoPago === 'unico' ? 'mixto' : 'unico')} className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase transition-all ${modoPago === 'mixto' ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}>
                    {modoPago === 'mixto' ? 'Pago Mixto' : 'Activar Mixto'}
                  </button>
                </div>
                
                <div className="bg-slate-50 p-6 rounded-[2rem] border-2 border-slate-100 text-center relative overflow-hidden">
                    <div className="flex flex-col items-center">
                        <span className="text-4xl font-black text-slate-900 tracking-tighter">{formatPeso(totalFinal - (aplicarDescuento ? Math.round(totalFinal * 0.1) : 0))}</span>
                        {aplicarDescuento && <span className="text-[10px] font-black text-red-500 uppercase mt-1 line-through opacity-50">Original: {formatPeso(totalFinal)}</span>}
                    </div>
                </div>

                <button onClick={() => setAplicarDescuento(!aplicarDescuento)} className={`w-full py-4 rounded-2xl border-2 font-black uppercase text-[11px] transition-all flex items-center justify-center gap-3 ${aplicarDescuento ? 'bg-emerald-50 border-emerald-500 text-emerald-600 shadow-inner' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200'}`}>
                    <i className={`bi ${aplicarDescuento ? 'bi-check-circle-fill' : 'bi-percent'}`}></i>
                    {aplicarDescuento ? 'DESCUENTO 10% APLICADO' : 'APLICAR DESCUENTO 10%'}
                </button>

                {modoPago === 'unico' ? (
                    <div className="grid grid-cols-3 gap-2">
                        {['Efectivo', 'Transferencia', 'Débito'].map(m => (
                            <button key={m} onClick={() => setMetodoUnico(m)} className={`py-4 rounded-2xl font-black text-[10px] border-2 uppercase transition-all ${metodoUnico === m ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-100 text-gray-400'}`}>{m}</button>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-2">
                            {['Efectivo', 'Transferencia', 'Débito'].map(m => (
                                <div key={m} className="flex flex-col gap-2">
                                    <button onClick={() => toggleMetodoMixto(m)} className={`py-2 rounded-xl border-2 text-[9px] font-black uppercase transition-all ${metodosHabilitados[m] ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-300'}`}>{m}</button>
                                    <input type="text" disabled={!metodosHabilitados[m]} className="w-full p-2 bg-slate-50 rounded-xl border-2 border-slate-100 outline-none text-right font-black text-[10px] focus:border-blue-400 disabled:opacity-30" placeholder="0" value={montosMixtos[m]} onChange={(e) => setMontosMixtos(prev => ({...prev, [m]: formatInput(e.target.value)}))} />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex gap-3 mt-4">
                    <button onClick={() => setMostrarModalPago(false)} className="flex-1 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:bg-slate-50 rounded-2xl">Cancelar</button>
                    <button onClick={handleConfirmarCobro} className="flex-[2] py-4 bg-green-600 text-white rounded-2xl text-[10px] font-black uppercase shadow-xl hover:bg-green-700 active:scale-95 transition-all">Confirmar Cobro</button>
                </div>
            </div>
        </div>
      )}

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
                  horaEntrega={horaEntrega}
                  estadoPago={pagoTemporal ? 'Pagado' : (ordenAEditar?.estado_pago || 'Pendiente')}
                  metodoPago={pagoTemporal ? pagoTemporal.metodo_pago : (ordenAEditar?.metodo_pago || '')}
                  detallesPago={pagoTemporal ? pagoTemporal.detalles_pago : (ordenAEditar?.detalles_pago || [])}
                />
                <button onClick={() => setMostrarVistaPrevia(false)} className="w-full mt-6 py-4 bg-slate-900 text-white font-black uppercase rounded-2xl shadow-xl no-print hover:bg-black transition-colors">Cerrar Vista</button>
            </div>
        </div>
      )}

      {/* ELEMENTO DE IMPRESIÓN (SOLO WEB) */}
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
              horaEntrega={ultimoPedidoParaImprimir.hora_entrega}
              estadoPago={ultimoPedidoParaImprimir.estado_pago}
              metodoPago={ultimoPedidoParaImprimir.metodo_pago}
              detallesPago={ultimoPedidoParaImprimir.detalles_pago}
            />
        </div>
      )}

      {/* ESTILOS DE IMPRESIÓN AISLADOS */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .scale-in { animation: scaleIn 0.2s ease-out; }
        @keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        
        @media print { 
          body * { visibility: hidden; } 
          .print\\:block, .print\\:block * { visibility: visible; } 
          .print\\:block { position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: white; z-index: 10000; } 
        }
      `}</style>
    </div>
  );
}