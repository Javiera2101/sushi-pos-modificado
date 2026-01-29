import React, { useState, useEffect } from 'react';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  getDocs, 
  updateDoc, 
  doc,
  Timestamp 
} from 'firebase/firestore'; 

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'sushi';

const getLocalDate = () => new Date().toISOString().split('T')[0];

export const Caja = () => {
    // Totales base
    const [totalBrutoRecaudado, setTotalBrutoRecaudado] = useState(0); 
    const [totalEnvios, setTotalEnvios] = useState(0);       
    const [totalGastos, setTotalGastos] = useState(0);       
    
    // Control Caja
    const [montoApertura, setMontoApertura] = useState(0);
    const [idCajaAbierta, setIdCajaAbierta] = useState(null);
    const [cargando, setCargando] = useState(true);
    
    // Desglose
    const [efectivo, setEfectivo] = useState(0);
    const [tarjeta, setTarjeta] = useState(0);
    const [transferencia, setTransferencia] = useState(0);

    // Listas
    const [listaVentas, setListaVentas] = useState([]);
    const [listaGastos, setListaGastos] = useState([]);

    // Scripts cargados
    const [libsReady, setLibsReady] = useState(false);

    const emailUsuario = auth.currentUser ? auth.currentUser.email : "";
    const esPrueba = emailUsuario === "prueba@isakari.com";
    const COL_ORDENES = esPrueba ? "ordenes_pruebas" : "ordenes";
    const COL_GASTOS = "gastos";
    const COL_CAJAS = esPrueba ? "cajas_pruebas" : "cajas";

    const hoyString = getLocalDate();

    // Carga dinámica de librerías para exportación
    useEffect(() => {
        const loadScripts = async () => {
            const scripts = [
                { id: 'xlsx-script', src: 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js' },
                { id: 'jspdf-script', src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' },
                { id: 'jspdf-autotable-script', src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js' }
            ];

            const loadScript = (data) => new Promise((resolve) => {
                if (document.getElementById(data.id)) return resolve();
                const script = document.createElement('script');
                script.id = data.id;
                script.src = data.src;
                script.async = false;
                script.onload = () => resolve();
                document.head.appendChild(script);
            });

            try {
                for (const s of scripts) {
                    await loadScript(s);
                }
                setLibsReady(true);
            } catch (err) {
                console.error("Error cargando librerías:", err);
            }
        };
        loadScripts();
    }, []);

    useEffect(() => {
        setCargando(true);

        const qCaja = query(collection(db, COL_CAJAS), where("estado", "==", "abierta"));
        const unsubCaja = onSnapshot(qCaja, (snap) => {
            if (!snap.empty) {
                const d = snap.docs[0].data();
                setMontoApertura(Number(d.monto_apertura) || 0);
                setIdCajaAbierta(snap.docs[0].id);
            } else {
                setMontoApertura(0);
                setIdCajaAbierta(null);
            }
        });

        const qVentas = query(collection(db, COL_ORDENES), where("fechaString", "==", hoyString));
        const unsubVentas = onSnapshot(qVentas, (snap) => {
            let sEfec = 0, sTarj = 0, sTrans = 0, recaudado = 0, envios = 0;
            const ventasRaw = [];

            snap.docs.forEach(doc => {
                const data = doc.data();
                if (data.estado_pago === 'Pagado' || data.estadoPago === 'Pagado') {
                    ventasRaw.push({ id: doc.id, ...data });
                    recaudado += Number(data.total_pagado || data.total) || 0;
                    envios += Number(data.costo_despacho) || 0;

                    if (data.detalles_pago) {
                        data.detalles_pago.forEach(p => {
                            const m = Number(p.monto) || 0;
                            if (p.metodo === 'Efectivo') sEfec += m;
                            else if (p.metodo === 'Tarjeta') sTarj += m;
                            else if (p.metodo === 'Transferencia') sTrans += m;
                        });
                    } else if (data.desglosePago) {
                        sEfec += Number(data.desglosePago.Efectivo) || 0;
                        sTarj += Number(data.desglosePago.Tarjeta) || 0;
                        sTrans += Number(data.desglosePago.Transferencia) || 0;
                    } else {
                        const m = data.metodo_pago || data.medioPago || 'Efectivo';
                        const val = Number(data.total_pagado || data.total) || 0;
                        if(m === 'Efectivo') sEfec += val;
                        else if(m === 'Tarjeta') sTarj += val;
                        else sTrans += val;
                    }
                }
            });
            ventasRaw.sort((a,b) => (b.numero_pedido || 0) - (a.numero_pedido || 0));
            setListaVentas(ventasRaw);
            setTotalBrutoRecaudado(recaudado);
            setTotalEnvios(envios);
            setEfectivo(sEfec);
            setTarjeta(sTarj);
            setTransferencia(sTrans);
            setCargando(false);
        });

        const qGastos = query(collection(db, COL_GASTOS), where("fechaString", "==", hoyString));
        const unsubGastos = onSnapshot(qGastos, (snap) => {
            const gRaw = snap.docs.map(d => ({id: d.id, ...d.data()}));
            gRaw.sort((a,b) => (b.fecha?.seconds||0) - (a.fecha?.seconds||0));
            setListaGastos(gRaw);
            setTotalGastos(gRaw.reduce((sum, i) => sum + (Number(i.monto)||0), 0));
        });

        return () => { unsubCaja(); unsubVentas(); unsubGastos(); };
    }, [hoyString, COL_ORDENES, COL_CAJAS]);

    // CÁLCULOS SOLICITADOS
    const totalVentasNetas = totalBrutoRecaudado - totalEnvios;
    const gananciaReal = totalVentasNetas - totalGastos;
    const efectivoEnCajon = (montoApertura + efectivo) - totalGastos;

    const formatoPeso = (v) => v.toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });

    const handleCerrarCaja = async () => {
        if (!idCajaAbierta) return;
        if (window.confirm("¿Seguro que deseas cerrar el turno?")) {
            try {
                await updateDoc(doc(db, COL_CAJAS, idCajaAbierta), {
                    estado: "cerrada",
                    fecha_cierre: Timestamp.now(),
                    monto_cierre_sistema: efectivoEnCajon,
                    total_ventas: totalBrutoRecaudado,
                    total_ganancia: gananciaReal
                });
                alert("Turno cerrado con éxito.");
            } catch (e) { alert("Error al cerrar caja"); }
        }
    };

    const handleExportarExcel = () => {
        if (!libsReady || !window.XLSX) return alert("Cargando herramientas...");
        const XLSX = window.XLSX;
        const wb = XLSX.utils.book_new();
        
        const resumenData = [
            ["REPORTE DE CAJA", hoyString], [],
            ["CÁLCULOS DE VENTAS", ""],
            ["(+) Total Recaudado Bruto", totalBrutoRecaudado],
            ["(-) Total Envíos", totalEnvios],
            ["(=) TOTAL RECAUDADO (Ventas Netas)", totalVentasNetas],
            ["(-) Gastos", totalGastos],
            ["(=) GANANCIA REAL", gananciaReal],
            [],
            ["ARQUEO DE EFECTIVO", ""],
            ["(+) Fondo Inicial", montoApertura],
            ["(+) Ventas Efectivo", efectivo],
            ["(-) Gastos", totalGastos],
            ["(=) EFECTIVO EN CAJÓN", efectivoEnCajon]
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenData), "Resumen");

        const ventasExcel = listaVentas.map(v => ({
            "Nº": v.numero_pedido,
            "Hora": v.hora_pedido,
            "Cliente": v.nombre_cliente || 'Anónimo',
            "Detalle": v.items ? v.items.map(i => `(${i.cantidad}) ${i.nombre}`).join(', ') : '',
            "Pago": v.metodo_pago || v.medioPago,
            "Total": v.total_pagado || v.total
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ventasExcel), "Ventas");

        XLSX.writeFile(wb, `Reporte_Caja_${hoyString}.xlsx`);
    };

    const handleExportarPDF = () => {
        if (!libsReady || !window.jspdf) return alert("Preparando herramientas de PDF...");
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFontSize(18); doc.text("ISAKARI SUSHI - REPORTE DE CAJA", 105, 15, {align:'center'});
        doc.setFontSize(10); doc.text(`Fecha: ${hoyString}`, 105, 22, {align:'center'});
        
        doc.setFontSize(12); doc.text("1. Resumen de Operaciones", 14, 32);
        doc.autoTable({
            startY: 35,
            head: [['Concepto', 'Cálculo', 'Monto']],
            body: [
                ['Ventas Netas', 'Recaudado Bruto - Envíos', formatoPeso(totalVentasNetas)],
                ['Gastos', 'Salidas registradas', formatoPeso(totalGastos)],
                ['GANANCIA REAL', 'Ventas Netas - Gastos', formatoPeso(gananciaReal)],
                ['Efectivo en Cajón', 'Saldo final en efectivo', formatoPeso(efectivoEnCajon)]
            ],
            theme: 'grid',
            headStyles: { fillColor: [44, 62, 80] }
        });

        doc.text("2. Detalle de Ventas Pagadas", 14, doc.lastAutoTable.finalY + 10);
        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 13,
            head: [['#', 'Hora', 'Detalle Pedido', 'Pago', 'Total']],
            body: listaVentas.map(v => [
                v.numero_pedido, 
                v.hora_pedido, 
                v.items ? v.items.map(i => `(${i.cantidad}) ${i.nombre}`).join(', ') : '',
                v.metodo_pago || v.medioPago, 
                formatoPeso(v.total_pagado || v.total)
            ]),
            theme: 'striped',
            styles: { fontSize: 7 }
        });

        doc.save(`Reporte_Caja_${hoyString}.pdf`);
    };

    if (cargando) return <div className="h-full flex items-center justify-center text-gray-400 font-black animate-pulse uppercase tracking-widest">Cargando reporte...</div>;

    return (
        <div className="flex flex-col h-full bg-slate-50 p-6 font-sans overflow-hidden text-gray-800">
            {/* CABECERA */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-3xl font-black text-gray-900 tracking-tighter uppercase leading-none">Caja Isakari</h2>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1 inline-block">Fecha: {hoyString}</span>
                </div>
                <div className="flex gap-2">
                    <button onClick={handleExportarExcel} className="bg-green-600 text-white px-3 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-green-700 transition-all flex items-center gap-2 shadow-sm">
                        <i className="bi bi-file-excel"></i> Excel
                    </button>
                    <button onClick={handleExportarPDF} className="bg-red-600 text-white px-3 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-red-700 transition-all flex items-center gap-2 shadow-sm">
                        <i className="bi bi-file-pdf"></i> PDF
                    </button>
                    <button onClick={handleCerrarCaja} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-black transition-all flex items-center gap-2 ml-4">
                        <i className="bi bi-door-closed-fill"></i> Cerrar Turno
                    </button>
                </div>
            </div>

            {/* INDICADORES CLAVE MEJORADOS (COLOR SÓLIDO Y TEXTO BLANCO) */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-green-600 p-5 rounded-[1.5rem] border border-green-700 shadow-lg shadow-green-100 transition-transform hover:scale-[1.02]">
                    <span className="text-[9px] font-black text-green-100 uppercase tracking-widest">Recaudación Neta</span>
                    <div className="text-2xl font-black text-white tracking-tighter mt-1">{formatoPeso(totalVentasNetas)}</div>
                    <small className="text-[8px] text-green-200 font-bold uppercase">Sin envíos</small>
                </div>
                
                <div className="bg-orange-600 p-5 rounded-[1.5rem] border border-orange-700 shadow-lg shadow-orange-100 transition-transform hover:scale-[1.02]">
                    <span className="text-[9px] font-black text-orange-100 uppercase tracking-widest">A Repartidores</span>
                    <div className="text-2xl font-black text-white tracking-tighter mt-1">{formatoPeso(totalEnvios)}</div>
                    <small className="text-[8px] text-orange-200 font-bold uppercase">Total envíos</small>
                </div>
                
                <div className="bg-red-600 p-5 rounded-[1.5rem] border border-red-700 shadow-lg shadow-red-100 transition-transform hover:scale-[1.02]">
                    <span className="text-[9px] font-black text-red-100 uppercase tracking-widest">Gastos del Día</span>
                    <div className="text-2xl font-black text-white tracking-tighter mt-1">{formatoPeso(totalGastos)}</div>
                    <small className="text-[8px] text-red-200 font-bold uppercase">Salidas de caja</small>
                </div>
                
                <div className="bg-blue-600 p-5 rounded-[1.5rem] border border-blue-700 shadow-lg shadow-blue-100 transition-transform hover:scale-[1.02]">
                    <span className="text-[9px] font-black text-blue-100 uppercase tracking-widest">Ganancia Real</span>
                    <div className="text-2xl font-black text-white tracking-tighter mt-1">{formatoPeso(gananciaReal)}</div>
                    <small className="text-[8px] text-blue-200 font-bold uppercase">Neto - Gastos</small>
                </div>
            </div>

            {/* ARQUEO DE EFECTIVO */}
            <div className="bg-white rounded-[2rem] border border-slate-200 p-1 shadow-sm mb-6">
                <div className="flex items-center justify-around py-4 px-6 flex-wrap gap-4 bg-slate-50/50 rounded-[1.8rem]">
                    <div className="text-center">
                        <small className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Fondo Inicial</small>
                        <span className="font-black text-gray-900 text-lg">{formatoPeso(montoApertura)}</span>
                    </div>
                    <div className="text-gray-300 font-light text-2xl">+</div>
                    <div className="text-center">
                        <small className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Ventas Efec.</small>
                        <span className="font-black text-green-600 text-lg">{formatoPeso(efectivo)}</span>
                    </div>
                    <div className="text-gray-300 font-light text-2xl">-</div>
                    <div className="text-center">
                        <small className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Gastos</small>
                        <span className="font-black text-red-600 text-lg">{formatoPeso(totalGastos)}</span>
                    </div>
                    <div className="text-gray-300 font-light text-2xl">=</div>
                    <div className="bg-slate-900 text-white px-8 py-3 rounded-2xl text-center shadow-xl">
                        <small className="block text-[8px] font-black text-white/50 uppercase tracking-widest mb-0.5">DINERO EN CAJÓN</small>
                        <span className="font-black text-xl tracking-tighter">{formatoPeso(efectivoEnCajon)}</span>
                    </div>
                </div>
            </div>

            {/* TABLAS DE DETALLE */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 overflow-hidden">
                <div className="flex flex-col bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                    <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                        <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 m-0">Ventas Pagadas</h4>
                        <span className="bg-green-100 text-green-700 text-[8px] font-black px-2 py-0.5 rounded-full uppercase">{listaVentas.length} Transacciones</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {listaVentas.map(v => (
                            <div key={v.id} className="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl border border-slate-100 hover:bg-white transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center font-black text-[10px] text-gray-400 shadow-sm">#{v.numero_pedido}</div>
                                    <div>
                                        <div className="text-[11px] font-black text-gray-800 uppercase leading-none">{v.nombre_cliente || 'Sin nombre'}</div>
                                        <div className="text-[9px] text-gray-400 font-bold mt-1 uppercase tracking-tighter">{v.metodo_pago || v.medioPago} • {v.hora_pedido}</div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[12px] font-black text-gray-900 tracking-tighter">{formatoPeso(v.total_pagado || v.total)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
                    <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                        <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 m-0">Gastos</h4>
                        <span className="bg-red-100 text-red-700 text-[8px] font-black px-2 py-0.5 rounded-full uppercase">{listaGastos.length} Movimientos</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {listaGastos.map(g => (
                            <div key={g.id} className="flex items-center justify-between p-3 bg-red-50/30 rounded-xl border border-red-100/50 hover:bg-white transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-red-400 shadow-sm"><i className="bi bi-arrow-down-short text-lg"></i></div>
                                    <div>
                                        <div className="text-[11px] font-black text-gray-800 uppercase leading-none">{g.descripcion}</div>
                                        <div className="text-[9px] text-gray-400 font-bold mt-1 uppercase tracking-tighter">{new Date(g.fecha.seconds*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                    </div>
                                </div>
                                <div className="text-[12px] font-black text-red-600 tracking-tighter">-{formatoPeso(g.monto)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* DESGLOSE INFERIOR POR MEDIO PAGO */}
            <div className="mt-6 flex justify-center gap-4">
                {[
                    { label: 'Efectivo', val: efectivo, color: 'bg-green-500' },
                    { label: 'Tarjeta', val: tarjeta, color: 'bg-blue-500' },
                    { label: 'Transf.', val: transferencia, color: 'bg-purple-500' }
                ].map((medio, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-gray-100 shadow-sm">
                        <div className={`w-2 h-2 rounded-full ${medio.color}`}></div>
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{medio.label}:</span>
                        <span className="text-xs font-black text-gray-700 tracking-tighter">{formatoPeso(medio.val)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Caja;