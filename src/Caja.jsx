import React, { useState, useEffect } from 'react';
import { db, auth } from './firebase'; 
import { collection, query, where, onSnapshot, getDocs, updateDoc, doc } from 'firebase/firestore'; 
import { getLocalDate } from './utils/dateUtils';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useUi } from './context/UiContext';

export const Caja = ({ user }) => {
    const { preguntar, notificar } = useUi();
    
    // Totales
    const [totalRecaudado, setTotalRecaudado] = useState(0); 
    const [totalEnvios, setTotalEnvios] = useState(0);       
    const [totalGastos, setTotalGastos] = useState(0);       
    
    // Control Caja
    const [montoApertura, setMontoApertura] = useState(0);
    const [idCajaAbierta, setIdCajaAbierta] = useState(null);
    
    // Desglose
    const [efectivo, setEfectivo] = useState(0);
    const [tarjeta, setTarjeta] = useState(0);
    const [transferencia, setTransferencia] = useState(0);

    // Listas
    const [listaVentas, setListaVentas] = useState([]);
    const [listaGastos, setListaGastos] = useState([]);

    const emailUsuario = auth.currentUser ? auth.currentUser.email : "";
    const esPrueba = emailUsuario === "prueba@isakari.com";
    const COL_ORDENES = esPrueba ? "ordenes_pruebas" : "ordenes";
    const COL_GASTOS = "gastos";
    const COL_CAJAS = esPrueba ? "cajas_pruebas" : "cajas";

    const hoyString = getLocalDate();

    useEffect(() => {
        // 0. APERTURA
        const fetchApertura = async () => {
            const qCaja = query(collection(db, COL_CAJAS), where("estado", "==", "abierta"));
            const snap = await getDocs(qCaja);
            if (!snap.empty) {
                const d = snap.docs[0].data();
                setMontoApertura(Number(d.monto_apertura) || 0);
                setIdCajaAbierta(snap.docs[0].id);
            } else {
                setMontoApertura(0);
                setIdCajaAbierta(null);
            }
        };
        fetchApertura();

        // 1. VENTAS
        const qVentas = query(collection(db, COL_ORDENES), where("fechaString", "==", hoyString));
        const unsubVentas = onSnapshot(qVentas, (snap) => {
            let sEfec = 0, sTarj = 0, sTrans = 0, recaudado = 0, envios = 0;
            const ventasRaw = [];

            snap.docs.forEach(doc => {
                const data = doc.data();
                if (data.estadoPago === 'Pagado') {
                    ventasRaw.push({ id: doc.id, ...data });
                    
                    recaudado += Number(data.total) || 0;
                    envios += Number(data.costo_despacho) || 0;

                    if (data.desglosePago) {
                        sEfec += Number(data.desglosePago.Efectivo) || 0;
                        sTarj += Number(data.desglosePago.Tarjeta) || 0;
                        sTrans += Number(data.desglosePago.Transferencia) || 0;
                    } else {
                        const m = data.medioPago || 'Efectivo';
                        const val = Number(data.total) || 0;
                        if(m === 'Efectivo') sEfec += val;
                        else if(m === 'Tarjeta') sTarj += val;
                        else sTrans += val;
                    }
                }
            });
            ventasRaw.sort((a,b) => b.numero_pedido - a.numero_pedido);
            setListaVentas(ventasRaw);
            setTotalRecaudado(recaudado);
            setTotalEnvios(envios);
            setEfectivo(sEfec);
            setTarjeta(sTarj);
            setTransferencia(sTrans);
        });

        // 2. GASTOS
        const qGastos = query(collection(db, COL_GASTOS), where("fechaString", "==", hoyString));
        const unsubGastos = onSnapshot(qGastos, (snap) => {
            const gRaw = snap.docs.map(d => ({id: d.id, ...d.data()}));
            gRaw.sort((a,b) => (b.fecha?.seconds||0) - (a.fecha?.seconds||0));
            setListaGastos(gRaw);
            const t = gRaw.reduce((sum, i) => sum + (Number(i.monto)||0), 0);
            setTotalGastos(t);
        });

        return () => { unsubVentas(); unsubGastos(); };
    }, [hoyString, COL_ORDENES, COL_CAJAS]);

    // Cálculos
    const ventaRealLocal = totalRecaudado - totalEnvios;
    const balanceGanancia = ventaRealLocal - totalGastos;
    const efectivoEnCajon = (montoApertura + efectivo) - totalGastos;

    // CERRAR CAJA
    const handleCerrarCaja = async () => {
        if (!idCajaAbierta) return notificar("No hay caja abierta", "error");
        const ok = await preguntar("🔴 CERRAR TURNO", "¿Finalizar turno y cerrar caja?");
        if (ok) {
            try {
                await updateDoc(doc(db, COL_CAJAS, idCajaAbierta), {
                    estado: "cerrada",
                    fecha_cierre: new Date(),
                    monto_cierre_sistema: efectivoEnCajon,
                    total_ventas: totalRecaudado,
                    total_ganancia: balanceGanancia
                });
                notificar("Turno cerrado.", "success");
                setTimeout(() => window.location.reload(), 1500);
            } catch (e) { notificar("Error al cerrar", "error"); }
        }
    };

    // --- EXCEL CORRECTO ---
    const handleExportarExcel = () => {
        const wb = XLSX.utils.book_new();
        
        // Hoja 1: Resumen
        const resumenData = [
            ["REPORTE CAJA", hoyString], ["", ""],
            ["ESTADO RESULTADOS", ""],
            ["(+) Total Recaudado", totalRecaudado],
            ["(-) Total Envíos", totalEnvios],
            ["(=) Venta Real Local", ventaRealLocal],
            ["(-) Gastos", totalGastos],
            ["(=) GANANCIA", balanceGanancia],
            ["", ""],
            ["ARQUEO FÍSICO", ""],
            ["(+) Fondo Inicial", montoApertura],
            ["(+) Ventas Efectivo", efectivo],
            ["(-) Gastos", totalGastos],
            ["(=) EFECTIVO EN CAJÓN", efectivoEnCajon],
            ["", ""],
            ["MEDIOS PAGO", ""],
            ["Tarjeta", tarjeta],
            ["Transferencia", transferencia]
        ];
        const wsRes = XLSX.utils.aoa_to_sheet(resumenData);
        wsRes['!cols'] = [{wch:30}, {wch:15}];
        XLSX.utils.book_append_sheet(wb, wsRes, "Balance");

        // Hoja 2: Ventas Detalle (Lógica corregida)
        const ventasData = listaVentas.map(v => {
            const itemsStr = v.items.map(i => `(${i.cantidad}) ${i.nombre}`).join('; ');
            
            let pagoStr = v.medioPago;
            if (v.medioPago === 'Mixto' && v.desglosePago) 
                pagoStr = `Mixto (E:${v.desglosePago.Efectivo}, T:${v.desglosePago.Tarjeta})`;
            
            // LÓGICA DE SUBTOTAL CORRECTA
            // Si hay 'subtotal_sin_descuento' guardado, usamos ese (es el precio original).
            // Si no (pedidos viejos), calculamos Total - Envío.
            const subtotalOriginal = v.subtotal_sin_descuento 
                                     ? Number(v.subtotal_sin_descuento) 
                                     : (Number(v.total) - (Number(v.costo_despacho)||0));
            
            const montoDesc = v.monto_descuento ? Number(v.monto_descuento) : 0;

            return {
                "N°": v.numero_pedido,
                "Hora": v.hora_pedido,
                "Cliente": v.nombre_cliente,
                "Tipo": v.tipo_entrega,
                "Detalle": itemsStr,
                "Subtotal (Sin Desc)": subtotalOriginal, // <--- PRECIO ORIGINAL
                "Desc. (10%)": montoDesc > 0 ? -montoDesc : 0, // <--- MONTO DESCUENTO
                "Envío": Number(v.costo_despacho)||0,
                "TOTAL PAGADO": Number(v.total),
                "Pago": pagoStr
            };
        });
        const wsVentas = XLSX.utils.json_to_sheet(ventasData);
        // Ajustamos anchos
        wsVentas['!cols'] = [{wch:6}, {wch:8}, {wch:20}, {wch:10}, {wch:50}, {wch:15}, {wch:12}, {wch:10}, {wch:15}, {wch:20}];
        XLSX.utils.book_append_sheet(wb, wsVentas, "Ventas");

        // Hoja 3: Gastos
        const gastosData = listaGastos.map(g => ({
            Hora: new Date(g.fecha.seconds*1000).toLocaleTimeString(),
            Descripcion: g.descripcion,
            Monto: g.monto
        }));
        const wsGastos = XLSX.utils.json_to_sheet(gastosData);
        XLSX.utils.book_append_sheet(wb, wsGastos, "Gastos");

        XLSX.writeFile(wb, `Cierre_${hoyString}.xlsx`);
    };

    // --- PDF CORRECTO ---
    const handleExportarPDF = () => {
        const doc = new jsPDF();
        doc.setFillColor(33,33,33); doc.rect(0,0,210,25,'F');
        doc.setTextColor(255,255,255); doc.setFontSize(16); doc.text("ISAKARI SUSHI - Cierre", 105, 12, {align:'center'});
        doc.setFontSize(10); doc.text(hoyString, 105, 19, {align:'center'});

        // 1. Ganancia
        doc.setTextColor(0,0,0); doc.text("1. Estado de Resultados", 14, 35);
        autoTable(doc, {
            startY: 40,
            head: [['Concepto', 'Monto']],
            body: [
                ['(+) Total Recaudado', `$${totalRecaudado.toLocaleString('es-CL')}`],
                ['(-) A Pagar Repartidor', `$${totalEnvios.toLocaleString('es-CL')}`],
                ['(=) Venta Real Local', `$${ventaRealLocal.toLocaleString('es-CL')}`],
                ['(-) Gastos', `$${totalGastos.toLocaleString('es-CL')}`],
                ['(=) GANANCIA REAL', `$${balanceGanancia.toLocaleString('es-CL')}`]
            ],
            theme: 'grid',
            headStyles: { fillColor: [44,62,80] },
            didParseCell: (d) => {
                if(d.section==='body' && (d.row.index===1 || d.row.index===3)) d.cell.styles.textColor=[200,0,0];
                if(d.section==='body' && d.row.index===4) { 
                    d.cell.styles.fillColor=[46,204,113]; d.cell.styles.textColor=[255,255,255]; d.cell.styles.fontStyle='bold'; 
                }
            }
        });

        // 2. Arqueo
        const y2 = doc.lastAutoTable.finalY + 10;
        doc.text("2. Arqueo de Efectivo", 14, y2);
        autoTable(doc, {
            startY: y2+5,
            head: [['Concepto', 'Monto']],
            body: [
                ['(+) Fondo Inicial', `$${montoApertura.toLocaleString('es-CL')}`],
                ['(+) Ventas Efectivo', `$${efectivo.toLocaleString('es-CL')}`],
                ['(-) Gastos', `$${totalGastos.toLocaleString('es-CL')}`],
                ['(=) DINERO EN CAJÓN', `$${efectivoEnCajon.toLocaleString('es-CL')}`]
            ],
            theme: 'striped',
            headStyles: { fillColor: [41,128,185] }
        });

        // 3. Medios
        const y3 = doc.lastAutoTable.finalY + 10;
        doc.text("3. Medios de Pago", 14, y3);
        autoTable(doc, {
            startY: y3+5,
            head: [['Medio', 'Monto']],
            body: [
                ['Efectivo', `$${efectivo.toLocaleString('es-CL')}`],
                ['Tarjeta', `$${tarjeta.toLocaleString('es-CL')}`],
                ['Transferencia', `$${transferencia.toLocaleString('es-CL')}`],
                ['---', '---'],
                ['Total Envíos', `$${totalEnvios.toLocaleString('es-CL')}`]
            ],
            theme: 'grid'
        });

        // 4. DETALLE (Lógica de Subtotal Correcta)
        const y4 = doc.lastAutoTable.finalY + 10;
        doc.text("4. Detalle de Pedidos", 14, y4);
        
        const filas = listaVentas.map(v => {
            const items = v.items.map(i => `(${i.cantidad}) ${i.nombre}`).join(', ');
            
            // Subtotal ORIGINAL (Antes del descuento)
            const subOriginal = v.subtotal_sin_descuento 
                                ? Number(v.subtotal_sin_descuento) 
                                : (Number(v.total) - (Number(v.costo_despacho)||0));
            
            return [
                v.numero_pedido,
                v.hora_pedido,
                v.tipo_entrega === 'REPARTO' ? 'Rep.' : 'Local',
                items,
                `$${subOriginal.toLocaleString('es-CL')}`, // Muestra 10.000 (Subtotal Real)
                v.tiene_descuento ? 'SÍ' : 'NO',          // Muestra SÍ
                `$${(Number(v.costo_despacho)||0).toLocaleString('es-CL')}`, // Envío
                `$${Number(v.total).toLocaleString('es-CL')}`, // Muestra 11.000 (Total Pagado)
                v.medioPago
            ];
        });

        autoTable(doc, {
            startY: y4+5,
            head: [['#', 'Hora', 'Tipo', 'Detalle', 'Sub.', '10%', 'Env.', 'Total', 'Pago']],
            body: filas,
            theme: 'striped',
            styles: { fontSize: 6, cellPadding: 1 }, 
            headStyles: { fillColor: [127,140,141] },
            columnStyles: {
                0: { cellWidth: 7 },
                1: { cellWidth: 9 },
                2: { cellWidth: 8 },
                3: { cellWidth: 'auto' }, 
                4: { cellWidth: 12, halign: 'right' }, 
                5: { cellWidth: 7, halign: 'center' }, 
                6: { cellWidth: 10, halign: 'right' }, 
                7: { cellWidth: 14, halign: 'right', fontStyle:'bold' }, 
                8: { cellWidth: 14 } 
            }
        });

        doc.save(`Cierre_${hoyString}.pdf`);
    };

    return (
        <div className="container mt-4 h-full overflow-auto pb-5">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h2 className="fw-bold m-0">Reporte de Caja</h2>
                <div className="d-flex gap-2">
                    <button onClick={handleExportarExcel} className="btn btn-success btn-sm fw-bold"><i className="bi bi-file-excel"></i> Excel</button>
                    <button onClick={handleExportarPDF} className="btn btn-danger btn-sm fw-bold"><i className="bi bi-file-pdf"></i> PDF</button>
                    <button onClick={handleCerrarCaja} className="btn btn-dark btn-sm fw-bold ms-3"><i className="bi bi-door-closed"></i> CERRAR</button>
                </div>
            </div>

            {/* ESTADO GENERAL */}
            <div className="row text-center g-3 mb-4">
                <div className="col-md-3">
                    <div className="card border-success border-2 shadow-sm">
                        <div className="card-body py-2">
                            <h5 className="text-success fw-bold m-0">${totalRecaudado.toLocaleString('es-CL')}</h5>
                            <small className="text-muted" style={{fontSize:'0.7rem'}}>Total Recaudado</small>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card border-warning border-2 shadow-sm">
                        <div className="card-body py-2">
                            <h5 className="text-dark fw-bold m-0">${totalEnvios.toLocaleString('es-CL')}</h5>
                            <small className="text-muted" style={{fontSize:'0.7rem'}}>Total Envíos</small>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card border-danger border-2 shadow-sm">
                        <div className="card-body py-2">
                            <h5 className="m-0">${totalGastos.toLocaleString('es-CL')}</h5>
                            <small className="text-muted" style={{fontSize:'0.7rem'}}>Gastos</small>
                        </div>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="card border-primary border-3 shadow-sm bg-blue-50">
                        <div className="card-body py-2">
                            <h4 className="m-0 text-primary fw-bold">${balanceGanancia.toLocaleString('es-CL')}</h4>
                            <small className="text-muted" style={{fontSize:'0.7rem'}}>GANANCIA REAL</small>
                        </div>
                    </div>
                </div>
            </div>

            {/* ARQUEO */}
            <div className="card mb-4 border-secondary bg-light">
                <div className="card-header fw-bold bg-secondary text-white small"><i className="bi bi-safe"></i> Control Efectivo</div>
                <div className="card-body d-flex justify-content-around align-items-center flex-wrap gap-2 py-3">
                    <div className="text-center"><small className="d-block fw-bold text-muted" style={{fontSize:'0.7rem'}}>Fondo</small><span className="fw-bold">${montoApertura.toLocaleString('es-CL')}</span></div>
                    <span>+</span>
                    <div className="text-center"><small className="d-block fw-bold text-muted" style={{fontSize:'0.7rem'}}>Ventas Efec.</small><span className="fw-bold text-success">${efectivo.toLocaleString('es-CL')}</span></div>
                    <span>-</span>
                    <div className="text-center"><small className="d-block fw-bold text-muted" style={{fontSize:'0.7rem'}}>Gastos</small><span className="fw-bold text-danger">${totalGastos.toLocaleString('es-CL')}</span></div>
                    <span>=</span>
                    <div className="text-center bg-white px-3 py-1 rounded border"><small className="d-block fw-bold text-dark" style={{fontSize:'0.7rem'}}>EN CAJÓN</small><span className="fs-5 fw-bold">${efectivoEnCajon.toLocaleString('es-CL')}</span></div>
                </div>
            </div>

            {/* MEDIOS PAGO */}
            <div className="row text-center g-2">
                <div className="col-4"><div className="card shadow-sm"><div className="card-body py-2"><small className="fw-bold text-muted d-block" style={{fontSize:'0.65rem'}}>EFECTIVO</small><span className="text-success fw-bold">${efectivo.toLocaleString('es-CL')}</span></div></div></div>
                <div className="col-4"><div className="card shadow-sm"><div className="card-body py-2"><small className="fw-bold text-muted d-block" style={{fontSize:'0.65rem'}}>TARJETA</small><span className="text-primary fw-bold">${tarjeta.toLocaleString('es-CL')}</span></div></div></div>
                <div className="col-4"><div className="card shadow-sm"><div className="card-body py-2"><small className="fw-bold text-muted d-block" style={{fontSize:'0.65rem'}}>TRANSF.</small><span className="text-info fw-bold">${transferencia.toLocaleString('es-CL')}</span></div></div></div>
            </div>
        </div>
    );
};