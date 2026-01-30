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
  getDocs
} from 'firebase/firestore'; 
// Se corrige la importación eliminando la extensión .jsx para asegurar la resolución en el entorno
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
 * Gestiona turnos, dinero recaudado, historial y órdenes pendientes.
 * Configurado para leer datos desde la RAÍZ de la base de datos.
 */
export default function Caja({ user: userProp }) {
    const { notificar } = useUi();
    const [user, setUser] = useState(userProp || null);
    const [authReady, setAuthReady] = useState(false);
    
    // Navegación y Filtros
    const [vista, setVista] = useState('actual'); 
    const [filtroFechaHistorial, setFiltroFechaHistorial] = useState(''); 

    // Estados de Control de Caja
    const [idCajaAbierta, setIdCajaAbierta] = useState(null);
    const [montoApertura, setMontoApertura] = useState(0);
    const [fechaInicioCaja, setFechaInicioCaja] = useState(getLocalDate()); 
    const [cargando, setCargando] = useState(true);
    
    // Acumuladores de Dinero
    const [totalBrutoRecaudado, setTotalBrutoRecaudado] = useState(0); 
    const [totalEnvios, setTotalEnvios] = useState(0);       
    const [totalGastos, setTotalGastos] = useState(0);       
    const [efectivo, setEfectivo] = useState(0);
    const [tarjeta, setTarjeta] = useState(0);
    const [transferencia, setTransferencia] = useState(0);

    // Listas de Información
    const [listaVentas, setListaVentas] = useState([]);
    const [listaGastos, setListaGastos] = useState([]);
    const [cajasAnteriores, setCajasAnteriores] = useState([]);
    const [ordenesNoPagadas, setOrdenesNoPagadas] = useState([]);
    
    // UI Apertura
    const [montoAperturaInput, setMontoAperturaInput] = useState('');
    const [procesandoApertura, setProcesandoApertura] = useState(false);
    const [libsReady, setLibsReady] = useState(false);

    // Definición de colecciones según el usuario
    const emailUsuario = user?.email || "";
    const esPrueba = emailUsuario === "prueba@isakari.com";
    const COL_ORDENES = esPrueba ? "ordenes_pruebas" : "ordenes";
    const COL_GASTOS = esPrueba ? "gastos_pruebas" : "gastos";
    const COL_CAJAS = esPrueba ? "cajas_pruebas" : "cajas";

    const hoyString = getLocalDate();

    // 0. Autenticación (Prioritaria para evitar errores de permisos)
    useEffect(() => {
        const initAuth = async () => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else if (!auth.currentUser) {
                    await signInAnonymously(auth);
                }
                setAuthReady(true);
            } catch (e) { 
                console.error("Auth init error:", e); 
            }
        };
        initAuth();
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (u) setAuthReady(true);
        });
        return () => unsubscribe();
    }, []);

    // Carga de librerías para PDF
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

    // 1. Escuchar Cajas (Desde la raíz)
    useEffect(() => {
        if (!authReady || !user) return;
        
        const path = collection(db, COL_CAJAS);
        const unsub = onSnapshot(path, (snap) => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const abierta = docs.find(c => c.estado === "abierta");
            const cerradas = docs
                .filter(c => c.estado === "cerrada")
                .sort((a, b) => (b.fecha_apertura?.seconds || 0) - (a.fecha_apertura?.seconds || 0));

            if (abierta) {
                setMontoApertura(Number(abierta.monto_apertura) || 0);
                setIdCajaAbierta(abierta.id);
                if (abierta.fechaString) setFechaInicioCaja(abierta.fechaString);
            } else {
                setMontoApertura(0);
                setIdCajaAbierta(null);
                setFechaInicioCaja(getLocalDate());
            }
            
            setCajasAnteriores(cerradas);
            setCargando(false);
        }, (err) => {
            console.error("Firestore boxes error:", err);
            setCargando(false);
        });
        return () => unsub();
    }, [authReady, user, COL_CAJAS]);

    // 2. Escuchar Ventas y Gastos (Desde la raíz)
    useEffect(() => {
        if (!authReady || !user) return;

        const pathOrdenes = collection(db, COL_ORDENES);
        const unsubVentas = onSnapshot(pathOrdenes, (snap) => {
            let sEfec = 0, sTarj = 0, sTrans = 0, recaudado = 0, envios = 0;
            const actuales = [];
            const pendientesPago = [];

            snap.docs.forEach(doc => {
                const data = doc.data();
                const pagado = String(data.estado_pago || "").toLowerCase() === 'pagado';
                const entregado = String(data.estado || "").toLowerCase() === 'entregado';
                const fecha = data.fechaString || "";
                
                // Si la caja está abierta, filtramos lo que pertenece al turno actual
                if (idCajaAbierta && fecha >= fechaInicioCaja && pagado && entregado) {
                    actuales.push({ id: doc.id, ...data });
                    const total = Number(data.total_pagado || data.total) || 0;
                    recaudado += total;
                    envios += Number(data.costo_despacho) || 0;

                    if (data.detalles_pago && Array.isArray(data.detalles_pago)) {
                        data.detalles_pago.forEach(p => {
                            const m = Number(p.monto) || 0;
                            if (p.metodo === 'Efectivo') sEfec += m;
                            else if (p.metodo === 'Tarjeta') sTarj += m;
                            else if (p.metodo === 'Transferencia') sTrans += m;
                        });
                    } else {
                        const m = data.metodo_pago || 'Efectivo';
                        if(m === 'Efectivo') sEfec += total;
                        else if(m === 'Tarjeta') sTarj += total;
                        else if(m === 'Transferencia') sTrans += total;
                    }
                }

                // Lista global de órdenes sin pagar
                if (!pagado) {
                    pendientesPago.push({ id: doc.id, ...data });
                }
            });

            setListaVentas(actuales.sort((a,b) => (b.numero_pedido || 0) - (a.numero_pedido || 0)));
            setOrdenesNoPagadas(pendientesPago.sort((a,b) => (b.fechaString || "").localeCompare(a.fechaString || "")));
            setTotalBrutoRecaudado(recaudado);
            setTotalEnvios(envios);
            setEfectivo(sEfec);
            setTarjeta(sTarj);
            setTransferencia(sTrans);
        });

        const pathGastos = collection(db, COL_GASTOS);
        const unsubGastos = onSnapshot(pathGastos, (snap) => {
            if (!idCajaAbierta) return;
            const turno = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(g => (g.fechaString || "") >= fechaInicioCaja);

            setListaGastos(turno.sort((a,b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0)));
            setTotalGastos(turno.reduce((sum, i) => sum + (Number(i.monto)||0), 0));
        });

        return () => { unsubVentas(); unsubGastos(); };
    }, [authReady, user, idCajaAbierta, fechaInicioCaja, COL_ORDENES, COL_GASTOS]);

    const totalVentasNetas = totalBrutoRecaudado - totalEnvios;
    const gananciaReal = totalVentasNetas - totalGastos;
    const efectivoEnCajon = (montoApertura + efectivo) - totalGastos;

    const formatoPeso = (v) => (v || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });

    const handleAbrirCaja = async () => {
        const monto = Number(montoAperturaInput.replace(/\D/g, ''));
        if (!montoAperturaInput || isNaN(monto)) return notificar("Monto de apertura inválido", "error");
        
        setProcesandoApertura(true);
        try {
            await addDoc(collection(db, COL_CAJAS), {
                estado: "abierta",
                monto_apertura: monto,
                fecha_apertura: Timestamp.now(),
                fechaString: hoyString,
                usuario_id: user.uid,
                usuario_email: user.email
            });
            notificar("Turno iniciado", "success");
            setMontoAperturaInput('');
        } catch (e) { 
            notificar("Error al abrir caja", "error"); 
        } finally { 
            setProcesandoApertura(false); 
        }
    };

    const handleCerrarCaja = async () => {
        if (!idCajaAbierta || !window.confirm("¿Deseas cerrar el turno?")) return;
        try {
            const ref = doc(db, COL_CAJAS, idCajaAbierta);
            await updateDoc(ref, {
                estado: "cerrada",
                fecha_cierre: Timestamp.now(),
                monto_cierre_sistema: efectivoEnCajon,
                total_ventas: totalBrutoRecaudado,
                total_gastos: totalGastos,
                total_ganancia: gananciaReal,
                monto_apertura: montoApertura
            });
            notificar("Turno cerrado con éxito", "success");
        } catch (e) { console.error(e); }
    };

    // --- REPORTE PDF CON DETALLE DE PRODUCTOS ---
    const handleExportarPDF = async (cajaData = null) => {
        if (!libsReady || !window.jspdf) return notificar("Preparando motor de PDF...", "error");
        notificar("Generando reporte con detalles...", "success");

        const isHistorical = !!cajaData;
        const fechaReporte = isHistorical ? cajaData.fechaString : fechaInicioCaja;
        
        let itemsDetallados = [];
        if (isHistorical) {
            const path = collection(db, COL_ORDENES);
            const snap = await getDocs(path);
            itemsDetallados = snap.docs
                .map(d => d.data())
                .filter(o => o.fechaString === fechaReporte && String(o.estado_pago).toLowerCase() === 'pagado');
        } else {
            itemsDetallados = listaVentas;
        }

        const data = cajaData || {
            fechaString: fechaInicioCaja,
            total_ventas: totalBrutoRecaudado,
            total_gastos: totalGastos,
            total_ganancia: gananciaReal,
            monto_cierre_sistema: efectivoEnCajon,
            monto_apertura: montoApertura
        };

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF();
        
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(20); 
        pdf.text("ISAKARI SUSHI", 105, 15, { align: 'center' });
        pdf.setFontSize(12); 
        pdf.text(`REPORTE DE CIERRE DETALLADO - ${data.fechaString}`, 105, 22, { align: 'center' });
        
        // Tabla de resumen
        pdf.autoTable({
            startY: 30,
            head: [['Concepto', 'Valor']],
            body: [
                ['Apertura de Turno', formatoPeso(data.monto_apertura)],
                ['Recaudado Total', formatoPeso(data.total_ventas)],
                ['Gastos Registrados', formatoPeso(data.total_gastos)],
                ['Utilidad del Turno', formatoPeso(data.total_ganancia)],
                ['EFECTIVO FINAL EN GAVETA', formatoPeso(data.monto_cierre_sistema)]
            ],
            theme: 'grid', headStyles: { fillColor: [30, 41, 59] }
        });

        // Detalle de Pedidos
        pdf.setFontSize(14); 
        pdf.text("DETALLE DE VENTAS", 14, pdf.lastAutoTable.finalY + 15);
        
        pdf.autoTable({
            startY: pdf.lastAutoTable.finalY + 20,
            head: [['N°', 'Cliente', 'Detalle Productos', 'Total']],
            body: itemsDetallados.map(v => [
                v.numero_pedido || '-',
                v.nombre_cliente || 'ANÓNIMO',
                v.items?.map(i => `${i.cantidad}x ${i.nombre}`).join(', ') || 'Sin detalle',
                formatoPeso(v.total_pagado || v.total)
            ]),
            theme: 'striped', headStyles: { fillColor: [16, 185, 129] },
            columnStyles: { 2: { cellWidth: 80 } }
        });

        pdf.save(`Reporte_Isakari_${data.fechaString}.pdf`);
    };

    const cajasFiltradas = filtroFechaHistorial 
        ? cajasAnteriores.filter(c => c.fechaString === filtroFechaHistorial)
        : cajasAnteriores;

    if (cargando) return <div className="h-full flex items-center justify-center font-black uppercase text-slate-400 animate-pulse tracking-widest">Sincronizando Isakari...</div>;

    return (
        <div className="flex flex-col h-full bg-slate-100 p-6 font-sans overflow-hidden text-gray-800">
            
            {/* TABS NAVEGACIÓN */}
            <div className="flex justify-center mb-8">
                <div className="bg-white rounded-full p-1.5 shadow-sm border border-slate-200 flex gap-1">
                    <button onClick={() => setVista('actual')} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase transition-all flex items-center gap-2 ${vista === 'actual' ? 'bg-red-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>
                        <i className="bi bi-cash-stack"></i> Caja Actual
                    </button>
                    <button onClick={() => setVista('historial')} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase transition-all flex items-center gap-2 ${vista === 'historial' ? 'bg-red-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>
                        <i className="bi bi-clock-history"></i> Historial
                    </button>
                    <button onClick={() => setVista('pendientes')} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase transition-all flex items-center gap-2 ${vista === 'pendientes' ? 'bg-red-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}>
                        <i className="bi bi-exclamation-triangle"></i> Sin Pagar
                    </button>
                </div>
            </div>

            {vista === 'actual' && (
                <>
                {!idCajaAbierta ? (
                    <div className="flex-1 flex items-center justify-center animate-fade-in">
                        <div className="bg-white rounded-[3.5rem] p-12 shadow-2xl border-2 border-slate-50 text-center max-w-md w-full">
                            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner"><i className="bi bi-door-open-fill text-4xl"></i></div>
                            <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-900 mb-2 leading-none">Abrir Turno</h1>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-10 text-center">Ingrese el fondo inicial para operar hoy.</p>
                            <div className="space-y-6">
                                <div className="text-left">
                                    <label className="text-[10px] font-black text-slate-400 uppercase ml-4 tracking-widest">Monto Inicial</label>
                                    <div className="flex items-center bg-slate-50 border-2 border-slate-100 rounded-[1.5rem] px-5 focus-within:border-red-500 transition-colors shadow-inner">
                                        <span className="text-2xl font-black text-slate-300">$</span>
                                        <input type="text" className="w-full p-4 bg-transparent outline-none font-black text-3xl text-slate-800" placeholder="0" value={montoAperturaInput} onChange={(e) => setMontoAperturaInput(e.target.value.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, "."))} />
                                    </div>
                                </div>
                                <button onClick={handleAbrirCaja} disabled={procesandoApertura} className="w-full py-6 bg-red-600 text-white rounded-[1.5rem] font-black uppercase tracking-widest shadow-xl shadow-red-100 hover:bg-red-700 active:scale-95 transition-all">
                                    {procesandoApertura ? 'Abriendo...' : 'Iniciar Jornada'}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
                        <header className="flex items-center justify-between mb-6">
                            <div><h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase leading-none">Caja Isakari</h2><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 flex items-center gap-2"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>Sesión activa: {fechaInicioCaja}</span></div>
                            <div className="flex gap-2">
                                <button onClick={() => handleExportarPDF()} className="bg-white border-2 border-slate-200 text-red-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-red-50 transition-all flex items-center gap-2 shadow-sm"><i className="bi bi-file-earmark-pdf-fill"></i> PDF DETALLADO</button>
                                <button onClick={handleCerrarCaja} className="bg-slate-900 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase shadow-lg hover:bg-black transition-all">CERRAR TURNO</button>
                            </div>
                        </header>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                            <div className="bg-emerald-600 p-5 rounded-[2rem] shadow-xl text-white border border-emerald-700"><span className="text-[9px] font-black uppercase opacity-70 tracking-widest">Ventas Netas</span><div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalVentasNetas)}</div></div>
                            <div className="bg-orange-600 p-5 rounded-[2rem] shadow-xl text-white border border-orange-700"><span className="text-[9px] font-black uppercase opacity-70 tracking-widest">Envíos</span><div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalEnvios)}</div></div>
                            <div className="bg-rose-600 p-5 rounded-[2rem] shadow-xl text-white border border-rose-700"><span className="text-[9px] font-black uppercase opacity-70 tracking-widest">Gastos</span><div className="text-2xl font-black tracking-tighter mt-1">{formatoPeso(totalGastos)}</div></div>
                            <div className="bg-slate-900 p-5 rounded-[2rem] shadow-2xl text-white border border-slate-800"><span className="text-[9px] font-black uppercase opacity-70 tracking-widest">Utilidad</span><div className="text-2xl font-black tracking-tighter">{formatoPeso(gananciaReal)}</div></div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div className="bg-white p-5 rounded-[2rem] shadow-sm border-2 border-slate-50 flex items-center justify-between"><div><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Efectivo</span><div className="text-xl font-black text-slate-800">{formatoPeso(efectivo)}</div></div><i className="bi bi-wallet2 text-emerald-600 opacity-30 text-2xl"></i></div>
                            <div className="bg-white p-5 rounded-[2rem] shadow-sm border-2 border-slate-50 flex items-center justify-between"><div><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Transferencia</span><div className="text-xl font-black text-slate-800">{formatoPeso(transferencia)}</div></div><i className="bi bi-bank text-blue-600 opacity-30 text-2xl"></i></div>
                            <div className="bg-white p-5 rounded-[2rem] shadow-sm border-2 border-slate-50 flex items-center justify-between"><div><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tarjeta</span><div className="text-xl font-black text-slate-800">{formatoPeso(tarjeta)}</div></div><i className="bi bi-credit-card text-indigo-600 opacity-30 text-2xl"></i></div>
                        </div>

                        <div className="bg-slate-900 text-white rounded-[2.5rem] p-6 shadow-2xl flex items-center justify-center mb-6">
                            <div className="text-center"><small className="block text-[8px] font-black opacity-50 uppercase tracking-widest mb-1">TOTAL EN GAVETA (FISICO)</small><span className="font-black text-3xl tracking-tighter">{formatoPeso(efectivoEnCajon)}</span></div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 overflow-hidden">
                            <div className="bg-white rounded-[2rem] border-2 border-slate-200 flex flex-col overflow-hidden">
                                <div className="p-4 border-b bg-gray-50 flex justify-between items-center text-[10px] font-black uppercase text-slate-500">Ventas Turno <span className="bg-slate-900 text-white text-[9px] px-3 py-1 rounded-full">{listaVentas.length}</span></div>
                                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                                    {listaVentas.map(v => (
                                        <div key={v.id} className="flex justify-between items-center p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                                            <div className="max-w-[70%"><div className="text-[11px] font-black uppercase leading-none mb-1">#{v.numero_pedido} {v.nombre_cliente}</div><div className="text-[8px] text-emerald-500 font-black uppercase">{v.metodo_pago}</div></div>
                                            <div className="text-[12px] font-black text-slate-900">{formatoPeso(v.total_pagado || v.total)}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="bg-white rounded-[2rem] border-2 border-slate-200 flex flex-col overflow-hidden">
                                <div className="p-4 border-b bg-gray-50 flex justify-between items-center text-[10px] font-black uppercase text-slate-500">Gastos Turno <span className="bg-rose-100 text-rose-600 text-[9px] px-3 py-1 rounded-full">{listaGastos.length}</span></div>
                                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                                    {listaGastos.map(g => (
                                        <div key={g.id} className="flex justify-between items-center p-3 bg-rose-50/30 rounded-xl border border-rose-100"><div className="text-[11px] font-black uppercase text-slate-700">{g.descripcion}</div><div className="text-[12px] font-black text-rose-600">-{formatoPeso(g.monto)}</div></div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                </>
            )}

            {vista === 'historial' && (
                <div className="flex-1 flex flex-col overflow-hidden animate-fade-in">
                    <header className="flex justify-between items-center mb-6">
                        <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter leading-none">Buscar Turnos</h2>
                        <div className="flex items-center gap-3 bg-white rounded-2xl p-2 border-2 border-slate-200 shadow-sm transition-all focus-within:border-red-500">
                            <i className="bi bi-search text-slate-400 ml-2"></i>
                            <input type="date" className="outline-none text-[11px] font-black uppercase text-slate-800 bg-transparent px-2" value={filtroFechaHistorial} onChange={(e) => setFiltroFechaHistorial(e.target.value)} />
                            {filtroFechaHistorial && <button onClick={() => setFiltroFechaHistorial('')} className="p-1 text-slate-300 hover:text-red-600 transition-colors"><i className="bi bi-x-circle-fill"></i></button>}
                        </div>
                    </header>
                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
                        {cajasFiltradas.map(c => (
                            <div key={c.id} className="bg-white rounded-[2.5rem] p-6 shadow-sm border-2 border-white flex justify-between items-center hover:border-slate-200 transition-all hover:shadow-md">
                                <div className="flex items-center gap-6"><div className="w-14 h-14 bg-slate-900 text-white rounded-2xl flex items-center justify-center text-xl shadow-lg"><i className="bi bi-archive"></i></div><div><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cierre</div><div className="text-2xl font-black text-slate-900 uppercase tracking-tighter">{c.fechaString}</div><div className="text-[9px] font-bold text-slate-400 uppercase">Por: {c.usuario_email}</div></div></div>
                                <div className="flex items-center gap-8">
                                    <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-right">
                                        <div><small className="block text-[8px] font-black text-slate-400 uppercase">Ventas</small><span className="font-black text-emerald-600">{formatoPeso(c.total_ventas)}</span></div>
                                        <div><small className="block text-[8px] font-black text-slate-400 uppercase">Gastos</small><span className="font-black text-rose-600">{formatoPeso(c.total_gastos)}</span></div>
                                        <div className="col-span-2 border-t border-slate-100 pt-2"><small className="block text-[8px] font-black text-slate-400 uppercase">Final</small><span className="font-black text-slate-900 text-lg">{formatoPeso(c.monto_cierre_sistema)}</span></div>
                                    </div>
                                    <button onClick={() => handleExportarPDF(c)} className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center hover:bg-red-600 hover:text-white transition-all shadow-sm" title="Descargar PDF"><i className="bi bi-file-earmark-pdf-fill text-xl"></i></button>
                                </div>
                            </div>
                        ))}
                        {cajasFiltradas.length === 0 && <div className="text-center py-20 text-slate-300 font-black uppercase text-xs tracking-widest opacity-50 flex flex-col items-center gap-4"><i className="bi bi-search text-4xl"></i> No se encontraron registros</div>}
                    </div>
                </div>
            )}

            {vista === 'pendientes' && (
                <div className="flex-1 flex flex-col overflow-hidden animate-fade-in">
                    <header className="flex justify-between items-end mb-6"><h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter m-0 leading-none">Órdenes sin Cobrar</h2><span className="bg-red-100 text-red-600 px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm">{ordenesNoPagadas.length} PENDIENTES</span></header>
                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
                        {ordenesNoPagadas.map(o => (
                            <div key={o.id} className="bg-white rounded-[2rem] p-5 shadow-sm border-2 border-red-100 flex justify-between items-center transition-all hover:shadow-md">
                                <div className="flex items-center gap-4"><div className="w-12 h-12 rounded-2xl bg-red-500 text-white flex items-center justify-center font-black text-lg shadow-lg">#{o.numero_pedido}</div><div><div className="text-[13px] font-black uppercase text-slate-900">{o.nombre_cliente} • {o.fechaString}</div><div className="flex gap-2 mt-1.5"><span className="text-[8px] font-black px-3 py-1 rounded-full uppercase border bg-rose-50 border-rose-200 text-red-600 animate-pulse">SIN COBRAR</span><span className={`text-[8px] font-black px-3 py-1 rounded-full uppercase border ${String(o.estado).toLowerCase() === 'entregado' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>{o.estado === 'entregado' ? 'ENTREGADO' : 'PENDIENTE'}</span></div></div></div>
                                <div className="text-right"><div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">{o.tipo_entrega}</div><div className="text-2xl font-black text-slate-900 tracking-tighter">{formatoPeso(o.total)}</div></div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; } .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; } @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </div>
    );
}