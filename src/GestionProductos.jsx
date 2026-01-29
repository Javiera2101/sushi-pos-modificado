import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore'; // Quitamos query y orderBy
import { useUi } from './context/UiContext'; // <--- Usamos tu nuevo sistema de UI

export const GestionProductos = () => {
    const { notificar, preguntar } = useUi(); 
    const [productos, setProductos] = useState([]);
    const [busqueda, setBusqueda] = useState('');
    const [modoEdicion, setModoEdicion] = useState(false);
    const [productoActual, setProductoActual] = useState(null); 
    
    const [form, setForm] = useState({
        nombre: '',
        categoria: '',
        precio: '',
        descripcion: ''
    });

    // Obtener lista de categorías para sugerencias
    const categoriasUnicas = [...new Set(productos.map(p => p.categoria))].sort();

    useEffect(() => {
        // CORRECCIÓN: Quitamos 'orderBy' de la consulta a Firebase.
        // Esto evita errores de índices y asegura que el listener funcione siempre en tiempo real.
        const coleccionRef = collection(db, "menu");
        
        const unsubscribe = onSnapshot(coleccionRef, (snapshot) => {
            const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Ordenamos aquí (en el navegador)
            docs.sort((a, b) => {
                // 1. Primero por Categoría
                const catA = (a.categoria || '').toString().toLowerCase();
                const catB = (b.categoria || '').toString().toLowerCase();
                if (catA < catB) return -1;
                if (catA > catB) return 1;
                
                // 2. Luego por Nombre
                return (a.nombre || '').toString().localeCompare((b.nombre || '').toString());
            });

            setProductos(docs);
        }, (error) => {
            console.error("Error escuchando productos:", error);
            notificar("Error de conexión al cargar productos", "error");
        });

        return () => unsubscribe();
    }, []);

    // --- MANEJADORES ---

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setForm({ ...form, [name]: value });
    };

    const iniciarEdicion = (producto) => {
        setModoEdicion(true);
        setProductoActual(producto);
        setForm({
            nombre: producto.nombre,
            categoria: producto.categoria,
            precio: producto.precio,
            descripcion: producto.descripcion || ''
        });
        // Scroll suave hacia arriba para ver el formulario
        const formElement = document.getElementById('form-productos');
        if(formElement) formElement.scrollIntoView({ behavior: 'smooth' });
    };

    const cancelarEdicion = () => {
        setModoEdicion(false);
        setProductoActual(null);
        setForm({ nombre: '', categoria: '', precio: '', descripcion: '' });
    };

    const guardarProducto = async (e) => {
        e.preventDefault();
        // Usamos notificar() en vez de alert()
        if (!form.nombre || !form.precio || !form.categoria) {
            return notificar("Nombre, Precio y Categoría son obligatorios", "error");
        }

        const datosGuardar = {
            nombre: form.nombre,
            categoria: form.categoria,
            precio: Number(form.precio) || 0,
            descripcion: form.descripcion || ''
        };

        try {
            if (modoEdicion && productoActual) {
                await updateDoc(doc(db, "menu", productoActual.id), datosGuardar);
                notificar("Producto actualizado correctamente", "success");
            } else {
                await addDoc(collection(db, "menu"), datosGuardar);
                notificar("Producto creado con éxito", "success");
            }
            cancelarEdicion();
        } catch (error) {
            console.error("Error al guardar:", error);
            notificar("Error al guardar el producto", "error");
        }
    };

    const eliminarProducto = async (id, nombre) => {
        // Usamos preguntar() en vez de confirm()
        const confirmar = await preguntar("Eliminar Producto", `¿Estás seguro de ELIMINAR "${nombre}"?`);
        if (confirmar) {
            try {
                await deleteDoc(doc(db, "menu", id));
                notificar("Producto eliminado", "info");
            } catch (error) {
                notificar("Error al eliminar", "error");
            }
        }
    };

    // Filtro de búsqueda local
    const productosFiltrados = productos.filter(p => 
        (p.nombre || '').toLowerCase().includes(busqueda.toLowerCase()) || 
        (p.categoria || '').toLowerCase().includes(busqueda.toLowerCase())
    );

    return (
        <div className="container mt-4 pb-5 h-full overflow-auto">
            <h2 className="mb-4 text-center fw-bold text-secondary">
                <i className="bi bi-box-seam"></i> Gestión de Menú
            </h2>

            {/* --- FORMULARIO (Agregar / Editar) --- */}
            <div id="form-productos" className="card shadow-sm mb-5 border-0 bg-light">
                <div className={`card-header fw-bold text-white ${modoEdicion ? 'bg-warning' : 'bg-primary'}`}>
                    {modoEdicion ? '✏️ Editando Producto' : '➕ Nuevo Producto'}
                </div>
                <div className="card-body">
                    <form onSubmit={guardarProducto} className="row g-3">
                        <div className="col-md-4">
                            <label className="form-label small text-muted">Nombre del Producto</label>
                            <input 
                                type="text" className="form-control fw-bold" name="nombre" 
                                placeholder="Ej: Handroll Pollo" 
                                value={form.nombre} onChange={handleInputChange} 
                            />
                        </div>
                        <div className="col-md-3">
                            <label className="form-label small text-muted">Categoría</label>
                            <input 
                                type="text" className="form-control" name="categoria" 
                                list="lista-categorias" 
                                placeholder="Escribe o selecciona..." 
                                value={form.categoria} onChange={handleInputChange} 
                            />
                            {/* Datalist para sugerir categorías existentes */}
                            <datalist id="lista-categorias">
                                {categoriasUnicas.map(cat => <option key={cat} value={cat} />)}
                            </datalist>
                        </div>
                        <div className="col-md-2">
                            <label className="form-label small text-muted">Precio</label>
                            <div className="input-group">
                                <span className="input-group-text">$</span>
                                <input 
                                    type="number" className="form-control" name="precio" 
                                    placeholder="0" 
                                    value={form.precio} onChange={handleInputChange} 
                                />
                            </div>
                        </div>
                        <div className="col-md-3">
                            <label className="form-label small text-muted">Descripción (Opcional)</label>
                            <input 
                                type="text" className="form-control" name="descripcion" 
                                placeholder="Ingredientes, detalles..." 
                                value={form.descripcion} onChange={handleInputChange} 
                            />
                        </div>
                        
                        <div className="col-12 text-end mt-3">
                            {modoEdicion && (
                                <button type="button" className="btn btn-secondary me-2" onClick={cancelarEdicion}>
                                    Cancelar
                                </button>
                            )}
                            <button type="submit" className={`btn px-4 fw-bold text-white ${modoEdicion ? 'btn-warning' : 'btn-success'}`}>
                                {modoEdicion ? 'Guardar Cambios' : 'Agregar Producto'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* --- LISTA DE PRODUCTOS --- */}
            <div className="d-flex justify-content-between align-items-center mb-3">
                <h4 className="text-secondary">Inventario ({productos.length})</h4>
                <input 
                    type="text" 
                    className="form-control w-25" 
                    placeholder="🔍 Buscar producto..." 
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                />
            </div>

            <div className="table-responsive shadow-sm rounded bg-white">
                <table className="table table-hover align-middle mb-0">
                    <thead className="bg-light">
                        <tr>
                            <th scope="col" className="ps-4">Nombre</th>
                            <th scope="col">Categoría</th>
                            <th scope="col">Descripción</th>
                            <th scope="col">Precio</th>
                            <th scope="col" className="text-end pe-4">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {productosFiltrados.map(prod => (
                            <tr key={prod.id}>
                                <td className="ps-4 fw-bold">{prod.nombre}</td>
                                <td>
                                    <span className="badge bg-info text-dark bg-opacity-25 border border-info px-2 py-1">
                                        {prod.categoria}
                                    </span>
                                </td>
                                <td className="text-muted small text-truncate" style={{maxWidth: '200px'}}>
                                    {prod.descripcion || '-'}
                                </td>
                                <td className="fw-bold text-success">${Number(prod.precio).toLocaleString('es-CL')}</td>
                                <td className="text-end pe-4">
                                    <button 
                                        className="btn btn-sm btn-outline-primary me-2" 
                                        onClick={() => iniciarEdicion(prod)}
                                        title="Editar"
                                    >
                                        <i className="bi bi-pencil-fill"></i>
                                    </button>
                                    <button 
                                        className="btn btn-sm btn-outline-danger" 
                                        onClick={() => eliminarProducto(prod.id, prod.nombre)}
                                        title="Eliminar"
                                    >
                                        <i className="bi bi-trash-fill"></i>
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {productosFiltrados.length === 0 && (
                            <tr>
                                <td colSpan="5" className="text-center py-4 text-muted">
                                    No se encontraron productos.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};