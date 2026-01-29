import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, addDoc, updateDoc, query, where, onSnapshot, deleteDoc, doc } from 'firebase/firestore'; // Quitamos orderBy de firebase
import { getLocalDate } from './utils/dateUtils';
import { useUi } from './context/UiContext';

export const Gastos = () => {
    const { notificar, preguntar } = useUi();
    const [descripcion, setDescripcion] = useState('');
    const [monto, setMonto] = useState('');
    const [listaGastos, setListaGastos] = useState([]);
    const [totalGastos, setTotalGastos] = useState(0);

    // Estado para controlar la edición
    const [gastoEditar, setGastoEditar] = useState(null);

    const hoyString = getLocalDate();

    useEffect(() => {
        // CORRECCIÓN: Quitamos 'orderBy("fecha", "desc")' de la query de Firebase.
        // Solo filtramos por fechaString para evitar problemas de índices.
        const q = query(
            collection(db, "gastos"),
            where("fechaString", "==", hoyString)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // ORDENAMIENTO EN CLIENTE (Más rápido y seguro)
            // Ordenamos por fecha descendente (lo más nuevo arriba)
            docs.sort((a, b) => {
                const fechaA = a.fecha?.seconds || 0;
                const fechaB = b.fecha?.seconds || 0;
                return fechaB - fechaA; 
            });

            setListaGastos(docs);
            
            // Calculamos total
            const total = docs.reduce((sum, item) => sum + Number(item.monto), 0);
            setTotalGastos(total);
        }, (error) => {
            console.error("Error al leer gastos:", error);
            notificar("Error de conexión con gastos", "error");
        });

        return () => unsubscribe();
    }, [hoyString]); // Dependencia clave: hoyString

    const handleGuardarGasto = async (e) => {
        e.preventDefault();
        if (!descripcion || !monto) return notificar("Faltan datos", "error");

        try {
            if (gastoEditar) {
                // MODO EDICIÓN
                await updateDoc(doc(db, "gastos", gastoEditar.id), {
                    descripcion,
                    monto: Number(monto)
                });
                notificar("Gasto actualizado", "success");
                cancelarEdicion();
            } else {
                // MODO CREACIÓN
                await addDoc(collection(db, "gastos"), {
                    descripcion,
                    monto: Number(monto),
                    fecha: new Date(), // Timestamp actual
                    fechaString: hoyString // Fecha filtro
                });
                setDescripcion('');
                setMonto('');
                notificar("Gasto registrado", "success");
            }
        } catch (error) {
            console.error("Error al guardar gasto:", error);
            notificar("Error al guardar", "error");
        }
    };

    const iniciarEdicion = (gasto) => {
        setGastoEditar(gasto);
        setDescripcion(gasto.descripcion);
        setMonto(gasto.monto);
        setTimeout(() => document.getElementById('input-descripcion')?.focus(), 100);
    };

    const cancelarEdicion = () => {
        setGastoEditar(null);
        setDescripcion('');
        setMonto('');
    };

    const handleEliminar = async (id) => {
        const confirmar = await preguntar("Eliminar Gasto", "¿Seguro que quieres borrar este gasto?");
        if(confirmar) {
            try {
                await deleteDoc(doc(db, "gastos", id));
                if (gastoEditar?.id === id) cancelarEdicion();
                notificar("Gasto eliminado", "info");
            } catch (error) {
                notificar("Error al eliminar", "error");
            }
        }
    };

    return (
        <div className="container mt-4 h-full overflow-auto pb-5">
            <h2 className="mb-4 text-danger fw-bold"><i className="bi bi-cart-dash"></i> Registro de Gastos</h2>

            {/* Formulario */}
            <div className={`card p-4 shadow-sm mb-4 border-0 ${gastoEditar ? 'bg-warning bg-opacity-10' : 'bg-light'}`}>
                {gastoEditar && (
                    <div className="mb-2 text-warning fw-bold small">
                        <i className="bi bi-pencil-fill"></i> Editando gasto...
                    </div>
                )}
                <form onSubmit={handleGuardarGasto} className="row g-3">
                    <div className="col-md-6">
                        <input 
                            id="input-descripcion"
                            type="text" 
                            className="form-control" 
                            placeholder="Descripción (ej: Hielo, Verduras)" 
                            value={descripcion}
                            onChange={(e) => setDescripcion(e.target.value)}
                        />
                    </div>
                    <div className="col-md-3">
                        <div className="input-group">
                            <span className="input-group-text">$</span>
                            <input 
                                type="number" 
                                className="form-control" 
                                placeholder="Monto" 
                                value={monto}
                                onChange={(e) => setMonto(e.target.value)}
                            />
                        </div>
                    </div>
                    
                    <div className="col-md-3 d-flex gap-2">
                        {gastoEditar && (
                            <button 
                                type="button" 
                                className="btn btn-secondary w-50 fw-bold" 
                                onClick={cancelarEdicion}
                            >
                                Cancelar
                            </button>
                        )}
                        <button 
                            type="submit" 
                            className={`btn w-100 fw-bold ${gastoEditar ? 'btn-warning text-dark w-50' : 'btn-danger'}`}
                        >
                            {gastoEditar ? 'Guardar' : 'Agregar'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Listado */}
            <div className="card shadow-sm border-0">
                <div className="card-header bg-danger text-white d-flex justify-content-between">
                    <span className="fw-bold">Gastos del día ({new Date().toLocaleDateString('es-CL')})</span>
                    <span className="fw-bold">Total: ${totalGastos.toLocaleString('es-CL')}</span>
                </div>
                <ul className="list-group list-group-flush">
                    {listaGastos.map(gasto => (
                        <li key={gasto.id} className={`list-group-item d-flex justify-content-between align-items-center ${gastoEditar?.id === gasto.id ? 'bg-light' : ''}`}>
                            <div>
                                <span className="fw-bold text-dark">{gasto.descripcion}</span>
                                <br/>
                                <small className="text-muted">{new Date(gasto.fecha.seconds * 1000).toLocaleTimeString('es-CL')}</small>
                            </div>
                            <div className="d-flex align-items-center gap-2">
                                <span className="fs-5 fw-bold text-danger me-3">-${Number(gasto.monto).toLocaleString('es-CL')}</span>
                                
                                <button 
                                    className="btn btn-outline-warning btn-sm border-0 text-warning" 
                                    onClick={() => iniciarEdicion(gasto)}
                                    title="Editar"
                                >
                                    <i className="bi bi-pencil-fill"></i>
                                </button>
                                
                                <button 
                                    className="btn btn-outline-secondary btn-sm border-0" 
                                    onClick={() => handleEliminar(gasto.id)}
                                    title="Eliminar"
                                >
                                    <i className="bi bi-trash"></i>
                                </button>
                            </div>
                        </li>
                    ))}
                    {listaGastos.length === 0 && <li className="list-group-item text-center text-muted py-4">No hay gastos registrados hoy.</li>}
                </ul>
            </div>
        </div>
    );
};