import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  Timestamp,
  getDocs,
  where, 
  orderBy,
  deleteDoc,
  enableIndexedDbPersistence
} from 'firebase/firestore';

// --- CONFIGURACIÓN E INICIALIZACIÓN DE FIREBASE ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "", authDomain: "", projectId: "", storageBucket: "", messagingSenderId: "", appId: "" };

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'sushi-pos-app';

// Persistencia offline
try {
  if (typeof window !== 'undefined' && !window.__isakariPersistenceSet) {
    window.__isakariPersistenceSet = true;
    enableIndexedDbPersistence(db).catch(() => {});
  }
} catch (e) {}

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

export default function App({ user: initialUser }) {
    const [notificacion, setNotificacion] = useState(null);
    const notificar = (msg, tipo = 'success') => {
        setNotificacion({ msg, tipo });
        setTimeout(() => setNotificacion(null), 3000);
    };

    const [user, setUser] = useState(initialUser || null);
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
        const initAuth = async () => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else if (!auth.currentUser) {
                    await signInAnonymously(auth).catch(() => {});
                }
            } catch (e) {}
        };
        initAuth();
        const unsubscribe = onAuthStateChanged(auth, setUser);
        return () => unsubscribe();
    }, []);

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
        const boxesRef = collection(db, COL_CAJAS);
        const qBox = query(boxesRef, orderBy("fecha_apertura", "desc"));

        const unsub = onSnapshot(qBox, (snap) => {
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
            setCajasAnteriores(docs.filter(c => c.estado === "cerrada"));
            setCargando(false);
        }, (err) => setCargando(false));
        return () => unsub();
    }, [user, COL_CAJAS]);

    useEffect(() => {
        if (!user) return;
        
        const ordersRef = collection(db, COL_ORDENES);
        const qVentas = query(ordersRef, where("fechaString", "==", fechaInicioCaja));

        const unsubVentas = onSnapshot(qVentas, (snap) => {
            let sEfec = 0, sTrans = 0, sDeb = 0, recaudado = 0, tEnv = 0;
            const actuales = [], pendientes = [];
            
            snap.docs.forEach(docSnap => {
                const raw = docSnap.data();
                const d = { id: docSnap.id, ...raw };
                const isPaid = String(raw.estado_pago || "").toLowerCase() === 'pagado';

                if (isPaid) {
                    const detalles = d.detalles_pago || [{ metodo: d.metodo_pago, monto: d.total_pagado || d.total }];
                    detalles.forEach(p => {
                        const m = Number(p.monto) || 0;
                        const met = String(p.metodo || '').toLowerCase();
                        if (met.includes('efectivo')) sEfec += m;
                        else if (met.includes('transferencia')) sTrans += m;
                        else sDeb += m; 
                    });
                    actuales.push(d);
                    recaudado += (Number(d.total_pagado) || Number(d.total) || 0);
                    tEnv += (Number(d.costo_despacho) || 0);
                } else {
                    pendientes.push(d);
                }
            });

            if (idCajaAbierta) {
                setListaVentas(actuales.sort((a,b) => (a.numero_pedido || 0) - (b.numero_pedido || 0)));
                setOrdenesNoPagadasHoy(pendientes);
                setTotalBrutoRecaudado(recaudado);
                setTotalEnvios(tEnv);
                setEfectivoRecaudadoTotal(sEfec); 
                setTransferencia(sTrans);
                setDebito(sDeb);
            }
        });

        const expensesRef = collection(db, COL_GASTOS);
        const qGastos = query(expensesRef, where("fechaString", "==", fechaInicioCaja));

        const unsubGastos = onSnapshot(qGastos, (snap) => {
            if (idCajaAbierta) {
                const turno = snap.docs.map(d => ({ ...d.data(), id: d.id }));
                setListaGastos(turno);
                setTotalGastos(turno.reduce((sum, i) => sum + (Number(i.monto)||0), 0));
            }
        });

        return () => { unsubVentas(); unsubGastos(); };
    }, [user, idCajaAbierta, fechaInicioCaja, COL_ORDENES, COL_GASTOS]);

    useEffect(() => {
        const netas = totalBrutoRecaudado - totalEnvios;
        setTotalVentasNetas(netas);
        setGananciaReal(netas - totalGastos);
        setEfectivoEnCajon((montoApertura + efectivoRecaudadoTotal) - totalGastos);
    }, [totalBrutoRecaudado, totalEnvios, totalGastos, montoApertura, efectivoRecaudadoTotal]);

    const handleExportarPDF = async (cajaData = null) => {
        if (!libsReady) {
            notificar("Librerías PDF cargando...", "error");
            return;
        }

        notificar("Generando reporte...", "info");

        const targetFecha = cajaData ? cajaData.fechaString : fechaInicioCaja;
        const data = cajaData || { 
            fechaString: targetFecha, total_ventas_netas: totalVentasNetas,
            total_envios: totalEnvios, total_gastos: totalGastos, 
            total_ganancia: gananciaReal, monto_cierre_sistema: efectivoEnCajon, 
            monto_apertura: montoApertura, total_efectivo: efectivoRecaudadoTotal,
            total_transferencia: transferencia, total_debito: debito
        };

        let rawMovs = [];
        let rawGastos = [];

        try {
            // Búsqueda profunda de Órdenes
            const qOrders = query(collection(db, COL_ORDENES), where("fechaString", "==", targetFecha));
            const snapOrders = await getDocs(qOrders);
            rawMovs = snapOrders.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(o => String(o.estado_pago).toLowerCase() === 'pagado')
                .sort((a, b) => (a.numero_pedido || 0) - (b.numero_pedido || 0));

            // Búsqueda profunda de Gastos
            const qExpenses = query(collection(db, COL_GASTOS), where("fechaString", "==", targetFecha));
            const snapExpenses = await getDocs(qExpenses);
            rawGastos = snapExpenses.docs.map(d => ({ id: d.id, ...d.data() }));

            // Fallback si no hay órdenes en DB (usamos respaldo de la caja)
            if (rawMovs.length === 0 && cajaData && cajaData.movimientos_cierre) {
                rawMovs = cajaData.movimientos_cierre;
            }
        } catch (err) {
            console.error(err);
            rawMovs = listaVentas;
            rawGastos = listaGastos;
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF();
        
        pdf.setFontSize(16);
        pdf.setFont("helvetica", "bold");
        pdf.text("ISAKARI SUSHI - REPORTE DE CAJA", 105, 15, { align: 'center' });
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        pdf.text(`Fecha Reporte: ${data.fechaString}`, 15, 25);

        // Tabla Resumen
        pdf.autoTable({ 
            startY: 30, 
            head: [['Concepto', 'Monto']], 
            body: [
                ['Caja Inicial', formatoPeso(data.monto_apertura)], 
                ['Ventas Netas', formatoPeso(data.total_ventas_netas)], 
                ['Total Envíos', formatoPeso(data.total_envios)], 
                ['Gastos Totales', formatoPeso(data.total_gastos)], 
                ['Ganancia Real', formatoPeso(data.total_ganancia)], 
                ['EFECTIVO EN CAJA', formatoPeso(data.monto_cierre_sistema)]
            ],
            theme: 'striped',
            headStyles: { fillColor: [44, 62, 80] }
        });

        // Desglose de Pagos
        pdf.autoTable({
            startY: pdf.lastAutoTable.finalY + 10,
            head: [['Desglose de Pagos', 'Monto']],
            body: [
                ['Efectivo (Ventas)', formatoPeso(data.total_efectivo || 0)],
                ['Transferencias', formatoPeso(data.total_transferencia || 0)],
                ['Débito/Tarjetas', formatoPeso(data.total_debito || 0)]
            ],
            theme: 'striped',
            headStyles: { fillColor: [44, 62, 80] }
        });

        // DETALLE DE VENTAS
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text("DETALLE DE MOVIMIENTOS", 15, pdf.lastAutoTable.finalY + 15);
        pdf.autoTable({
            startY: pdf.lastAutoTable.finalY + 20,
            head: [['N°', 'Cliente', 'Detalle', 'Tipo', 'Envío', 'Total', 'Pago']],
            body: rawMovs.map(v => {
                const tipo = v.tipo_entrega || v.tipo || 'LOCAL';
                const envioMonto = Number(v.costo_despacho !== undefined ? v.costo_despacho : (v.envio || 0));

                return [
                    v.numero_pedido || v.numero || '-',
                    (v.nombre_cliente || v.cliente || 'CLIENTE').toUpperCase(),
                    (v.items || []).map(i => `${i.cantidad} X ${i.nombre}`).join('\n'),
                    tipo.toUpperCase(), // Solo mostramos el tipo (LOCAL/REPARTO)
                    formatoPeso(envioMonto), // El valor queda solo en esta columna
                    formatoPeso(v.total_pagado || v.total || 0),
                    v.metodo_pago || v.pago || 'N/A'
                ];
            }),
            theme: 'grid',
            headStyles: { fillColor: [44, 62, 80] },
            styles: { fontSize: 6, valign: 'middle', overflow: 'linebreak' },
            columnStyles: { 
                2: { cellWidth: 55 }, // Detalle productos
                4: { cellWidth: 20 }  // Envío
            }
        });

        // DETALLE DE GASTOS
        if (rawGastos.length > 0) {
            pdf.setFontSize(12);
            pdf.setFont("helvetica", "bold");
            pdf.text("DETALLE DE GASTOS", 15, pdf.lastAutoTable.finalY + 15);
            pdf.autoTable({
                startY: pdf.lastAutoTable.finalY + 20,
                head: [['Descripción', 'Categoría', 'Monto']],
                body: rawGastos.map(g => [
                    (g.descripcion || '').toUpperCase(),
                    (g.categoria || 'GENERAL').toUpperCase(),
                    formatoPeso(g.monto)
                ]),
                theme: 'grid',
                headStyles: { fillColor: [192, 57, 43] },
                styles: { fontSize: 8 }
            });
        }

        pdf.save(`Reporte_Caja_${data.fechaString}.pdf`);
        notificar("PDF Descargado");
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
            notificar("Caja iniciada");
            setMontoAperturaInput('');
        } catch (e) { notificar("Error al abrir", "error"); }
        finally { setProcesandoApertura(false); }
    };

    const handleCerrarCaja = async () => {
        if (!idCajaAbierta) return;
        if (!window.confirm("¿Confirma el cierre del turno actual?")) return;
        try {
            const movimientosRespaldados = listaVentas.map(v => ({
                numero: v.numero_pedido || '-',
                cliente: v.nombre_cliente || 'CLIENTE',
                items: v.items || [],
                tipo: v.tipo_entrega || 'LOCAL',
                envio: v.costo_despacho || 0,
                total: v.total_pagado || v.total || 0,
                pago: v.metodo_pago || 'N/A'
            }));

            await updateDoc(doc(db, COL_CAJAS, idCajaAbierta), { 
                estado: "cerrada", fecha_cierre: Timestamp.now(), 
                monto_cierre_sistema: efectivoEnCajon, 
                total_ventas: totalBrutoRecaudado, total_ventas_netas: totalVentasNetas,
                total_envios: totalEnvios, total_gastos: totalGastos, 
                total_ganancia: gananciaReal, monto_apertura: montoApertura,
                total_efectivo: efectivoRecaudadoTotal, total_transferencia: transferencia, total_debito: debito,
                movimientos_cierre: movimientosRespaldados
            });
            notificar("Caja cerrada exitosamente");
        } catch (e) { notificar("Error al cerrar", "error"); }
    };

    return (
        <div className="flex flex-col h-full bg-slate-100 p-4 font-sans overflow-hidden text-gray-800 relative">
            
            {notificacion && (
                <div className={`fixed top-4 right-4 z-[9999] px-6 py-4 rounded-2xl shadow-2xl font-black uppercase text-xs animate-bounce ${notificacion.tipo === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                    {notificacion.msg}
                </div>
            )}

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
                        <header className="flex items-center justify-between mb-4 flex-shrink-0 bg-white p-4 rounded-3xl shadow-sm border border-slate-200">
                            <div>
                                <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase m-0 leading-none">Caja Isakari {esPrueba ? '(TEST)' : ''}</h2>
                                <span className="text-[10px] font-bold text-slate-400 uppercase mt-1 flex items-center gap-1.5"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Turno: {fechaInicioCaja}</span>
                            </div>
                            <div className="flex gap-2"><button onClick={() => handleExportarPDF()} className="bg-slate-50 text-slate-600 border border-slate-200 px-4 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-slate-100">PDF</button><button onClick={handleCerrarCaja} className="bg-slate-900 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase shadow-lg hover:bg-black transition-all">CERRAR TURNO</button></div>
                        </header>
                        <div className="flex-1 overflow-y-auto space-y-4 pb-10 custom-scrollbar pr-2">
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                                <div className="bg-slate-500 p-4 rounded-[1.5rem] shadow-md text-white"><span className="text-[9px] font-black uppercase opacity-70">Apertura</span><div className="text-xl font-black tracking-tighter mt-1">{formatoPeso(montoApertura)}</div></div>
                                <div className="bg-emerald-600 p-4 rounded-[1.5rem] shadow-md text-white"><span className="text-[9px] font-black uppercase opacity-70">Ventas (Neto)</span><div className="text-xl font-black tracking-tighter mt-1">{formatoPeso(totalVentasNetas)}</div></div>
                                <div className="bg-orange-600 p-4 rounded-[1.5rem] shadow-md text-white"><span className="text-[9px] font-black uppercase opacity-70">Repartos</span><div className="text-xl font-black tracking-tighter mt-1">{formatoPeso(totalEnvios)}</div></div>
                                <div className="bg-rose-600 p-4 rounded-[1.5rem] shadow-md text-white"><span className="text-[9px] font-black uppercase opacity-70">Gastos</span><div className="text-xl font-black tracking-tighter mt-1">{formatoPeso(totalGastos)}</div></div>
                                <div className="bg-slate-900 p-5 rounded-[2rem] shadow-2xl text-white border-2 border-emerald-500/20"><span className="text-[10px] font-black uppercase text-emerald-400">Utilidad Turno</span><div className="text-2xl font-black tracking-tighter mt-1 text-emerald-400">{formatoPeso(gananciaReal)}</div></div>
                            </div>
                            
                            <div className="bg-slate-900 p-6 rounded-[2rem] shadow-xl text-white border-2 border-emerald-500/30 text-center">
                                <span className="text-[10px] font-black uppercase opacity-60 tracking-[0.3em] mb-1 block">EFECTIVO FÍSICO EN CAJA</span>
                                <div className="text-4xl font-black tracking-tighter">{formatoPeso(efectivoEnCajon)}</div>
                             </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm"><span className="text-[8px] font-black uppercase text-slate-400 block mb-1">Efectivo Total</span><div className="text-lg font-black text-slate-900">{formatoPeso(efectivoRecaudadoTotal)}</div></div>
                                <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm"><span className="text-[8px] font-black uppercase text-slate-400 block mb-1">Transferencias</span><div className="text-lg font-black text-blue-600">{formatoPeso(transferencia)}</div></div>
                                <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm"><span className="text-[8px] font-black uppercase text-slate-400 block mb-1">Tarjetas (Déb/Créd)</span><div className="text-lg font-black text-purple-600">{formatoPeso(debito)}</div></div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-sm h-[400px]">
                                    <div className="p-3 border-b bg-slate-50 font-black uppercase text-[10px] tracking-wider text-slate-500">Ventas Pagadas</div>
                                    <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                                        {listaVentas.map(v => (
                                            <div key={v.id} className="flex justify-between items-center p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                                                <div className="max-w-[70%]">
                                                    <div className="text-[10px] font-black uppercase truncate">#{v.numero_pedido} {v.nombre_cliente}</div>
                                                    <div className="flex gap-1.5 mt-0.5"><span className="text-[7px] text-emerald-600 font-bold bg-emerald-50 px-1 rounded uppercase">{v.metodo_pago}</span></div>
                                                </div>
                                                <div className="text-right text-[11px] font-black text-slate-900">{formatoPeso(v.total_pagado || v.total)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-sm h-[400px]">
                                    <div className="p-3 border-b bg-rose-50 font-black uppercase text-[10px] tracking-wider text-rose-500">Egresos del Turno</div>
                                    <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                                        {listaGastos.map(g => (
                                            <div key={g.id} className="flex justify-between items-center p-2.5 bg-rose-50/30 rounded-xl border border-rose-100">
                                                <div className="max-w-[70%]">
                                                    <div className="text-[10px] font-black uppercase truncate">{g.descripcion}</div>
                                                    <div className="flex gap-1.5 mt-0.5"><span className="text-[7px] text-rose-600 font-bold bg-rose-50 px-1 rounded uppercase">{g.categoria}</span></div>
                                                </div>
                                                <div className="text-right text-[11px] font-black text-rose-700">-{formatoPeso(g.monto)}</div>
                                            </div>
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
                        <div className="flex-1 overflow-y-auto space-y-3 pb-10 custom-scrollbar pr-2">
                            {cajasAnteriores.filter(c => !filtroFechaHistorial || c.fechaString === filtroFechaHistorial).map(c => (
                                <div key={c.id} className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 flex justify-between items-center hover:shadow-md transition-all">
                                    <div className="flex-1">
                                        <div className="text-lg font-black text-slate-900 tracking-tighter">{c.fechaString}</div>
                                        <div className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">{c.usuario_email}</div>
                                    </div>
                                    
                                    <div className="flex items-center gap-6">
                                        <div className="text-right">
                                            <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">EFECTIVO</div>
                                            <div className="font-black text-slate-600 text-sm">{formatoPeso(c.total_efectivo || 0)}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">TRANSF.</div>
                                            <div className="font-black text-blue-600 text-sm">{formatoPeso(c.total_transferencia || 0)}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">DÉBITO</div>
                                            <div className="font-black text-purple-600 text-sm">{formatoPeso(c.total_debito || 0)}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">VENTAS NETO</div>
                                            <div className="font-black text-emerald-600 text-sm">{formatoPeso(c.total_ventas_netas)}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">CAJA</div>
                                            <div className="font-black text-slate-900 text-sm">{formatoPeso(c.monto_cierre_sistema)}</div>
                                        </div>
                                        <div className="flex gap-2 ml-4">
                                            <button onClick={() => handleExportarPDF(c)} className="w-10 h-10 bg-red-50 text-red-600 rounded-xl flex items-center justify-center shadow-sm transition-all hover:bg-red-600 hover:text-white">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                                  <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2M9.5 3V1.1L12.9 4.5h-3.4zM4.603 12.087a.8.8 0 0 1-.438-.42c-.195-.388-.13-.776.08-1.102.166-.257.433-.446.727-.53.367-.106.767-.053 1.141.105.35.149.674.416.99.713.116.11.235.23.35.358.338.381.603.765.803 1.125.105.19.188.359.252.503.045.099.073.18.092.246.012.042.02.072.024.089l.004.013.001.004a.2.2 0 0 1-.16.25c-.012 0-.025 0-.037-.002l-.013-.004-.045-.015a1.6 1.6 0 0 1-.188-.082 3.4 3.4 0 0 1-.45-.264 4.3 4.3 0 0 1-.654-.506 8.8 8.8 0 0 1-.806-.788 12.5 12.5 0 0 1-.73-.8c-.365-.442-.69-.823-.975-1.118l-.025-.025a.5.5 0 0 1-.003-.003l-.008-.007-.001-.001a1 1 0 0 0-.256-.16c-.167-.06-.339-.09-.531-.09-.237 0-.439.045-.613.143a.6.6 0 0 0-.214.759c.15.292.445.47.723.548.357.1.726.048 1.067-.116.326-.157.6-.41.86-.69z"/>
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
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