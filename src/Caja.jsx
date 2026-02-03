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

import { db } from './firebase';
import { useUi } from './context/UiContext';

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
    
    const [vista, setVista] = useState('actual'); 
    const [filtroFechaHistorial, setFiltroFechaHistorial] = useState(''); 
    const [cargando, setCargando] = useState(true);
    const [libsReady, setLibsReady] = useState(false);

    const [idCajaAbierta, setIdCajaAbierta] = useState(null);
    const [montoApertura, setMontoApertura] = useState(0);
    const [montoAperturaInput, setMontoAperturaInput] = useState('');
    const [fechaInicioCaja, setFechaInicioCaja] = useState(getFechaChile()); 
    const [procesandoApertura, setProcesandoApertura] = useState(false);

    const [totalBrutoRecaudado, setTotalBrutoRecaudado] = useState(0); 
    const [totalVentasNetas, setTotalVentasNetas] = useState(0);     
    const [totalEnvios, setTotalEnvios] = useState(0);       
    const [totalGastos, setTotalGastos] = useState(0);       
    const [gananciaReal, setGananciaReal] = useState(0);
    const [efectivoEnCajon, setEfectivoEnCajon] = useState(0);

    const [efectivoRecaudadoTotal, setEfectivoRecaudadoTotal] = useState(0);
    const [transferencia, setTransferencia] = useState(0);
    const [debito, setDebito] = useState(0);

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

    useEffect(() => {
        if (!user) return;
        const unsubVentas = onSnapshot(collection(db, COL_ORDENES), (snap) => {
            let sEfecCajon = 0, sTrans = 0, sDeb = 0, recaudadoFinalizado = 0, tEnvFinalizado = 0;
            const actuales = [], pendientesDeCobro = [];
            
            snap.docs.forEach(docSnap => {
                const raw = docSnap.data();
                const fechaCalculada = obtenerFechaReal(raw.fecha, raw.fechaString);
                
                const d = { 
                    id: docSnap.id, 
                    ...raw,
                    fechaDisplay: fechaCalculada, 
                    estado_pago: String(raw.estado_pago || "Pendiente").trim(),
                    metodo_pago: raw.metodo_pago || "N/A",
                    total: Number(raw.total_pagado || raw.total || 0),
                    costo_despacho: Number(raw.costo_despacho || 0),
                    estado_entrega: String(raw.estado || "pendiente").toLowerCase()
                };

                const isPaid = d.estado_pago.toLowerCase() === 'pagado';
                const isDelivered = d.estado_entrega === 'entregado';
                
                if (idCajaAbierta && d.fechaDisplay === fechaInicioCaja) {
                    if (isPaid) {
                        const detalles = d.detalles_pago || [{ metodo: d.metodo_pago, monto: d.total }];
                        detalles.forEach(p => {
                            const m = Number(p.monto) || 0;
                            const met = String(p.metodo || '').toLowerCase();
                            if (met === 'efectivo') sEfecCajon += m;
                            else if (met === 'transferencia') sTrans += m;
                            else sDeb += m; 
                        });

                        if (isDelivered) {
                            actuales.push(d);
                            recaudadoFinalizado += d.total;
                            tEnvFinalizado += d.costo_despacho;
                        } else {
                            actuales.push({ ...d, info: "PAGADO - PENDIENTE" });
                        }
                    } else {
                        pendientesDeCobro.push(d);
                    }
                }
            });

            setListaVentas(actuales.sort((a,b) => (a.numero_pedido || 0) - (b.numero_pedido || 0)));
            setOrdenesNoPagadasHoy(pendientesDeCobro);
            
            setTotalBrutoRecaudado(recaudadoFinalizado);
            setTotalEnvios(tEnvFinalizado);
            
            setEfectivoRecaudadoTotal(sEfecCajon); 
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
    }, [user, idCajaAbierta, fechaInicioCaja, COL_ORDENES]);

    useEffect(() => {
        const netas = totalBrutoRecaudado - totalEnvios;
        setTotalVentasNetas(netas);
        setGananciaReal(netas - totalGastos);
        setEfectivoEnCajon((montoApertura + efectivoRecaudadoTotal) - totalGastos);
    }, [totalBrutoRecaudado, totalEnvios, totalGastos, montoApertura, efectivoRecaudadoTotal]);

    const handleExportarPDF = async (cajaData = null) => {
        if (!libsReady) return;
        const data = cajaData || { 
            fechaString: fechaInicioCaja, total_ventas: totalBrutoRecaudado, 
            total_envios: totalEnvios, total_gastos: totalGastos, 
            total_ganancia: gananciaReal, monto_cierre_sistema: efectivoEnCajon, 
            monto_apertura: montoApertura, total_ventas_netas: totalVentasNetas,
            total_efectivo: efectivoRecaudadoTotal, total_transferencia: transferencia, total_debito: debito
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

        // --- TABLA DE RESUMEN ---
        pdf.autoTable({ 
            startY: 30, 
            head: [['Concepto', 'Monto']], 
            body: [
                ['Caja Inicial', formatoPeso(data.monto_apertura)], 
                ['Ventas Netas', formatoPeso(data.total_ventas_netas)], 
                ['Total Envios', formatoPeso(data.total_envios)], 
                ['Gastos Totales', formatoPeso(data.total_gastos)], 
                ['Ganancia Real', formatoPeso(data.total_ganancia)], 
                ['EFECTIVO EN GAVETA', formatoPeso(data.monto_cierre_sistema)]
            ],
            theme: 'striped',
            headStyles: { fillColor: [44, 62, 80] },
            styles: { fontSize: 9 }
        });

        // --- TABLA DESGLOSE MÉTODOS ---
        pdf.autoTable({
            startY: pdf.lastAutoTable.finalY + 10,
            head: [['Desglose Métodos de Pago', 'Monto']],
            body: [
                ['Efectivo (Ventas)', formatoPeso(data.total_efectivo)],
                ['Transferencias', formatoPeso(data.total_transferencia)],
                ['Tarjetas (Débito/Crédito)', formatoPeso(data.total_debito)]
            ],
            theme: 'striped',
            headStyles: { fillColor: [44, 62, 80] },
            styles: { fontSize: 9 }
        });

        // --- DETALLE DE MOVIMIENTOS ---
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("DETALLE DE MOVIMIENTOS", 15, pdf.lastAutoTable.finalY + 15);

        pdf.autoTable({
            startY: pdf.lastAutoTable.finalY + 20,
            head: [['N°', 'Cliente', 'Tipo', 'Envio', 'Total', 'Pago']],
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
        if (!idCajaAbierta) return;
        if (ordenesNoPagadasHoy.length > 0) return notificar("Hay pedidos pendientes de cobro.", "error");
        
        const pendientesEntrega = listaVentas.filter(v => v.estado_entrega !== 'entregado');
        if (pendientesEntrega.length > 0) {
            if (!window.confirm(`Atención: Hay ${pendientesEntrega.length} pedidos pagados que aún no figuran como 'Entregados'. ¿Desea cerrar el turno de todas formas?`)) return;
        } else {
            if (!window.confirm("¿Confirma el cierre del turno actual?")) return;
        }

        try {
            await updateDoc(doc(db, COL_CAJAS, idCajaAbierta), { 
                estado: "cerrada", fecha_cierre: Timestamp.now(), 
                monto_cierre_sistema: efectivoEnCajon, 
                total_ventas: totalBrutoRecaudado, total_ventas_netas: totalVentasNetas,
                total_envios: totalEnvios, total_gastos: totalGastos, 
                total_ganancia: gananciaReal, monto_apertura: montoApertura,
                total_efectivo: efectivoRecaudadoTotal, total_transferencia: transferencia, total_debito: debito,
                movimientos_cierre: listaVentas.map(v => ({
                    numero: v.numero_pedido || '-',
                    cliente: v.nombre_cliente || 'CLIENTE',
                    tipo: v.tipo_entrega || 'LOCAL',
                    envio: v.costo_despacho || 0,
                    total: v.total || 0,
                    pago: v.metodo_pago || 'N/A'
                }))
            });
            notificar("Caja cerrada exitosamente", "success");
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
                            <div><h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase m-0 leading-none">Caja Isakari</h2><span className="text-[10px] font-bold text-slate-400 uppercase mt-1 flex items-center gap-1.5"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Turno: {fechaInicioCaja}</span></div>
                            <div className="flex gap-2"><button onClick={() => handleExportarPDF()} className="bg-white border-2 border-slate-200 text-red-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-sm">PDF</button><button onClick={handleCerrarCaja} className="bg-slate-900 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase shadow-lg hover:bg-black transition-all">CERRAR TURNO</button></div>
                        </header>
                        <div className="flex-1 overflow-y-auto space-y-4 pb-10 custom-scrollbar">
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                                <div className="bg-slate-500 p-5 rounded-[2rem] shadow-lg text-white"><span className="text-[10px] font-black uppercase opacity-70">Apertura</span><div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(montoApertura)}</div></div>
                                <div className="bg-emerald-600 p-5 rounded-[2rem] shadow-lg text-white" title="Solo pedidos Entregados"><span className="text-[10px] font-black uppercase opacity-70">Ventas (Neto)</span><div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalVentasNetas)}</div></div>
                                <div className="bg-orange-600 p-5 rounded-[2rem] shadow-lg text-white"><span className="text-[10px] font-black uppercase opacity-70">Repartos</span><div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalEnvios)}</div></div>
                                <div className="bg-rose-600 p-5 rounded-[2rem] shadow-lg text-white"><span className="text-[10px] font-black uppercase opacity-70">Gastos</span><div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalGastos)}</div></div>
                                <div className="bg-slate-900 p-5 rounded-[2rem] shadow-2xl text-white border-2 border-emerald-500/20" title="Utilidad de ventas finalizadas"><span className="text-[10px] font-black uppercase text-emerald-400">Utilidad Turno</span><div className="text-2xl font-black tracking-tighter mt-1 text-emerald-400">{formatoPeso(gananciaReal)}</div></div>
                            </div>
                            
                            <div className="bg-slate-900 p-8 rounded-[2.5rem] shadow-2xl text-white border-2 border-emerald-500/30 text-center relative overflow-hidden">
                                <span className="text-xs font-black uppercase opacity-60 tracking-[0.3em] mb-2 block">EFECTIVO FÍSICO EN GAVETA</span>
                                <div className="text-5xl font-black tracking-tighter">{formatoPeso(efectivoEnCajon)}</div>
                             </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm"><span className="text-[8px] font-black uppercase text-slate-400 block mb-1">Efectivo Total</span><div className="text-lg font-black text-slate-900">{formatoPeso(efectivoRecaudadoTotal)}</div></div>
                                <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm"><span className="text-[8px] font-black uppercase text-slate-400 block mb-1">Transferencias</span><div className="text-lg font-black text-blue-600">{formatoPeso(transferencia)}</div></div>
                                <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm"><span className="text-[8px] font-black uppercase text-slate-400 block mb-1">Tarjetas (Déb/Créd)</span><div className="text-lg font-black text-purple-600">{formatoPeso(debito)}</div></div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="bg-white rounded-[2rem] border border-slate-200 flex flex-col overflow-hidden min-h-[350px] shadow-sm">
                                    <div className="p-4 border-b bg-slate-50 font-black uppercase text-[10px] tracking-wider text-slate-500">Detalle de Ventas Pagadas</div>
                                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                        {listaVentas.map(v => (
                                            <div key={v.id} className="flex justify-between items-center p-3.5 bg-slate-50 rounded-2xl border border-slate-100 group transition-all hover:bg-white">
                                                <div className="max-w-[60%]">
                                                    <div className="text-[11px] font-black uppercase truncate leading-none mb-1">#{v.numero_pedido} {v.nombre_cliente}</div>
                                                    <div className="flex gap-2">
                                                        <span className="text-[8px] text-emerald-500 font-black uppercase">{v.metodo_pago}</span>
                                                        {v.info && <span className="text-[8px] text-amber-600 font-black uppercase bg-amber-50 px-1 rounded">{v.info}</span>}
                                                        {v.estado_entrega === 'entregado' && <span className="text-[8px] text-emerald-600 font-black uppercase bg-emerald-50 px-1 rounded">LISTO</span>}
                                                    </div>
                                                </div>
                                                <div className="text-right"><div className="text-[13px] font-black text-slate-900">{formatoPeso(v.total)}</div></div>
                                            </div>
                                        ))}
                                        {listaVentas.length === 0 && <div className="text-center py-20 text-slate-300 font-black uppercase text-[10px] tracking-widest">No hay ventas registradas hoy</div>}
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
                        <header className="flex justify-between items-center mb-6 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><h2 className="text-xl font-black uppercase m-0 tracking-tighter">Historial</h2><input type="date" className="text-[10px] font-black p-2 rounded-xl bg-slate-50 border-none outline-none focus:ring-2 ring-red-500" value={filtroFechaHistorial} onChange={(e) => setFiltroFechaHistorial(e.target.value)} /></header>
                        <div className="flex-1 overflow-y-auto space-y-3 pb-10 custom-scrollbar">
                            {cajasAnteriores.filter(c => !filtroFechaHistorial || c.fechaString === filtroFechaHistorial).map(c => (
                                <div key={c.id} className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 flex justify-between items-center hover:shadow-md transition-all">
                                    <div><div className="text-lg font-black text-slate-900 tracking-tighter">{c.fechaString}</div><div className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">{c.usuario_email}</div></div>
                                    <div className="flex items-center gap-6"><div className="text-right"><div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">VENTAS NETO</div><div className="font-black text-emerald-600 text-sm">{formatoPeso(c.total_ventas_netas)}</div></div><div className="text-right"><div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">GAVETA</div><div className="font-black text-slate-900 text-sm">{formatoPeso(c.monto_cierre_sistema)}</div></div><div className="flex gap-2 ml-4"><button onClick={() => handleExportarPDF(c)} className="w-10 h-10 bg-red-50 text-red-600 rounded-xl flex items-center justify-center shadow-sm transition-all hover:bg-red-600 hover:text-white"><i className="bi bi-file-earmark-pdf-fill"></i></button></div></div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; } .animate-fade-in { animation: fadeIn 0.3s ease-out; } @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </div>
    );
}