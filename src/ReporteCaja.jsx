import React from 'react';
import './css/ReporteCaja.css'; 

export const ReporteCaja = ({ totales, fondoCaja, ventasCount }) => {
  
  const formatoPeso = (valor) => {
    return valor.toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });
  };

  const fechaHoy = new Date().toLocaleDateString('es-CL');
  const horaHoy = new Date().toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});

  return (
    <div className="reporte-container">
      
      <div className="text-center fw-bold" style={{fontSize: '1.2em', marginBottom: '5px'}}>
        CIERRE DE CAJA
      </div>
      
      <div className="text-center mb-2">
        {fechaHoy} - {horaHoy}
      </div>

      <div className="border-top-dashed"></div>

      {/* RESUMEN GENERAL */}
      <div className="d-flex fw-bold" style={{fontSize: '1.1em', margin: '10px 0'}}>
        <span>TOTAL:  {formatoPeso(totales.totalVentas)}</span>
      </div>

      <div className="d-flex">
        <span>Caja Inicial: {formatoPeso(fondoCaja)}</span>
      </div>

      {/* --- AGREGADO: TOTAL REPARTOS --- */}
      <div className="d-flex">
        <span>Total Repartos: {formatoPeso(totales.totalReparto)}</span>
      </div>
      {/* ------------------------------- */}
      
      <div className="d-flex">
        <span>N° de pedidos: {ventasCount}</span>
      </div>

      <div className="border-top-dashed"></div>

      {/* DESGLOSE DE DINERO */}
      <div className="fw-bold mb-1">Medios de pago :</div>
      
      <div className="d-flex">
        <span>Efectivo:  {formatoPeso(totales.efectivo)}</span>
      </div>

      <div className="d-flex">
        <span>Débito:    {formatoPeso(totales.debito)}</span>
      </div>
      <div className="d-flex">
        <span>Transferencia:    {formatoPeso(totales.transferencia)}</span>
      </div>
      <div className="d-flex">
        <span>Edenred:  {formatoPeso(totales.edenred)}</span>
      </div>


      <div className="border-top-dashed"></div>
    </div>
  );
};