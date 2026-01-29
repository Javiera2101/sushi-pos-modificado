import React from 'react';
import './css/Ticket.css';
import logoIsakari from './images/logoBK.png';

export const Ticket = ({ orden, total, numeroPedido, tipoEntrega, fecha, descripcion, logoUrl, cliente, hora, costoDespacho, direccion, telefono }) => {
  
  const formatoPeso = (valor) => {
    return valor.toLocaleString('es-CL', { style: 'currency', currency: 'CLP' });
  };

  const costoDespachoNum = parseInt(costoDespacho || 0);
  const totalNum = parseInt(total || 0);
  const subtotalProductos = totalNum - costoDespachoNum;
  const logoFinal = logoUrl || logoIsakari;

  return (
    <div className="ticket-container">
      
      <div className="text-center mb-2">
        <img src={logoFinal} alt="Logo IsaKari Sushi" style={{ maxWidth: '180px', height: 'auto', marginBottom: '5px' }} />
        <p className="m-0 fw-bold">Calle Comercio #1757</p> 
        <p className="m-0 mb-2 fw-bold">+56 9 813 51797</p>   
        
        <h3 className="fw-bold mt-2">Mesa {numeroPedido}</h3>

        {cliente && <p className="m-0 fw-bold fs-5 text-uppercase">{cliente}</p>}
        {hora && <p className="m-0 fw-bold">Hora: {hora}</p>}
        
        <div className="linea-punteada"></div>
        <div className="d-flex justify-content-between fw-bold"><span>Fecha: {fecha}</span></div>
      </div>

      <div className="items-section my-2">
        <div className="linea-punteada"></div>
        <div className="d-flex justify-content-between fw-bold mb-1"><span>CANTIDAD</span><span>TOTAL</span></div>
        <div className="linea-punteada"></div>
        
        {orden.map((item, i) => (
          <div key={i} className="mb-2">
            
            {/* LÍNEA 1: Producto */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, paddingRight: '5px' }}>
                  <span className="fw-bold d-block">{item.cantidad} x {item.nombre}</span>
                  
                  {item.descripcion_producto && (
                      <div style={{ fontSize: '0.8em', color: '#000', fontStyle: 'italic', lineHeight: '1.1', marginBottom: '2px' }}>
                          {Array.isArray(item.descripcion_producto) ? (
                              item.descripcion_producto.map((linea, idx) => <span key={idx} style={{ display: 'block' }}>- {linea}</span>)
                          ) : (
                              <span style={{ whiteSpace: 'pre-wrap' }}>{item.descripcion_producto}</span>
                          )}
                      </div>
                  )}
                  <small style={{ fontSize: '0.85em', color: '#333' }}>{formatoPeso(item.precio)} c/u</small>
                </div>
                <div style={{ whiteSpace: 'nowrap', fontWeight: 'bold' }}>{formatoPeso(item.precio * item.cantidad)}</div>
            </div>
            
            {/* LÍNEA 2: NOTA INDIVIDUAL (DESTACADA EN NEGRO) */}
            {item.observacion && (
                <div style={{ 
                    marginTop: '4px',
                    marginBottom: '4px', 
                    padding: '4px',
                    fontSize: '1.1em',       // Letra grande
                    fontWeight: '900',       // Muy negrita
                    textTransform: 'uppercase',
                    backgroundColor: 'black', // Fondo negro
                    color: 'white',           // Letra blanca
                    textAlign: 'center',
                    borderRadius: '4px',      
                    // Estas propiedades fuerzan la impresión del fondo negro
                    border: '1px solid black',
                    WebkitPrintColorAdjust: 'exact',
                    printColorAdjust: 'exact'
                }}>
                    ★ {item.observacion} ★
                </div>
            )}
            
            <div className="linea-punteada" style={{ borderTopStyle: 'dotted', opacity: 0.5, margin: '2px 0' }}></div>
          </div>
        ))}
    </div>

    {descripcion && (
        <div className="my-2">
            <div className="linea-punteada"></div>
            <div className="fw-bold">Observación Gral:</div>
            <div className="text-uppercase" style={{fontSize: '1em', fontWeight: 'bold'}}>{descripcion}</div>
        </div>
    )}

      <div className="linea-punteada"></div>
      
      <div className="my-2">
          {costoDespachoNum > 0 && (
              <>
                <div className="d-flex justify-content-between" style={{fontSize: '0.9em'}}><span>Subtotal Productos</span><span>{formatoPeso(subtotalProductos)}</span></div>
                <div className="d-flex justify-content-between fw-bold"><span>Envío/Despacho</span><span>{formatoPeso(costoDespachoNum)}</span></div>
                <div className="linea-punteada my-1"></div>
              </>
          )}
          <div className="d-flex justify-content-between fs-5 fw-bold"><span>TOTAL</span><span>{formatoPeso(totalNum)}</span></div>
      </div>
      <div className="linea-punteada"></div>

      {tipoEntrega === 'REPARTO' && (direccion || telefono) && (
        <div className="datos-reparto mt-3 text-start">
          <h5 className="fw-bold text-center mb-2 text-uppercase bg-light border p-1">DATOS DE DESPACHO</h5>
          
          {/* CORRECCIÓN AQUÍ: Estilos para evitar corte de palabras */}
          {direccion && (
            <div className="mb-1">
                <span className="fw-bold">Dirección:</span>
                <br/>
                <span style={{
                    fontSize:'1.2em', // Un poco más grande para legibilidad
                    display: 'block',
                    wordWrap: 'break-word', // Romper solo si es necesario
                    wordBreak: 'normal',    // NO romper palabras a la mitad
                    overflowWrap: 'break-word',
                    lineHeight: '1.2'
                }}>
                    {direccion}
                </span>
            </div>
          )}
          
          {telefono && <div className="mb-1"><span className="fw-bold">Teléfono:</span> {telefono}</div>}
        </div>
      )}
    </div>
  );
};