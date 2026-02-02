import React, { useState, useEffect } from 'react';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  updateDoc, 
  doc,
  addDoc,
  Timestamp,
  query,
  where,
  getDocs,
  deleteDoc 
} from 'firebase/firestore'; 
// Se corrige la importación eliminando la extensión explícita para asegurar la resolución en el entorno de compilación
import { useUi } from './context/UiContext';

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const getLocalDate = () => new Date().toISOString().split('T')[0];

/**
 * COMPONENTE CAJA
 * Gestiona turnos, dinero recaudado e historial.
 * PDF Mejorado: Incluye resumen financiero y tabla detallada de todas las órdenes del día.
 * Función Especial: Re-apertura de cajas cerradas con aislamiento total de datos por fecha (estricto para el día seleccionado).
 */
export default function Caja({ user: userProp }) {
    const { notificar } = useUi();
    const [user, setUser] = useState(userProp || null);
    const [authReady, setAuthReady] = useState(false);
    
    const [vista, setVista] = useState('actual'); 
    const [filtroFechaHistorial, setFiltroFechaHistorial] = useState(''); 

    const [idCajaAbierta, setIdCajaAbierta] = useState(null);
    const [montoApertura, setMontoApertura] = useState(0);
    const [fechaInicioCaja, setFechaInicioCaja] = useState(getLocalDate()); 
    const [cargando, setCargando] = useState(true);
    
    const [totalBrutoRecaudado, setTotalBrutoRecaudado] = useState(0); 
    const [totalEnvios, setTotalEnvios] = useState(0);       
    const [totalGastos, setTotalGastos] = useState(0);       
    const [efectivo, setEfectivo] = useState(0);
    const [tarjeta, setTarjeta] = useState(0);
    const [transferencia, setTransferencia] = useState(0);

    const [listaVentas, setListaVentas] = useState([]);
    const [listaGastos, setListaGastos] = useState([]);
    const [cajasAnteriores, setCajasAnteriores] = useState([]);
    const [ordenesNoPagadasHoy, setOrdenesNoPagadasHoy] = useState([]); 
    
    const [montoAperturaInput, setMontoAperturaInput] = useState('');
    const [procesandoApertura, setProcesandoApertura] = useState(false);
    const [libsReady, setLibsReady] = useState(false);

    const emailUsuario = user?.email || "";
    const esPrueba = emailUsuario === "prueba@isakari.com";
    const COL_ORDENES = esPrueba ? "ordenes_pruebas" : "ordenes";
    const COL_GASTOS = esPrueba ? "gastos_pruebas" : "gastos";
    const COL_CAJAS = esPrueba ? "cajas_pruebas" : "cajas";

    const hoyString = getLocalDate();

    const formatoPeso = (v) => {
        try {
            if (v === null || v === undefined) return '$0';
            if (typeof v === 'object' && !Array.isArray(v)) return '$0';
            const num = typeof v === 'string' ? Number(v.replace(/\D/g, '')) : Number(v);
            return (num || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
        } catch (e) {
            return '$0';
        }
    };

    // 0. Autenticación
    useEffect(() => {
        const initAuth = async () => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else if (!auth.currentUser) {
                    await signInAnonymously(auth);
                }
                setAuthReady(true);
            } catch (e) { console.error("Auth error:", e); }
        };
        initAuth();
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (u) setAuthReady(true);
        });
        return () => unsubscribe();
    }, []);

    // 1. Carga de librerías PDF
    useEffect(() => {
        const scripts = [
            { id: 'jspdf-script', src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' },
            { id: 'jspdf-autotable-script', src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js' }
        ];
        const loadScript = (data) => new Promise((resolve) => {
            if (document.getElementById(data.id)) return resolve();
            const script = document.createElement('script');
            script.id = data.id; script.src = data.src; script.async = false;
            script.onload = () => resolve();
            document.head.appendChild(script);
        });
        Promise.all(scripts.map(loadScript)).then(() => setLibsReady(true));
    }, []);

    // 2. Listener Cajas
    useEffect(() => {
        if (!authReady || !user) return;
        const unsub = onSnapshot(collection(db, COL_CAJAS), (snap) => {
            const docs = snap.docs.map(d => {
                const r = d.data();
                return {
                    id: d.id,
                    ...r,
                    total_ventas: Number(r.total_ventas || 0),
                    total_gastos: Number(r.total_gastos || 0),
                    monto_cierre_sistema: Number(r.monto_cierre_sistema || 0),
                    monto_apertura: Number(r.monto_apertura || 0),
                    total_envios: Number(r.total_envios || 0),
                    total_ganancia: Number(r.total_ganancia || 0),
                    fechaString: String(r.fechaString || 'S/F'),
                    usuario_email: String(r.usuario_email || 'N/A')
                };
            });
            const abierta = docs.find(c => c.estado === "abierta");
            if (abierta) {
                setMontoApertura(Number(abierta.monto_apertura) || 0);
                setIdCajaAbierta(abierta.id);
                if (abierta.fechaString) setFechaInicioCaja(abierta.fechaString);
            } else {
                setMontoApertura(0);
                setIdCajaAbierta(null);
                setFechaInicioCaja(getLocalDate());
            }
            setCajasAnteriores(docs.filter(c => c.estado === "cerrada").sort((a,b) => (b.fecha_apertura?.seconds || 0) - (a.fecha_apertura?.seconds || 0)));
            setCargando(false);
        });
        return () => unsub();
    }, [authReady, user, COL_CAJAS]);

    // 3. Listener Ventas/Gastos con Aislamiento por Fecha Estricto
    useEffect(() => {
        if (!authReady || !user) return;
        const unsubVentas = onSnapshot(collection(db, COL_ORDENES), (snap) => {
            let sEfec = 0, sTarj = 0, sTrans = 0, recaudado = 0, totalEnv = 0;
            const actuales = [], pendientesHoy = [];

            snap.docs.forEach(docSnap => {
                const rawData = docSnap.data();
                const data = {
                    id: docSnap.id,
                    ...rawData,
                    estado_pago: rawData.estado_pago || rawData.estadoPago || "Pendiente",
                    metodo_pago: rawData.metodo_pago || rawData.medioPago || "N/A",
                    nombre_cliente: rawData.nombre_cliente || rawData.cliente || "CLIENTE",
                    total: Number(rawData.total || rawData.total_pagado || 0)
                };

                const pagado = String(data.estado_pago).toLowerCase() === 'pagado';
                const fecha = data.fechaString || "";
                
                // AISLAMIENTO POR FECHA: Se usa === para que al re-abrir una caja solo salgan los datos de ese día específico
                if (idCajaAbierta && fecha === fechaInicioCaja && pagado && String(data.estado || "").toLowerCase() === 'entregado') {
                    actuales.push(data);
                    recaudado += data.total;
                    totalEnv += Number(data.costo_despacho || 0);

                    if (data.detalles_pago && Array.isArray(data.detalles_pago)) {
                        data.detalles_pago.forEach(p => {
                            const m = Number(p.monto) || 0;
                            if (p.metodo === 'Efectivo') sEfec += m;
                            else if (p.metodo === 'Tarjeta') sTarj += m;
                            else if (p.metodo === 'Transferencia') sTrans += m;
                        });
                    } else if (data.desglosePago) {
                        Object.entries(data.desglosePago).forEach(([met, val]) => {
                            const m = Number(val) || 0;
                            if (met === 'Efectivo') sEfec += m;
                            else if (met === 'Tarjeta') sTarj += m;
                            else if (met === 'Transferencia') sTrans += m;
                        });
                    } else {
                        const m = data.metodo_pago;
                        if(m === 'Efectivo') sEfec += data.total;
                        else if(m === 'Tarjeta') sTarj += data.total;
                        else if(m === 'Transferencia') sTrans += data.total;
                    }
                }
                
                // Filtro estricto para pendientes de la caja abierta (ej. día 29)
                if (!pagado && idCajaAbierta && fecha === fechaInicioCaja) {
                    pendientesHoy.push(data);
                }
            });

            setListaVentas(actuales.sort((a,b) => (b.numero_pedido || 0) - (a.numero_pedido || 0)));
            setOrdenesNoPagadasHoy(pendientesHoy);
            setTotalBrutoRecaudado(recaudado);
            setTotalEnvios(totalEnv);
            setEfectivo(sEfec); setTarjeta(sTarj); setTransferencia(sTrans);
        });

        const unsubGastos = onSnapshot(collection(db, COL_GASTOS), (snap) => {
            if (!idCajaAbierta) return;
            // Filtro estricto para gastos por fecha
            const turno = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(g => g.fechaString === fechaInicioCaja);
            setListaGastos(turno.sort((a,b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0)));
            setTotalGastos(turno.reduce((sum, i) => sum + (Number(i.monto)||0), 0));
        });

        return () => { unsubVentas(); unsubGastos(); };
    }, [authReady, user, idCajaAbierta, fechaInicioCaja, COL_ORDENES, COL_GASTOS, hoyString]);

    const totalVentasNetas = totalBrutoRecaudado - totalEnvios;
    const gananciaReal = totalVentasNetas - totalGastos;
    const efectivoEnCajon = (montoApertura + efectivo) - totalGastos;

    const handleAbrirCaja = async () => {
        const monto = Number(montoAperturaInput.replace(/\D/g, ''));
        if (isNaN(monto)) return notificar("Monto inválido", "error");
        setProcesandoApertura(true);
        try {
            await addDoc(collection(db, COL_CAJAS), { estado: "abierta", monto_apertura: monto, fecha_apertura: Timestamp.now(), fechaString: hoyString, usuario_id: user.uid, usuario_email: user.email });
            notificar("Caja iniciada", "success");
            setMontoAperturaInput('');
        } catch (e) { notificar("Error al abrir", "error"); } finally { setProcesandoApertura(false); }
    };

    const handleCerrarCaja = async () => {
        if (!idCajaAbierta) return;
        if (ordenesNoPagadasHoy.length > 0) return notificar(`⚠️ Bloqueo: Cobrar ${ordenesNoPagadasHoy.length} pedidos del día ${fechaInicioCaja}.`, "error");
        if (!window.confirm(`¿Deseas cerrar el turno del día ${fechaInicioCaja}?`)) return;
        try {
            await updateDoc(doc(db, COL_CAJAS, idCajaAbierta), { 
                estado: "cerrada", 
                fecha_cierre: Timestamp.now(), 
                monto_cierre_sistema: efectivoEnCajon, 
                total_ventas: totalBrutoRecaudado, 
                total_envios: totalEnvios,
                total_gastos: totalGastos, 
                total_ganancia: gananciaReal, 
                monto_apertura: montoApertura 
            });
            notificar("Caja cerrada correctamente", "success");
        } catch (e) { notificar("Error al cerrar", "error"); }
    };

    const handleReabrirCaja = async (caja) => {
        if (idCajaAbierta) return notificar("Ya hay una caja abierta. Ciérrala antes de re-abrir otra.", "error");
        if (!window.confirm(`¿Estás seguro de re-abrir la caja del día ${caja.fechaString}? Verás únicamente los datos de ese día.`)) return;

        try {
            await updateDoc(doc(db, COL_CAJAS, caja.id), {
                estado: "abierta",
                fecha_cierre: null
            });
            notificar(`Caja del ${caja.fechaString} re-abierta`, "success");
            setVista('actual'); 
        } catch (e) {
            notificar("Error al intentar re-abrir la caja", "error");
        }
    };

    const handleEliminarPedido = async (id, numero) => {
        if (!window.confirm(`¿Estás seguro de eliminar el pedido #${numero}? Esta acción es permanente.`)) return;
        try {
            await deleteDoc(doc(db, COL_ORDENES, id));
            notificar(`Pedido #${numero} eliminado`, "success");
        } catch (e) {
            console.error(e);
            notificar("Error al eliminar", "error");
        }
    };

    const handleExportarPDF = async (cajaData = null) => {
        if (!libsReady || !window.jspdf) return notificar("Iniciando motor PDF...", "error");
        
        const data = cajaData || { 
            fechaString: fechaInicioCaja, 
            total_ventas: totalBrutoRecaudado, 
            total_envios: totalEnvios,
            total_gastos: totalGastos, 
            total_ganancia: gananciaReal, 
            monto_cierre_sistema: efectivoEnCajon, 
            monto_apertura: montoApertura 
        };

        let pedidosParaDetalle = [];
        if (!cajaData) {
            pedidosParaDetalle = listaVentas;
        } else {
            const q = query(collection(db, COL_ORDENES), where("fechaString", "==", data.fechaString));
            const snap = await getDocs(q);
            pedidosParaDetalle = snap.docs.map(d => d.data())
                .filter(o => String(o.estado_pago || o.estadoPago).toLowerCase() === 'pagado')
                .sort((a,b) => (a.numero_pedido || 0) - (b.numero_pedido || 0));
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF();

        pdf.setFontSize(18);
        pdf.text("ISAKARI SUSHI - REPORTE DE CAJA", 105, 15, { align: 'center' });
        pdf.setFontSize(10);
        pdf.text(`Fecha Turno: ${data.fechaString}`, 105, 22, { align: 'center' });

        const ventasNetas = data.total_ventas - (data.total_envios || 0);
        
        pdf.autoTable({ 
            startY: 30, 
            head: [['Indicador de Turno', 'Valor en Pesos']], 
            body: [
                ['Monto Caja Inicial', formatoPeso(data.monto_apertura)], 
                ['Ventas Netas (Sin Envíos)', formatoPeso(ventasNetas)], 
                ['Recaudación por Repartos', formatoPeso(data.total_envios)], 
                ['Gastos Registrados', formatoPeso(data.total_gastos)], 
                ['Ganancia Real (Ventas - Gastos)', formatoPeso(data.total_ganancia)], 
                ['TOTAL FINAL EN GAVETA (EFECTIVO)', formatoPeso(data.monto_cierre_sistema)]
            ], 
            theme: 'grid',
            headStyles: { fillStyle: 'DF', fillColor: [33, 37, 41] },
            columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } }
        });

        pdf.setFontSize(12);
        pdf.text("DETALLE DE ÓRDENES DEL DÍA", 14, pdf.lastAutoTable.finalY + 15);

        const rowsPedidos = pedidosParaDetalle.map(o => [
            o.numero_pedido,
            o.nombre_cliente,
            (o.items || []).map(i => `${i.cantidad}x ${i.nombre}`).join(', '),
            o.tipo_entrega,
            formatoPeso(o.total),
            o.metodo_pago || o.medioPago || 'N/A'
        ]);

        pdf.autoTable({
            startY: pdf.lastAutoTable.finalY + 20,
            head: [['N°', 'Cliente', 'Detalle Productos', 'Tipo', 'Valor', 'Pago']],
            body: rowsPedidos,
            theme: 'striped',
            headStyles: { fillColor: [100, 100, 100] },
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: {
                2: { cellWidth: 60 }, 
                4: { halign: 'right' }
            }
        });

        pdf.save(`Reporte_Caja_Isakari_${data.fechaString}.pdf`);
    };

    const cajasFiltradas = (filtroFechaHistorial 
        ? cajasAnteriores.filter(c => c.fechaString === filtroFechaHistorial)
        : cajasAnteriores) || [];

    if (cargando) return <div className="h-full flex items-center justify-center font-black uppercase text-slate-400 animate-pulse text-[10px]">Sincronizando Isakari...</div>;

    return (
        <div className="flex flex-col h-full bg-slate-100 p-2 md:p-4 font-sans overflow-hidden text-gray-800">
            
            <div className="flex justify-center mb-4 flex-shrink-0">
                <div className="bg-white rounded-full p-1 shadow-sm border border-slate-200 flex gap-1">
                    <button onClick={() => setVista('actual')} className={`px-5 py-1.5 rounded-full text-[9px] font-black uppercase transition-all flex items-center gap-2 ${vista === 'actual' ? 'bg-red-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>
                        <i className="bi bi-cash-stack"></i> Caja Actual
                    </button>
                    <button onClick={() => setVista('historial')} className={`px-5 py-1.5 rounded-full text-[9px] font-black uppercase transition-all flex items-center gap-2 ${vista === 'historial' ? 'bg-red-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>
                        <i className="bi bi-clock-history"></i> Historial
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden">
                {vista === 'actual' && (
                    !idCajaAbierta ? (
                        <div className="h-full flex items-center justify-center animate-fade-in">
                            <div className="bg-white rounded-2xl p-8 shadow-xl border-2 border-slate-50 text-center max-w-sm w-full">
                                <h1 className="text-2xl font-black uppercase mb-4 tracking-tighter text-slate-900">Iniciar Caja</h1>
                                <input type="text" className="w-full p-3 mb-4 bg-slate-50 border-2 border-slate-100 rounded-xl font-black text-2xl text-center outline-none focus:border-red-500" placeholder="$ 0" value={montoAperturaInput} onChange={(e) => setMontoAperturaInput(e.target.value.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, "."))} />
                                <button onClick={handleAbrirCaja} className="w-full py-4 bg-red-600 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-lg hover:bg-red-700">Abrir Caja</button>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col overflow-hidden animate-fade-in">
                            <header className="flex items-center justify-between mb-3 flex-shrink-0">
                                <div>
                                    <h2 className="text-xl font-black text-slate-900 tracking-tighter uppercase leading-none m-0">Caja Isakari</h2>
                                    <span className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1.5 mt-1">
                                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span> {fechaInicioCaja}
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => handleExportarPDF()} className="bg-white border-2 border-slate-200 text-red-600 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase flex items-center gap-1.5 shadow-sm transition-colors hover:bg-slate-50"><i className="bi bi-file-earmark-pdf-fill"></i> REPORTE PDF</button>
                                    <button onClick={handleCerrarCaja} className="bg-slate-900 text-white px-4 py-1.5 rounded-lg text-[9px] font-black uppercase shadow-lg hover:bg-black transition-all">CERRAR TURNO</button>
                                </div>
                            </header>

                            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-4 pb-6">
                                {ordenesNoPagadasHoy.length > 0 && (
                                    <div className="bg-amber-100 border-l-4 border-amber-500 py-1 px-3 rounded flex items-center justify-between shadow-sm animate-pulse">
                                        <span className="text-[10px] font-black text-amber-900 uppercase">
                                            <i className="bi bi-exclamation-triangle-fill me-2"></i>
                                            Pedidos Pendientes del {fechaInicioCaja} ({ordenesNoPagadasHoy.length})
                                        </span>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                                    <div className="bg-slate-500 p-5 rounded-2xl shadow-lg text-white border border-slate-600">
                                        <span className="text-[10px] font-black uppercase opacity-80 tracking-widest">Caja Inicial</span>
                                        <div className="text-3xl font-black tracking-tighter mt-1">{formatoPeso(montoApertura)}</div>
                                    </div>
                                    <div className="bg-emerald-600 p-5 rounded-2xl shadow-xl text-white border border-emerald-700">
                                        <span className="text-[10px] font-black uppercase opacity-80 tracking-widest">Ventas (Neto)</span>
                                        <div className="text-3xl font-black tracking-tighter mt-1">{formatoPeso(totalVentasNetas)}</div>
                                    </div>
                                    <div className="bg-orange-600 p-5 rounded-2xl shadow-xl text-white border border-orange-700">
                                        <span className="text-[10px] font-black uppercase opacity-80 tracking-widest">Envíos</span>
                                        <div className="text-3xl font-black tracking-tighter mt-1">{formatoPeso(totalEnvios)}</div>
                                    </div>
                                    <div className="bg-rose-600 p-5 rounded-2xl shadow-xl text-white border border-rose-700">
                                        <span className="text-[10px] font-black uppercase opacity-80 tracking-widest">Gastos</span>
                                        <div className="text-3xl font-black tracking-tighter mt-1">{formatoPeso(totalGastos)}</div>
                                    </div>
                                    <div className="bg-slate-900 p-5 rounded-2xl shadow-2xl text-white border border-slate-800">
                                        <span className="text-[10px] font-black uppercase opacity-80 text-emerald-400 tracking-widest">Utilidad</span>
                                        <div className="text-3xl font-black tracking-tighter mt-1 text-emerald-400">{formatoPeso(gananciaReal)}</div>
                                    </div>
                                </div>

                                <div className="bg-slate-900 p-6 rounded-3xl shadow-2xl text-white border-2 border-emerald-500/30 flex flex-col items-center justify-center">
                                    <span className="text-[11px] font-black uppercase opacity-80 text-emerald-300 tracking-[0.2em]">Total en Gaveta (Efectivo Físico)</span>
                                    <div className="text-5xl font-black tracking-tighter mt-1">{formatoPeso(efectivoEnCajon)}</div>
                                    <p className="text-[8px] font-bold text-slate-400 uppercase mt-2 tracking-[0.3em]">Apertura + Efectivo - Gastos</p>
                                </div>

                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center">
                                        <span className="text-[9px] font-black text-slate-400 uppercase">Efectivo Turno</span>
                                        <div className="text-lg font-black text-slate-800">{formatoPeso(efectivo)}</div>
                                    </div>
                                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center">
                                        <span className="text-[9px] font-black text-slate-400 uppercase">Transferencia</span>
                                        <div className="text-lg font-black text-slate-800">{formatoPeso(transferencia)}</div>
                                    </div>
                                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center">
                                        <span className="text-[9px] font-black text-slate-400 uppercase">Tarjeta</span>
                                        <div className="text-lg font-black text-slate-800">{formatoPeso(tarjeta)}</div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden min-h-[300px]">
                                        <div className="p-3 border-b bg-gray-50 flex justify-between items-center text-[10px] font-black uppercase text-slate-500 tracking-wider">Movimientos del Turno ({fechaInicioCaja}) <span className="bg-slate-900 text-white text-[9px] px-2 py-0.5 rounded-full">{listaVentas.length}</span></div>
                                        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                                            {listaVentas.map(v => (
                                                <div key={v.id} className="flex justify-between items-center p-3 bg-slate-50/50 rounded-xl border border-slate-100 hover:bg-white transition-colors group">
                                                    <div className="max-w-[60%] min-w-0">
                                                        <div className="text-[11px] font-black uppercase truncate leading-none mb-1">#{v.numero_pedido} {v.nombre_cliente}</div>
                                                        <div className="text-[8px] text-emerald-500 font-black uppercase tracking-widest">{v.metodo_pago}</div>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <div className="text-[12px] font-black text-slate-900">{formatoPeso(v.total)}</div>
                                                        <button 
                                                            onClick={() => handleEliminarPedido(v.id, v.numero_pedido)}
                                                            className="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-red-600 hover:text-white"
                                                            title="Eliminar Pedido"
                                                        >
                                                            <i className="bi bi-trash3-fill text-[10px]"></i>
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden min-h-[300px]">
                                        <div className="p-3 border-b bg-gray-50 flex justify-between items-center text-[10px] font-black uppercase text-slate-500 tracking-wider">Gastos ({fechaInicioCaja}) <span className="bg-rose-100 text-rose-600 text-[9px] px-2 py-0.5 rounded-full">{listaGastos.length}</span></div>
                                        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                                            {listaGastos.map(g => (
                                                <div key={g.id} className="flex justify-between items-center p-3 bg-rose-50/30 rounded-xl border border-rose-100 hover:bg-white transition-colors">
                                                    <div className="text-[10px] font-black uppercase text-slate-700 leading-tight truncate">{g.descripcion}</div>
                                                    <div className="text-[12px] font-black text-rose-600">-{formatoPeso(g.monto)}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                )}

                {vista === 'historial' && (
                    <div className="h-full flex flex-col overflow-hidden animate-fade-in">
                        <header className="flex justify-between items-center mb-6 flex-shrink-0">
                            <h2 className="text-xl font-black text-slate-900 uppercase tracking-tighter leading-none m-0">Historial</h2>
                            <div className="flex items-center gap-3 bg-white rounded-2xl p-2 border border-slate-200 shadow-sm focus-within:border-red-500 transition-all">
                                <i className="bi bi-search text-slate-400 ml-2"></i>
                                <input type="date" className="outline-none text-[10px] font-black uppercase text-slate-800 bg-transparent px-2" value={filtroFechaHistorial} onChange={(e) => setFiltroFechaHistorial(e.target.value)} />
                                {filtroFechaHistorial && <button onClick={() => setFiltroFechaHistorial('')} className="p-1 text-slate-300 hover:text-red-600 transition-colors"><i className="bi bi-x-circle-fill"></i></button>}
                            </div>
                        </header>
                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3 pb-10">
                            {cajasFiltradas.map(c => (
                                <div key={c.id || Math.random()} className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex justify-between items-center hover:shadow-md transition-all">
                                    <div className="flex items-center gap-6 flex-1 min-w-0 text-[10px] font-black uppercase">
                                        <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center text-xl shadow-lg flex-shrink-0"><i className="bi bi-archive"></i></div>
                                        <div className="truncate">
                                            <div className="text-lg font-black text-slate-900 tracking-tighter">{String(c.fechaString || 'S/F')}</div>
                                            <div className="text-[8px] text-slate-400 font-bold">{String(c.usuario_email || 'Sin usuario')}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 flex-shrink-0">
                                        <div className="text-right">
                                            <div className="text-[8px] font-black text-slate-400 tracking-widest uppercase">VENTAS (NETO)</div>
                                            <div className="font-black text-emerald-600 text-sm">{formatoPeso(Number(c.total_ventas || 0) - Number(c.total_envios || 0))}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[8px] font-black text-slate-400 tracking-widest uppercase">GAVETA</div>
                                            <div className="font-black text-slate-900 text-sm">{formatoPeso(c.monto_cierre_sistema)}</div>
                                        </div>
                                        <div className="flex gap-2 ml-4">
                                            <button 
                                                onClick={() => handleReabrirCaja(c)} 
                                                className="w-10 h-10 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center hover:bg-amber-600 hover:text-white transition-all shadow-sm" 
                                                title="Re-abrir Caja para corrección"
                                            >
                                                <i className="bi bi-unlock-fill"></i>
                                            </button>
                                            
                                            <button 
                                                onClick={() => handleExportarPDF(c)} 
                                                className="w-10 h-10 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center hover:bg-red-600 hover:text-white transition-all shadow-sm" 
                                                title="Descargar PDF"
                                            >
                                                <i className="bi bi-file-earmark-pdf-fill"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; } .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; } @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } group:hover .group-hover\\:opacity-100 { opacity: 1; }`}</style>
        </div>
    );
}