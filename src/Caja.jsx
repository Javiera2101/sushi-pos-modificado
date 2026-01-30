import React, { useState, useEffect } from 'react';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  updateDoc, 
  doc,
  Timestamp 
} from 'firebase/firestore'; 

// --- CONFIGURACIÓN DE FIREBASE (Autocontenida para evitar errores de resolución) ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Función para obtener fecha YYYY-MM-DD (UTC) consistente con el sistema de guardado
const getLocalDate = () => new Date().toISOString().split('T')[0];

export default function Caja({ user: userProp }) {
    const [user, setUser] = useState(userProp || null);
    
    // Estados Financieros
    const [totalBrutoRecaudado, setTotalBrutoRecaudado] = useState(0); 
    const [totalEnvios, setTotalEnvios] = useState(0);       
    const [totalGastos, setTotalGastos] = useState(0);       
    const [montoApertura, setMontoApertura] = useState(0);
    const [idCajaAbierta, setIdCajaAbierta] = useState(null);
    const [fechaInicioCaja, setFechaInicioCaja] = useState(getLocalDate()); 
    const [cargando, setCargando] = useState(true);
    
    // Desglose por método de pago (Montos)
    const [efectivo, setEfectivo] = useState(0);
    const [tarjeta, setTarjeta] = useState(0);
    const [transferencia, setTransferencia] = useState(0);

    // Cantidad de transacciones por método
    const [conteoPagos, setConteoPagos] = useState({ Efectivo: 0, Tarjeta: 0, Transferencia: 0 });

    // Listas de datos
    const [listaVentas, setListaVentas] = useState([]);
    const [listaGastos, setListaGastos] = useState([]);
    
    // Estado de librerías externas (CDN)
    const [libsReady, setLibsReady] = useState(false);

    // Configuración de rutas
    const emailUsuario = user?.email || "";
    const esPrueba = emailUsuario === "prueba@isakari.com";
    const COL_ORDENES = esPrueba ? "ordenes_pruebas" : "ordenes";
    const COL_GASTOS = esPrueba ? "gastos_pruebas" : "gastos";
    const COL_CAJAS = esPrueba ? "cajas_pruebas" : "cajas";

    const hoyString = getLocalDate();

    // Sincronización de Auth si no viene por prop
    useEffect(() => {
        if (!userProp) {
            const unsub = onAuthStateChanged(auth, setUser);
            return () => unsub();
        }
    }, [userProp]);

    // Carga dinámica de scripts para exportación
    useEffect(() => {
        const scripts = [
            { id: 'xlsx-script', src: 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js' },
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

        Promise.all(scripts.map(loadScript))
            .then(() => setLibsReady(true))
            .catch(err => console.error("Error al cargar scripts de reporte:", err));
    }, []);

    // 1. Detectar caja abierta y su fecha de apertura
    useEffect(() => {
        if (!user) return;
        const unsubCaja = onSnapshot(collection(db, COL_CAJAS), (snap) => {
            const abierta = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .find(c => c.estado === "abierta");
            
            if (abierta) {
                setMontoApertura(Number(abierta.monto_apertura) || 0);
                setIdCajaAbierta(abierta.id);
                if (abierta.fechaString) setFechaInicioCaja(abierta.fechaString);
            } else {
                setMontoApertura(0);
                setIdCajaAbierta(null);
                setFechaInicioCaja(getLocalDate());
            }
        });
        return () => unsubCaja();
    }, [user, COL_CAJAS]);

    // 2. Escuchar Ventas y Gastos desde la apertura de caja
    useEffect(() => {
        if (!user) return;
        setCargando(true);

        const unsubVentas = onSnapshot(collection(db, COL_ORDENES), (snap) => {
            let sEfec = 0, sTarj = 0, sTrans = 0, recaudado = 0, envios = 0;
            let cEfec = 0, cTarj = 0, cTrans = 0;
            const ventasFiltradas = [];

            snap.docs.forEach(doc => {
                const data = doc.data();
                const fechaPedido = data.fechaString || "";
                const esDesdeApertura = fechaPedido >= fechaInicioCaja;
                const estaPagado = String(data.estado_pago || data.estadoPago || "").toLowerCase() === 'pagado';
                const estaEntregado = String(data.estado || "").toLowerCase() === 'entregado';

                if (esDesdeApertura && estaPagado && estaEntregado) {
                    ventasFiltradas.push({ id: doc.id, ...data });
                    const montoTotal = Number(data.total_pagado || data.total) || 0;
                    recaudado += montoTotal;
                    envios += Number(data.costo_despacho) || 0;

                    if (data.detalles_pago && Array.isArray(data.detalles_pago)) {
                        data.detalles_pago.forEach(p => {
                            const m = Number(p.monto) || 0;
                            if (p.metodo === 'Efectivo') { sEfec += m; cEfec++; }
                            else if (p.metodo === 'Tarjeta') { sTarj += m; cTarj++; }
                            else if (p.metodo === 'Transferencia') { sTrans += m; cTrans++; }
                        });
                    } else {
                        const m = data.metodo_pago || data.medioPago || 'Efectivo';
                        if(m === 'Efectivo') { sEfec += montoTotal; cEfec++; }
                        else if(m === 'Tarjeta') { sTarj += montoTotal; cTarj++; }
                        else if(m === 'Transferencia') { sTrans += montoTotal; cTrans++; }
                    }
                }
            });

            setListaVentas(ventasFiltradas.sort((a,b) => (b.numero_pedido || 0) - (a.numero_pedido || 0)));
            setTotalBrutoRecaudado(recaudado);
            setTotalEnvios(envios);
            setEfectivo(sEfec);
            setTarjeta(sTarj);
            setTransferencia(sTrans);
            setConteoPagos({ Efectivo: cEfec, Tarjeta: cTarj, Transferencia: cTrans });
            setCargando(false);
        });

        const unsubGastos = onSnapshot(collection(db, COL_GASTOS), (snap) => {
            const gastosFiltrados = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(g => (g.fechaString || "") >= fechaInicioCaja);

            setListaGastos(gastosFiltrados.sort((a,b) => (b.fecha?.toMillis ? b.fecha.toMillis() : 0) - (a.fecha?.toMillis ? a.fecha.toMillis() : 0)));
            setTotalGastos(gastosFiltrados.reduce((sum, i) => sum + (Number(i.monto)||0), 0));
        });

        return () => { unsubVentas(); unsubGastos(); };
    }, [user, fechaInicioCaja, COL_ORDENES, COL_GASTOS]);

    const totalVentasNetas = totalBrutoRecaudado - totalEnvios;
    const gananciaReal = totalVentasNetas - totalGastos;
    const efectivoEnCajon = (montoApertura + efectivo) - totalGastos;

    const formatoPeso = (v) => (v || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });

    const handleCerrarCaja = async () => {
        if (!idCajaAbierta) return;
        if (window.confirm("¿Seguro que deseas cerrar el turno?")) {
            try {
                await updateDoc(doc(db, COL_CAJAS, idCajaAbierta), {
                    estado: "cerrada",
                    fecha_cierre: Timestamp.now(),
                    monto_cierre_sistema: efectivoEnCajon,
                    total_ventas: totalBrutoRecaudado,
                    total_ganancia: gananciaReal,
                    total_gastos: totalGastos
                });
                alert("Turno cerrado con éxito.");
            } catch (e) { console.error(e); }
        }
    };

    const handleExportarPDF = () => {
        if (!libsReady || !window.jspdf) return alert("Preparando motor de PDF...");
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("ISAKARI SUSHI", 105, 15, { align: 'center' });
        doc.setFontSize(14); doc.text("REPORTE DE CIERRE DETALLADO", 105, 22, { align: 'center' });
        doc.setFontSize(10); doc.setFont("helvetica", "normal");
        doc.text(`Caja iniciada el: ${fechaInicioCaja} | Emisión: ${hoyString}`, 105, 28, { align: 'center' });

        // 1. RESUMEN FINANCIERO
        doc.setFont("helvetica", "bold"); doc.text("1. RESUMEN DE OPERACIONES", 14, 40);
        doc.autoTable({
            startY: 42,
            head: [['Concepto', 'Descripción', 'Monto']],
            body: [
                ['Ventas Netas', 'Productos entregados y pagados', formatoPeso(totalVentasNetas)],
                ['Envíos / Repartidores', 'Monto destinado a delivery', formatoPeso(totalEnvios)],
                ['Gastos del Turno', 'Egresos registrados', formatoPeso(totalGastos)],
                ['GANANCIA REAL', 'Utilidad final neta', formatoPeso(gananciaReal)]
            ],
            theme: 'grid', headStyles: { fillColor: [16, 185, 129] }
        });

        // 2. ARQUEO DE EFECTIVO
        doc.setFont("helvetica", "bold"); doc.text("2. ARQUEO DE EFECTIVO", 14, doc.lastAutoTable.finalY + 12);
        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 15,
            head: [['Concepto', 'Cálculo', 'Monto']],
            body: [
                ['Fondo de Apertura', 'Saldo inicial en caja', formatoPeso(montoApertura)],
                ['Ingresos Efectivo (+)', 'Ventas pagadas en efectivo', formatoPeso(efectivo)],
                ['Gastos Pagados (-)', 'Salidas desde el cajón', `-${formatoPeso(totalGastos)}`],
                ['TOTAL EN CAJÓN', 'Saldo físico esperado', formatoPeso(efectivoEnCajon)]
            ],
            theme: 'striped', headStyles: { fillColor: [30, 41, 59] }
        });

        // 3. DESGLOSE POR TIPO DE PAGO
        doc.setFont("helvetica", "bold"); doc.text("3. DESGLOSE POR TIPO DE PAGO", 14, doc.lastAutoTable.finalY + 12);
        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 15,
            head: [['Medio de Pago', 'Nº Transacciones', 'Monto Total']],
            body: [
                ['Efectivo', conteoPagos.Efectivo, formatoPeso(efectivo)],
                ['Tarjeta (Débito/Crédito)', conteoPagos.Tarjeta, formatoPeso(tarjeta)],
                ['Transferencia Bancaria', conteoPagos.Transferencia, formatoPeso(transferencia)],
                ['TOTALES', listaVentas.length, formatoPeso(totalBrutoRecaudado)]
            ],
            theme: 'grid', headStyles: { fillColor: [59, 130, 246] }
        });

        // 4. DETALLE DE VENTAS (CON PRODUCTOS)
        doc.setFont("helvetica", "bold"); doc.text("4. DETALLE DE VENTAS PAGADAS", 14, doc.lastAutoTable.finalY + 12);
        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 15,
            head: [['Nº', 'Hora', 'Cliente', 'Detalle de Productos', 'Total']],
            body: listaVentas.map(v => [
              v.numero_pedido || '-', 
              v.hora_pedido || '-', 
              v.nombre_cliente || 'Anónimo', 
              v.items ? v.items.map(i => `${i.cantidad}x ${i.nombre}`).join(', ') : 'Sin detalle',
              formatoPeso(v.total_pagado || v.total)
            ]),
            theme: 'striped', styles: { fontSize: 7 },
            columnStyles: { 3: { cellWidth: 70 } }
        });

        // 5. DETALLE DE GASTOS
        if (listaGastos.length > 0) {
            doc.addPage();
            doc.setFont("helvetica", "bold"); doc.text("5. DETALLE DE GASTOS Y EGRESOS", 14, 20);
            doc.autoTable({
                startY: 25,
                head: [['Descripción / Motivo', 'Hora', 'Monto']],
                body: listaGastos.map(g => [
                    g.descripcion || 'Sin descripción',
                    g.fecha?.seconds ? new Date(g.fecha.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-',
                    `-${formatoPeso(g.monto)}`
                ]),
                theme: 'grid', headStyles: { fillColor: [225, 29, 72] }, styles: { fontSize: 8 }
            });
        }

        doc.save(`Reporte_Isakari_${fechaInicioCaja}.pdf`);
    };

    if (cargando) return <div className="h-full flex items-center justify-center font-black uppercase text-slate-400 animate-pulse">Sincronizando Isakari...</div>;

    return (
        <div className="flex flex-col h-full bg-slate-100 p-6 font-sans overflow-hidden text-gray-800">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase leading-none">Caja Isakari</h2>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                        {idCajaAbierta ? `Caja abierta desde: ${fechaInicioCaja}` : "Turno Cerrado"}
                    </span>
                </div>
                <div className="flex gap-2">
                    <button onClick={handleExportarPDF} className="bg-white border-2 border-slate-200 text-red-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-red-50 transition-all flex items-center gap-2">
                        <i className="bi bi-file-pdf"></i> REPORTE PDF
                    </button>
                    <button onClick={handleCerrarCaja} disabled={!idCajaAbierta} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase shadow-lg transition-all ${idCajaAbierta ? 'bg-slate-900 text-white hover:bg-black' : 'bg-slate-200 text-slate-400'}`}>CERRAR TURNO</button>
                </div>
            </div>

            {/* DASHBOARD INDICADORES */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-emerald-600 p-5 rounded-[2rem] shadow-xl text-white border border-emerald-700">
                    <span className="text-[9px] font-black uppercase opacity-70 tracking-widest">Ventas Netas</span>
                    <div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalVentasNetas)}</div>
                </div>
                <div className="bg-orange-600 p-5 rounded-[2rem] shadow-xl text-white border border-orange-700">
                    <span className="text-[9px] font-black uppercase opacity-70 tracking-widest">Envíos</span>
                    <div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalEnvios)}</div>
                </div>
                <div className="bg-rose-600 p-5 rounded-[2rem] shadow-xl text-white border border-rose-700">
                    <span className="text-[9px] font-black uppercase opacity-70 tracking-widest">Gastos</span>
                    <div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalGastos)}</div>
                </div>
                <div className="bg-slate-900 p-5 rounded-[2rem] shadow-2xl text-white border border-slate-800">
                    <span className="text-[9px] font-black uppercase opacity-70 tracking-widest">Utilidad</span>
                    <div className="text-2xl font-black tracking-tighter">{formatoPeso(gananciaReal)}</div>
                </div>
            </div>

            {/* ARQUEO */}
            <div className="bg-white rounded-[2.5rem] border-2 border-slate-100 p-1 shadow-sm mb-6">
                <div className="flex items-center justify-around py-4 px-8 flex-wrap gap-4 bg-slate-50/50 rounded-[2.2rem]">
                    <div className="text-center">
                        <small className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Apertura</small>
                        <span className="font-black text-slate-700 text-lg">{formatoPeso(montoApertura)}</span>
                    </div>
                    <div className="text-center">
                        <small className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Efectivo (+)</small>
                        <span className="font-black text-emerald-600 text-lg">{formatoPeso(efectivo)}</span>
                    </div>
                    <div className="text-center">
                        <small className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Gastos (-)</small>
                        <span className="font-black text-rose-600 text-lg">{formatoPeso(totalGastos)}</span>
                    </div>
                    <div className="bg-slate-900 text-white px-10 py-3 rounded-2xl text-center shadow-2xl group">
                        <small className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-0.5">DINERO EN CAJÓN</small>
                        <span className="font-black text-xl tracking-tighter">{formatoPeso(efectivoEnCajon)}</span>
                    </div>
                </div>
            </div>

            {/* TABLAS UI */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 overflow-hidden">
                <div className="bg-white rounded-[2rem] border-2 border-slate-200 flex flex-col overflow-hidden shadow-sm">
                    <div className="p-4 border-b bg-gray-50 flex justify-between items-center text-[10px] font-black uppercase text-slate-500 tracking-widest">
                        Ventas Entregadas
                        <span className="bg-slate-900 text-white text-[9px] px-3 py-1 rounded-full">{listaVentas.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                        {listaVentas.map(v => (
                            <div key={v.id} className="flex justify-between items-center p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                                <div className="max-w-[70%]">
                                    <div className="text-[11px] font-black uppercase leading-none mb-1">#{v.numero_pedido} {v.nombre_cliente}</div>
                                    <div className="text-[9px] text-slate-400 font-bold truncate">
                                        {v.items ? v.items.map(i => `${i.cantidad}x ${i.nombre}`).join(', ') : 'Sin detalle'}
                                    </div>
                                    <div className="text-[8px] text-emerald-500 font-black uppercase mt-1">{v.metodo_pago}</div>
                                </div>
                                <div className="text-[12px] font-black text-slate-900">{formatoPeso(v.total_pagado || v.total)}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-white rounded-[2rem] border-2 border-slate-200 flex flex-col overflow-hidden shadow-sm">
                    <div className="p-4 border-b bg-gray-50 flex justify-between items-center text-[10px] font-black uppercase text-slate-500 tracking-widest">
                        Gastos
                        <span className="bg-rose-100 text-rose-600 text-[9px] px-3 py-1 rounded-full">{listaGastos.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                        {listaGastos.map(g => (
                            <div key={g.id} className="flex justify-between items-center p-3 bg-rose-50/30 rounded-xl border border-rose-100">
                                <div className="text-[11px] font-black uppercase text-slate-700">{g.descripcion}</div>
                                <div className="text-[12px] font-black text-rose-600">-{formatoPeso(g.monto)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* DESGLOSE INFERIOR POR MEDIO DE PAGO (Información mantenida según solicitud) */}
            <div className="mt-6 flex justify-center gap-4">
                {[{l:'Efectivo', v:efectivo, c:'bg-emerald-500'}, {l:'Tarjeta', v:tarjeta, c:'bg-blue-500'}, {l:'Transf.', v:transferencia, c:'bg-indigo-500'}].map((m,i)=>(
                    <div key={i} className="flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm transition-transform hover:-translate-y-1">
                        <div className={`w-2 h-2 rounded-full ${m.c}`}></div>
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{m.l}:</span>
                        <span className="text-[11px] font-black text-slate-800 tracking-tighter">{formatoPeso(m.v)}</span>
                    </div>
                ))}
            </div>

            <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }`}</style>
        </div>
    );
}