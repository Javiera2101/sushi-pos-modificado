import React from 'react';

const Ticket = ({ orden = [], total = 0, numeroPedido = '...', tipoEntrega = 'LOCAL', fecha = '', cliente = '', hora = '', descripcion = '' }) => {
  const formatoPeso = (valor) => (Number(valor) || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });
  const totalNum = parseInt(total || 0);

  return (
    <div className="ticket-container" style={{ padding: '10px', fontFamily: 'monospace', width: '280px', backgroundColor: 'white', color: 'black', lineHeight: '1.2' }}>
      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        <h2 style={{ margin: '0', fontSize: '18px' }}>ISAKARI SUSHI</h2>
        <div style={{ borderTop: '1px dashed black', margin: '10px 0' }}></div>
        <h3 style={{ margin: '5px 0' }}>Pedido #{String(numeroPedido)}</h3>
        {cliente && <p style={{ margin: '0', fontWeight: 'bold', textTransform: 'uppercase' }}>{String(cliente)}</p>}
        <p style={{ margin: '0' }}>{fecha} - {hora}</p>
        <div style={{ borderTop: '1px dashed black', margin: '10px 0' }}></div>
      </div>

      {orden.map((item, i) => (
        <div key={i} style={{ marginBottom: '8px', fontSize: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ flex: '1' }}>{item.cantidad} x {item.nombre}</span>
            <span>{formatoPeso(item.precio * item.cantidad)}</span>
          </div>
          {item.observacion && (
            <div style={{ backgroundColor: 'black', color: 'white', padding: '2px', textAlign: 'center', margin: '4px 0', fontWeight: 'bold' }}>
              ★ {item.observacion} ★
            </div>
          )}
        </div>
      ))}

      <div style={{ borderTop: '1px dashed black', paddingTop: '5px', marginTop: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 'bold' }}>
          <span>TOTAL</span>
          <span>{formatoPeso(totalNum)}</span>
        </div>
      </div>

      {descripcion && (
        <div style={{ marginTop: '10px', borderTop: '1px solid black', paddingTop: '5px' }}>
          <p style={{ margin: '0', fontSize: '11px', fontWeight: 'bold' }}>OBS: {descripcion.toUpperCase()}</p>
        </div>
      )}
    </div>
  );
};

export default Ticket;