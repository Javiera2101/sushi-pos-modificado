import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  Timestamp,
  getDocs 
} from 'firebase/firestore';

// Extensiones para asegurar resolución de módulos
import { db } from './firebase.js';
import { useUi } from './context/UiContext.jsx';

/**
 * UTILIDADES DE FECHA (ZONA CHILE)
 */
const getFechaChile = () => {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
};

/**
 * NORMALIZADOR DE FECHAS
 */
const obtenerFechaReal = (timestamp, fechaStringFallback) => {
    if (timestamp && typeof timestamp.toDate === 'function') {
        return new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'America/Santiago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(timestamp.toDate());
    }
    return fechaStringFallback || getFechaChile();
};

export default function Caja({ user }) {
    const { notificar } = useUi();
    
    // Estados de Interfaz
    const [vista, setVista] = useState('actual'); 
    const [filtroFechaHistorial, setFiltroFechaHistorial] = useState(''); 
    const [cargando, setCargando] = useState(true);
    const [libsReady, setLibsReady] = useState(false);

    // Estados de la Caja
    const [idCajaAbierta, setIdCajaAbierta] = useState(null);
    const [montoApertura, setMontoApertura] = useState(0);
    const [montoAperturaInput, setMontoAperturaInput] = useState('');
    const [fechaInicioCaja, setFechaInicioCaja] = useState(getFechaChile()); 
    const [procesandoApertura, setProcesandoApertura] = useState(false);

    // Totales Financieros
    const [totalBrutoRecaudado, setTotalBrutoRecaudado] = useState(0); 
    const [totalVentasNetas, setTotalVentasNetas] = useState(0);     
    const [totalEnvios, setTotalEnvios] = useState(0);       
    const [totalGastos, setTotalGastos] = useState(0);       
    const [gananciaReal, setGananciaReal] = useState(0);
    const [efectivoEnCajon, setEfectivoEnCajon] = useState(0);

    // --- ESTADOS DE DESGLOSE (Crédito Eliminado) ---
    const [efectivo, setEfectivo] = useState(0);
    const [transferencia, setTransferencia] = useState(0);
    const [debito, setDebito] = useState(0);

    // Listas de Datos
    const [listaVentas, setListaVentas] = useState([]);
    const [listaGastos, setListaGastos] = useState([]);
    const [cajasAnteriores, setCajasAnteriores] = useState([]);
    const [ordenesNoPagadasHoy, setOrdenesNoPagadasHoy] = useState([]); 

    const esPrueba = user?.email === "prueba@isakari.com";
    const COL_ORDENES = esPrueba ? "ordenes_pruebas" : "ordenes";
    const COL_GASTOS = esPrueba ? "gastos_pruebas" : "gastos";
    const COL_CAJAS = esPrueba ? "cajas_pruebas" : "cajas";

    const formatoPeso = (v) => {
        const num = Number(v) || 0;
        return num.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
    };

    // Carga de jspdf
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

    // Listener de estado de cajas
    useEffect(() => {
        if (!user) return;
        const unsub = onSnapshot(collection(db, COL_CAJAS), (snap) => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const abierta = docs.find(c => c.estado === "abierta");
            if (abierta) {
                setMontoApertura(Number(abierta.monto_apertura) || 0);
                setIdCajaAbierta(abierta.id);
                const fechaCaja = obtenerFechaReal(abierta.fecha_apertura, abierta.fechaString);
                setFechaInicioCaja(fechaCaja);
            } else {
                setMontoApertura(0);
                setIdCajaAbierta(null);
                setFechaInicioCaja(getFechaChile());
            }
            const cerradas = docs
                .filter(c => c.estado === "cerrada")
                .sort((a, b) => (b.fecha_apertura?.seconds || 0) - (a.fecha_apertura?.seconds || 0));
            setCajasAnteriores(cerradas);
            setCargando(false);
        });
        return () => unsub();
    }, [user, COL_CAJAS]);

    // Listener Ventas y Gastos con DESGLOSE DETALLADO
    useEffect(() => {
        if (!user) return;
        const unsubVentas = onSnapshot(collection(db, COL_ORDENES), (snap) => {
            let sEfec = 0, sTrans = 0, sDeb = 0, recaudadoBruto = 0, tEnv = 0;
            const actuales = [], pendientes = [];
            
            snap.docs.forEach(docSnap => {
                const raw = docSnap.data();
                const fechaCalculada = obtenerFechaReal(raw.fecha, raw.fechaString);
                
                const d = { 
                    id: docSnap.id, 
                    ...raw,
                    fechaDisplay: fechaCalculada, 
                    estado_pago: String(raw.estado_pago || raw.estadoPago || "Pendiente").trim(),
                    metodo_pago: raw.metodo_pago || raw.medioPago || "N/A",
                    total: Number(raw.total_pagado || raw.total || 0),
                    costo_despacho: Number(raw.costo_despacho || 0)
                };

                const pagado = d.estado_pago.toLowerCase() === 'pagado';
                
                if (idCajaAbierta && d.fechaDisplay === fechaInicioCaja) {
                    if (pagado) {
                        actuales.push(d);
                        recaudadoBruto += d.total;
                        tEnv += d.costo_despacho;
                        
                        // Procesar desglose por método
                        if (d.detalles_pago && Array.isArray(d.detalles_pago)) {
                            d.detalles_pago.forEach(p => {
                                const m = Number(p.monto) || 0;
                                const met = String(p.metodo || '').toLowerCase();
                                if (met === 'efectivo') sEfec += m;
                                else if (met === 'transferencia') sTrans += m;
                                else if (met === 'débito' || met === 'debito' || met === 'tarjeta' || met === 'crédito' || met === 'credito') sDeb += m;
                            });
                        } else {
                            const met = String(d.metodo_pago || '').toLowerCase();
                            if (met === 'efectivo') sEfec += d.total;
                            else if (met === 'transferencia') sTrans += d.total;
                            else if (met === 'débito' || met === 'debito' || met === 'tarjeta' || met === 'crédito' || met === 'credito') sDeb += d.total;
                        }
                    } else {
                        pendientes.push(d);
                    }
                }
            });
            actuales.sort((a,b) => (a.fecha?.seconds || 0) - (b.fecha?.seconds || 0));
            setListaVentas(actuales);
            setOrdenesNoPagadasHoy(pendientes);
            setTotalBrutoRecaudado(recaudadoBruto);
            setTotalEnvios(tEnv);
            setEfectivo(sEfec); 
            setTransferencia(sTrans);
            setDebito(sDeb);
        });

        const unsubGastos = onSnapshot(collection(db, COL_GASTOS), (snap) => {
            if (!idCajaAbierta) { setListaGastos([]); setTotalGastos(0); return; }
            const turno = snap.docs
                .map(d => {
                    const raw = d.data();
                    return { ...raw, id: d.id, fechaDisplay: obtenerFechaReal(raw.fecha, raw.fechaString) };
                })
                .filter(g => g.fechaDisplay === fechaInicioCaja);
            setListaGastos(turno);
            setTotalGastos(turno.reduce((sum, i) => sum + (Number(i.monto)||0), 0));
        });
        return () => { unsubVentas(); unsubGastos(); };
    }, [user, idCajaAbierta, fechaInicioCaja, COL_ORDENES, COL_GASTOS]);

    // Cálculo de Efectivo Físico
    useEffect(() => {
        const netas = totalBrutoRecaudado - totalEnvios;
        setTotalVentasNetas(netas);
        setGananciaReal(netas - totalGastos);
        setEfectivoEnCajon((montoApertura + efectivo) - totalGastos);
    }, [totalBrutoRecaudado, totalEnvios, totalGastos, montoApertura, efectivo]);

    /**
     * EXPORTAR PDF REPORTE DE CAJA
     */
    const handleExportarPDF = async (cajaData = null) => {
        if (!libsReady) return notificar("Librerías de PDF no cargadas", "error");
        
        const data = cajaData || { 
            fechaString: fechaInicioCaja, 
            total_ventas: totalBrutoRecaudado, 
            total_envios: totalEnvios, 
            total_gastos: totalGastos, 
            total_ganancia: gananciaReal, 
            monto_cierre_sistema: efectivoEnCajon, 
            monto_apertura: montoApertura, 
            total_ventas_netas: totalVentasNetas,
            total_efectivo: efectivo,
            total_transferencia: transferencia,
            total_debito: debito
        };

        const movimientos = cajaData?.movimientos_cierre || listaVentas.map(v => ({
            numero: v.numero_pedido || '-',
            cliente: v.nombre_cliente || 'CLIENTE',
            tipo: v.tipo_entrega || 'LOCAL',
            envio: v.costo_despacho || 0,
            total: v.total || 0,
            pago: v.metodo_pago || 'N/A'
        }));

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF();
        
        // --- CABECERA ---
        pdf.setFontSize(16);
        pdf.setFont("helvetica", "bold");
        pdf.text("ISAKARI SUSHI - REPORTE DE CAJA", 105, 15, { align: 'center' });
        
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        pdf.text(`Fecha Reporte: ${data.fechaString}`, 15, 25);

        // --- TABLA RESUMEN ---
        pdf.autoTable({ 
            startY: 30, 
            head: [['Concepto', 'Monto']], 
            body: [
                ['Caja Inicial', formatoPeso(data.monto_apertura)], 
                ['Ventas Netas', formatoPeso(data.total_ventas_netas)], 
                ['Total Envíos', formatoPeso(data.total_envios)], 
                ['Gastos Totales', formatoPeso(data.total_gastos)], 
                ['Ganancia Real', formatoPeso(data.total_ganancia)], 
                ['EFECTIVO EN GAVETA', formatoPeso(data.monto_cierre_sistema)]
            ],
            theme: 'striped',
            headStyles: { fillColor: [44, 62, 80] },
            styles: { fontSize: 9 }
        });

        // --- DESGLOSE DE PAGOS ---
        pdf.autoTable({
            startY: pdf.lastAutoTable.finalY + 10,
            head: [['Desglose Métodos de Pago', 'Monto']],
            body: [
                ['Efectivo (Ventas)', formatoPeso(data.total_efectivo)],
                ['Transferencias', formatoPeso(data.total_transferencia)],
                ['Tarjetas (Débito/Crédito)', formatoPeso(data.total_debito)]
            ],
            theme: 'grid',
            headStyles: { fillColor: [52, 73, 94] },
            styles: { fontSize: 9 }
        });

        // --- DETALLE DE MOVIMIENTOS ---
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("DETALLE DE MOVIMIENTOS", 15, pdf.lastAutoTable.finalY + 15);

        pdf.autoTable({
            startY: pdf.lastAutoTable.finalY + 20,
            head: [['N°', 'Cliente', 'Tipo', 'Envío', 'Total', 'Pago']],
            body: movimientos.map(m => [
                m.numero,
                m.cliente.toUpperCase(),
                m.tipo,
                formatoPeso(m.envio),
                formatoPeso(m.total),
                m.pago
            ]),
            theme: 'grid',
            headStyles: { fillColor: [44, 62, 80] },
            styles: { fontSize: 7, cellPadding: 2 }
        });

        pdf.save(`Reporte_Caja_${data.fechaString}.pdf`);
    };

    const handleAbrirCaja = async () => {
        const monto = Number(montoAperturaInput.replace(/\D/g, ''));
        setProcesandoApertura(true);
        try {
            await addDoc(collection(db, COL_CAJAS), { 
                estado: "abierta", monto_apertura: monto, 
                fecha_apertura: Timestamp.now(), fechaString: getFechaChile(), 
                usuario_id: user.uid, usuario_email: user.email 
            });
            notificar("Caja iniciada", "success");
            setMontoAperturaInput('');
        } catch (e) { notificar("Error al abrir", "error"); }
        finally { setProcesandoApertura(false); }
    };

    const handleCerrarCaja = async () => {
        if (!idCajaAbierta || ordenesNoPagadasHoy.length > 0) return notificar("Pedidos pendientes de cobro.", "error");
        if (!window.confirm("¿Cerrar el turno?")) return;
        try {
            await updateDoc(doc(db, COL_CAJAS, idCajaAbierta), { 
                estado: "cerrada", fecha_cierre: Timestamp.now(), 
                monto_cierre_sistema: efectivoEnCajon, 
                total_ventas: totalBrutoRecaudado, 
                total_efectivo: efectivo, 
                total_transferencia: transferencia,
                total_debito: debito,
                total_ventas_netas: totalVentasNetas,
                total_envios: totalEnvios, total_gastos: totalGastos, 
                total_ganancia: gananciaReal, monto_apertura: montoApertura,
                movimientos_cierre: listaVentas.map(v => ({
                    numero: v.numero_pedido || '-',
                    cliente: v.nombre_cliente || 'CLIENTE',
                    tipo: v.tipo_entrega || 'LOCAL',
                    envio: v.costo_despacho || 0,
                    total: v.total || 0,
                    pago: v.metodo_pago || 'N/A'
                }))
            });
            notificar("Caja cerrada", "success");
        } catch (e) { notificar("Error al cerrar", "error"); }
    };

    return (
        <div className="flex flex-col h-full bg-slate-100 p-4 font-sans overflow-hidden text-gray-800">
            <div className="flex justify-center mb-4 flex-shrink-0">
                <div className="bg-white rounded-full p-1 shadow-sm border border-slate-200 flex gap-1">
                    <button onClick={() => setVista('actual')} className={`px-6 py-2 rounded-full text-[10px] font-black uppercase transition-all ${vista === 'actual' ? 'bg-red-600 text-white shadow-md' : 'text-slate-400'}`}>Turno Actual</button>
                    <button onClick={() => setVista('historial')} className={`px-6 py-2 rounded-full text-[10px] font-black uppercase transition-all ${vista === 'historial' ? 'bg-red-600 text-white shadow-md' : 'text-slate-400'}`}>Historial</button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden">
                {vista === 'actual' && (!idCajaAbierta ? (
                    <div className="h-full flex items-center justify-center animate-fade-in">
                        <div className="bg-white rounded-3xl p-10 shadow-2xl text-center max-w-sm w-full border border-slate-200">
                            <h1 className="text-2xl font-black uppercase mb-6 tracking-tighter text-slate-900">Iniciar Turno</h1>
                            <input type="text" className="w-full p-4 mb-6 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-3xl text-center outline-none focus:border-red-500 shadow-inner" placeholder="$ 0" value={montoAperturaInput} onChange={(e) => setMontoAperturaInput(e.target.value.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, "."))} />
                            <button onClick={handleAbrirCaja} disabled={procesandoApertura} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg hover:bg-red-700 transition-all active:scale-95">ABRIR CAJA</button>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col overflow-hidden animate-fade-in">
                        <header className="flex items-center justify-between mb-4 flex-shrink-0">
                            <div>
                                <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase m-0 leading-none">Caja Isakari</h2>
                                <span className="text-[10px] font-bold text-slate-400 uppercase mt-1 flex items-center gap-1.5"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Turno: {fechaInicioCaja}</span>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleExportarPDF()} className="bg-white border-2 border-slate-200 text-red-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-sm">PDF REPORTE</button>
                                <button onClick={handleCerrarCaja} className="bg-slate-900 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase shadow-lg hover:bg-black transition-all">CERRAR TURNO</button>
                            </div>
                        </header>

                        <div className="flex-1 overflow-y-auto space-y-4 pb-10 custom-scrollbar">
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                                <div className="bg-slate-500 p-5 rounded-[2rem] shadow-lg text-white"><span className="text-[10px] font-black uppercase opacity-70">Apertura</span><div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(montoApertura)}</div></div>
                                <div className="bg-emerald-600 p-5 rounded-[2rem] shadow-lg text-white"><span className="text-[10px] font-black uppercase opacity-70">Ventas (Neto)</span><div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalVentasNetas)}</div></div>
                                <div className="bg-orange-600 p-5 rounded-[2rem] shadow-lg text-white"><span className="text-[10px] font-black uppercase opacity-70">Repartos</span><div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalEnvios)}</div></div>
                                <div className="bg-rose-600 p-5 rounded-[2rem] shadow-lg text-white"><span className="text-[10px] font-black uppercase opacity-70">Gastos</span><div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalGastos)}</div></div>
                                <div className="bg-slate-900 p-5 rounded-[2rem] shadow-2xl text-white border-2 border-emerald-500/20"><span className="text-[10px] font-black uppercase text-emerald-400">Utilidad Neto</span><div className="text-2xl font-black tracking-tighter mt-1 text-emerald-400">{formatoPeso(gananciaReal)}</div></div>
                            </div>

                            <div className="bg-slate-900 p-8 rounded-[2.5rem] shadow-2xl text-white border-2 border-emerald-500/30 text-center relative overflow-hidden">
                                <span className="text-xs font-black uppercase opacity-60 tracking-[0.3em] mb-2 block">EFECTIVO FÍSICO EN GAVETA</span>
                                <div className="text-5xl font-black tracking-tighter">{formatoPeso(efectivoEnCajon)}</div>
                                <div className="mt-2 text-[10px] opacity-40 uppercase">Apertura + Efectivo Recaudado - Gastos</div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                                    <span className="text-[9px] font-black uppercase text-slate-400 block mb-1">Efectivo Recaudado</span>
                                    <div className="text-lg font-black text-slate-900">{formatoPeso(efectivo)}</div>
                                </div>
                                <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                                    <span className="text-[9px] font-black uppercase text-slate-400 block mb-1">Transferencias</span>
                                    <div className="text-lg font-black text-blue-600">{formatoPeso(transferencia)}</div>
                                </div>
                                <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                                    <span className="text-[9px] font-black uppercase text-slate-400 block mb-1">Tarjetas (Débito/Crédito)</span>
                                    <div className="text-lg font-black text-purple-600">{formatoPeso(debito)}</div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="bg-white rounded-[2rem] border border-slate-200 flex flex-col overflow-hidden min-h-[350px] shadow-sm">
                                    <div className="p-4 border-b bg-slate-50 font-black uppercase text-[10px] tracking-wider text-slate-500">Detalle de Ventas</div>
                                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                        {listaVentas.map(v => (
                                            <div key={v.id} className="flex justify-between items-center p-3.5 bg-slate-50 rounded-2xl border border-slate-100">
                                                <div className="max-w-[60%]">
                                                    <div className="text-[11px] font-black uppercase truncate leading-none mb-1">#{v.numero_pedido} {v.nombre_cliente}</div>
                                                    <div className="flex gap-1 flex-wrap">
                                                        <span className="text-[8px] text-emerald-600 font-black uppercase bg-emerald-50 px-1 rounded">{v.metodo_pago}</span>
                                                        {v.detalles_pago?.map((dp, i) => (
                                                            <span key={i} className="text-[7px] text-slate-400 font-bold uppercase">{dp.metodo}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-[13px] font-black text-slate-900">{formatoPeso(v.total - v.costo_despacho)}</div>
                                                    {v.costo_despacho > 0 && <div className="text-[7px] text-slate-400 font-bold uppercase tracking-tighter">+ {formatoPeso(v.costo_despacho)} Envío</div>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="bg-white rounded-[2rem] border border-slate-200 flex flex-col overflow-hidden min-h-[350px] shadow-sm">
                                    <div className="p-4 border-b bg-slate-50 font-black uppercase text-[10px] tracking-wider text-slate-500">Gastos del Turno</div>
                                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                        {listaGastos.map(g => (
                                            <div key={g.id} className="flex justify-between items-center p-3.5 bg-rose-50 rounded-2xl border border-rose-100"><div className="text-[11px] font-black uppercase truncate leading-none">{g.descripcion}</div><div className="text-[13px] font-black text-rose-600">-{formatoPeso(g.monto)}</div></div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}

                {vista === 'historial' && (
                    <div className="h-full flex flex-col overflow-hidden animate-fade-in">
                        <header className="flex justify-between items-center mb-6 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><h2 className="text-xl font-black uppercase m-0 tracking-tighter">Historial de Cajas</h2><input type="date" className="text-[10px] font-black p-2 rounded-xl bg-slate-50 border-none outline-none focus:ring-2 ring-red-500" value={filtroFechaHistorial} onChange={(e) => setFiltroFechaHistorial(e.target.value)} /></header>
                        <div className="flex-1 overflow-y-auto space-y-3 pb-10 custom-scrollbar">
                            {cajasAnteriores.filter(c => !filtroFechaHistorial || c.fechaString === filtroFechaHistorial).map(c => {
                                const ventasNetasItem = c.total_ventas_netas || (c.total_ventas - (c.total_envios || 0));
                                return (
                                    <div key={c.id} className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:shadow-md transition-all">
                                        <div><div className="text-lg font-black text-slate-900 tracking-tighter">{c.fechaString}</div><div className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">{c.usuario_email}</div></div>
                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4 w-full md:w-auto">
                                            <div className="text-right"><div className="text-[7px] font-black text-slate-400 uppercase">Efec</div><div className="font-black text-slate-900 text-[10px]">{formatoPeso(c.total_efectivo)}</div></div>
                                            <div className="text-right"><div className="text-[7px] font-black text-slate-400 uppercase">Trans</div><div className="font-black text-blue-600 text-[10px]">{formatoPeso(c.total_transferencia)}</div></div>
                                            <div className="text-right"><div className="text-[7px] font-black text-slate-400 uppercase">Tarj</div><div className="font-black text-purple-600 text-[10px]">{formatoPeso(c.total_debito)}</div></div>
                                        </div>
                                        <div className="flex items-center gap-6 border-l pl-4 border-slate-100">
                                            <div className="text-right"><div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">UTILIDAD</div><div className="font-black text-emerald-600 text-sm">{formatoPeso(c.total_ganancia)}</div></div>
                                            <div className="text-right"><div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">GAVETA</div><div className="font-black text-slate-900 text-sm">{formatoPeso(c.monto_cierre_sistema)}</div></div>
                                            <div className="flex gap-2 ml-4">
                                                <button onClick={() => handleExportarPDF(c)} className="w-10 h-10 bg-red-50 text-red-600 rounded-xl flex items-center justify-center shadow-sm transition-all hover:bg-red-600 hover:text-white">
                                                    <i className="bi bi-file-earmark-pdf-fill"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
            <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; } .animate-fade-in { animation: fadeIn 0.3s ease-out; } @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </div>
    );
}