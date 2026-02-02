import React, { useState, useEffect } from 'react';
import { db } from './firebase.js'; 
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { useUi } from './context/UiContext.jsx';

/**
 * COMPONENTE: GESTIÓN DE PRODUCTOS
 * Administra el menú Isakari con sincronización en tiempo real y diseño unificado.
 */
export const GestionProductos = () => {
    const { notificar, preguntar } = useUi(); 
    const [productos, setProductos] = useState([]);
    const [busqueda, setBusqueda] = useState('');
    const [modoEdicion, setModoEdicion] = useState(false);
    const [productoActual, setProductoActual] = useState(null); 
    const [procesando, setProcesando] = useState(false);
    
    const [form, setForm] = useState({
        nombre: '',
        categoria: '',
        precio: '',
        descripcion: ''
    });

    // Estilo común para los inputs del sistema Isakari
    const inputStyle = "w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-[1.5rem] text-sm font-bold focus:border-red-500 focus:bg-white transition-all outline-none shadow-inner uppercase placeholder:text-slate-300";

    const categoriasUnicas = [...new Set(productos.map(p => p.categoria))].sort();

    // Función para cargar/sincronizar productos
    const cargarProductos = () => {
        const coleccionRef = collection(db, "menu");
        return onSnapshot(coleccionRef, (snapshot) => {
            const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            docs.sort((a, b) => {
                const catA = (a.categoria || '').toString().toLowerCase();
                const catB = (b.categoria || '').toString().toLowerCase();
                if (catA < catB) return -1;
                if (catA > catB) return 1;
                return (a.nombre || '').toString().localeCompare((b.nombre || '').toString());
            });

            setProductos(docs);
        }, (error) => {
            console.error("Error escuchando productos:", error);
            notificar("Error de conexión al cargar productos", "error");
        });
    };

    useEffect(() => {
        const unsubscribe = cargarProductos();
        return () => unsubscribe();
    }, []);

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
        const container = document.getElementById('gestion-container');
        if(container) container.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const cancelarEdicion = () => {
        setModoEdicion(false);
        setProductoActual(null);
        setForm({ nombre: '', categoria: '', precio: '', descripcion: '' });
    };

    const guardarProducto = async (e) => {
        e.preventDefault();
        if (!form.nombre || !form.precio || !form.categoria) {
            return notificar("Nombre, Precio y Categoría son obligatorios", "error");
        }

        setProcesando(true);
        const datosGuardar = {
            nombre: form.nombre.toUpperCase(),
            categoria: form.categoria.toUpperCase(),
            precio: Number(form.precio) || 0,
            descripcion: form.descripcion.toUpperCase() || ''
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
        } finally {
            setProcesando(false);
        }
    };

    const eliminarProducto = async (id, nombre) => {
        const confirmar = window.confirm(`¿Estás seguro de ELIMINAR permanentemente "${nombre}" del menú?`);
        if (confirmar) {
            try {
                await deleteDoc(doc(db, "menu", id));
                notificar("Producto eliminado correctamente", "info");
            } catch (error) {
                console.error("Error Firebase:", error);
                notificar("Error al eliminar el registro", "error");
            }
        }
    };

    const productosFiltrados = productos.filter(p => 
        (p.nombre || '').toLowerCase().includes(busqueda.toLowerCase()) || 
        (p.categoria || '').toLowerCase().includes(busqueda.toLowerCase())
    );

    return (
        <div id="gestion-container" className="h-full overflow-y-auto p-6 md:p-10 bg-slate-100 font-sans custom-scrollbar animate-fade-in">
            <header className="mb-10 text-center">
                <h2 className="text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none m-0">Gestión de Menú</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em] mt-3">Administración de Productos en Tiempo Real</p>
            </header>

            {/* CARD DE FORMULARIO */}
            <div id="form-productos" className="max-w-6xl mx-auto bg-white rounded-[2.5rem] shadow-xl p-10 mb-12 border-4 border-slate-50 relative overflow-hidden">
                <div className={`absolute top-0 left-0 w-full h-1.5 ${modoEdicion ? 'bg-orange-500' : 'bg-red-600'}`}></div>
                
                <div className="flex items-center gap-3 mb-8">
                    <div className={`w-3 h-3 rounded-full ${modoEdicion ? 'bg-orange-500 animate-pulse' : 'bg-red-600'}`}></div>
                    <h3 className="font-black uppercase text-xs text-slate-400 tracking-widest">
                        {modoEdicion ? 'Editando Producto Existente' : 'Registrar Nuevo Producto'}
                    </h3>
                </div>

                <form onSubmit={guardarProducto} className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="md:col-span-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-3 mb-2 block">Nombre del Ítem</label>
                        <input 
                            type="text" name="nombre" value={form.nombre} onChange={handleInputChange}
                            className={inputStyle}
                            placeholder="EJ: PROMO 40" 
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-3 mb-2 block">Categoría</label>
                        <input 
                            type="text" name="categoria" value={form.categoria} onChange={handleInputChange} list="lista-cats-form"
                            className={inputStyle}
                            placeholder="SELECCIONA..." 
                        />
                        <datalist id="lista-cats-form">{categoriasUnicas.map(c => <option key={c} value={c} />)}</datalist>
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-3 mb-2 block">Precio</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-slate-300">$</span>
                            <input 
                                type="number" name="precio" value={form.precio} onChange={handleInputChange}
                                className={inputStyle + " pl-8"}
                                placeholder="0" 
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-3 mb-2 block">Descripción (Opcional)</label>
                        <input 
                            type="text" name="descripcion" value={form.descripcion} onChange={handleInputChange}
                            className={inputStyle}
                            placeholder="DETALLES..." 
                        />
                    </div>
                    
                    <div className="md:col-span-4 flex justify-end gap-3 mt-4 border-t border-slate-50 pt-8">
                        {modoEdicion && (
                            <button type="button" onClick={cancelarEdicion} className="px-8 py-4 rounded-[1.5rem] font-black uppercase text-[10px] text-slate-400 hover:text-slate-600 transition-colors">
                                Cancelar
                            </button>
                        )}
                        <button type="submit" disabled={procesando} className={`px-12 py-4 rounded-[1.5rem] font-black uppercase text-xs text-white shadow-lg active:scale-95 transition-all ${procesando ? 'bg-slate-400' : modoEdicion ? 'bg-orange-500 shadow-orange-100' : 'bg-red-600 shadow-red-100'}`}>
                            {procesando ? 'Procesando...' : modoEdicion ? 'Actualizar Menú' : 'Registrar Producto'}
                        </button>
                    </div>
                </form>
            </div>

            {/* TABLA DE INVENTARIO */}
            <div className="max-w-6xl mx-auto bg-white rounded-[2.5rem] shadow-sm overflow-hidden border border-slate-200 mb-20">
                <div className="p-8 border-b border-slate-50 flex flex-col md:flex-row justify-between items-center bg-slate-50/50 gap-6">
                    <div>
                        <h4 className="font-black uppercase text-slate-900 text-sm m-0">Inventario Isakari ({productos.length})</h4>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Base de datos sincronizada</p>
                    </div>
                    <div className="flex gap-2 w-full md:w-auto">
                        <div className="relative flex-1 md:w-80">
                            <i className="bi bi-search absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i>
                            <input 
                                type="text" placeholder="BUSCAR POR NOMBRE O CATEGORÍA..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
                                className="w-full p-4 pl-12 rounded-[1.5rem] bg-white border-2 border-slate-100 outline-none text-[11px] font-bold shadow-sm focus:border-red-400 transition-all uppercase" 
                            />
                        </div>
                        <button 
                            onClick={() => cargarProductos()}
                            className="w-14 h-14 bg-white border-2 border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-red-600 hover:border-red-100 transition-all shadow-sm active:rotate-180 duration-500"
                            title="Actualizar lista"
                        >
                            <i className="bi bi-arrow-clockwise text-xl"></i>
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-[10px] font-black uppercase text-slate-400 border-b border-slate-50">
                                <th className="p-8">Nombre del Producto</th>
                                <th className="p-8">Categoría</th>
                                <th className="p-8">Precio</th>
                                <th className="p-8 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {productosFiltrados.map(prod => (
                                <tr key={prod.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors group">
                                    <td className="p-8">
                                        <div className="font-black text-slate-800 uppercase text-sm leading-tight">{prod.nombre}</div>
                                        <div className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-tight">{prod.descripcion || 'SIN DESCRIPCIÓN'}</div>
                                    </td>
                                    <td className="p-8">
                                        <span className="inline-block px-4 py-1.5 rounded-full bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest border border-slate-800 whitespace-nowrap">
                                            {prod.categoria}
                                        </span>
                                    </td>
                                    <td className="p-8 font-black text-red-600 text-lg">
                                        ${Number(prod.precio).toLocaleString('es-CL')}
                                    </td>
                                    <td className="p-8 text-right">
                                        <div className="flex justify-end gap-3">
                                            <button onClick={() => iniciarEdicion(prod)} className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-400 hover:bg-slate-900 hover:text-white transition-all flex items-center justify-center shadow-sm" title="Editar"><i className="bi bi-pencil-fill text-xs"></i></button>
                                            <button onClick={() => eliminarProducto(prod.id, prod.nombre)} className="w-11 h-11 rounded-2xl bg-red-50 text-red-400 hover:bg-red-600 hover:text-white transition-all flex items-center justify-center shadow-sm" title="Eliminar"><i className="bi bi-trash3-fill text-xs"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {productosFiltrados.length === 0 && (
                        <div className="p-32 text-center">
                            <i className="bi bi-box-seam text-6xl text-slate-100 block mb-4"></i>
                            <span className="text-slate-300 font-black uppercase text-xs tracking-[0.3em]">No se encontraron resultados</span>
                        </div>
                    )}
                </div>
            </div>
            
            <style>{`
                .animate-fade-in { animation: fadeIn 0.4s ease-out; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
};

export default GestionProductos;