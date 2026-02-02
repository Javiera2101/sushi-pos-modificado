import React from 'react';
import './css/Ticket.css';

const Ticket = ({ orden, total, numeroPedido, tipoEntrega, fecha, hora, cliente, direccion, telefono, costoDespacho, descripcion }) => {
  return (
    <div className="ticket-container">
      <div className="text-center mb-2 border-bottom pb-2">
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>SUSHIPHONE</h2>
        <p style={{ margin: 0, fontSize: '12px' }}>Pedido N°: {numeroPedido}</p>
        <p style={{ margin: 0, fontSize: '11px' }}>{fecha} - {hora}</p>
      </div>

      <div className="mb-2" style={{ fontSize: '13px' }}>
        <strong>CLIENTE:</strong> {cliente?.toUpperCase() || 'PÚBLICO GENERAL'}<br />
        {telefono && <span><strong>FONO:</strong> {telefono}</span>}
      </div>

      {tipoEntrega === 'REPARTO' && (
        <div className="ticket-address-container">
          <span className="ticket-address-label">Dirección de Despacho:</span>
          <span className="ticket-address-text">
            {direccion}
          </span>
          {descripcion && (
            <div style={{ marginTop: '5px', fontSize: '11px', borderTop: '1px dashed #ccc', paddingTop: '3px' }}>
              <strong>NOTAS:</strong> {descripcion}
            </div>
          )}
        </div>
      )}

      <table className="ticket-table">
        <thead>
          <tr style={{ borderBottom: '1px solid black' }}>
            <th align="left">CANT</th>
            <th align="left">ITEM</th>
            <th align="right">SUBT</th>
          </tr>
        </thead>
        <tbody>
          {orden?.map((item, idx) => (
            <tr key={idx}>
              <td valign="top">{item.cantidad}</td>
              <td valign="top">
                {item.nombre}
                {item.observacion && <div style={{ fontSize: '10px', fontStyle: 'italic' }}>- {item.observacion}</div>}
              </td>
              <td align="right" valign="top">${(item.precio * item.cantidad).toLocaleString('es-CL')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ticket-total-section">
        {costoDespacho > 0 && (
          <div style={{ fontSize: '12px' }}>Envío: ${parseInt(costoDespacho).toLocaleString('es-CL')}</div>
        )}
        <div className="ticket-total-value">
          TOTAL: ${total?.toLocaleString('es-CL')}
        </div>
      </div>

      <div className="text-center mt-3" style={{ fontSize: '11px' }}>
        ¡Gracias por su compra!<br />
        www.sushiphone.cl
      </div>
    </div>
  );
};

export default Ticket;