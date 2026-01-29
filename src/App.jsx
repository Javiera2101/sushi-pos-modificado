import React, { useState, useEffect } from 'react';
import './css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css'; 
import './css/App.css'; 
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, query, where, getDocs, addDoc, Timestamp } from 'firebase/firestore'; 
import { db, auth } from './firebase.js'; 

import { TomarPedido } from './TomarPedido.jsx';
import { HistorialPedidos } from './HistorialPedidos.jsx'; 
import { Gastos } from './Gastos.jsx';
import { Caja } from './Caja.jsx'; 
import { GestionProductos } from './GestionProductos.jsx'; 
import { UiProvider, useUi } from './context/UiContext.jsx';

import logoColor from './images/logoColor.png';
import logo from './images/logo.png';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError('Credenciales incorrectas');
    }
  };

  return (
    <div className="vh-100 d-flex align-items-center justify-content-center bg-dark">
        <div className="card p-4 shadow-lg" style={{width: '350px'}}>
            <div className="text-center mb-4">
                <img src={logoColor} alt="Logo" style={{width: '80px'}} />
                <h3 className="mt-2">Acceso POS</h3>
            </div>
            {error && <div className="alert alert-danger p-2 small">{error}</div>}
            <form onSubmit={handleLogin}>
                <div className="mb-3">
                    <input type="email" className="form-control" placeholder="Correo" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
                </div>
                <div className="mb-3">
                    <input type="password" className="form-control" placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)} />
                </div>
                <button type="submit" className="btn btn-danger w-100 fw-bold">INGRESAR</button>
            </form>
        </div>
    </div>
  );
};

function AppContent() { 
  const { notificar } = useUi();
  const [seccion, setSeccion] = useState('PEDIDO'); 
  const [ordenParaEditar, setOrdenParaEditar] = useState(null);
  const [user, setUser] = useState(null); 
  const [loading, setLoading] = useState(true); 

  // Estado para Modal de Apertura
  const [necesitaApertura, setNecesitaApertura] = useState(false);
  const [montoApertura, setMontoApertura] = useState('');
  const [cargandoApertura, setCargandoApertura] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        setUser(currentUser);
        setLoading(false);
        if (currentUser) await verificarCajaAbierta(currentUser.email);
    });
    return unsubscribe; 
  }, []);

  const verificarCajaAbierta = async (email) => {
      const esPrueba = email === "prueba@isakari.com";
      const COL_CAJAS = esPrueba ? "cajas_pruebas" : "cajas";
      const q = query(collection(db, COL_CAJAS), where("estado", "==", "abierta"));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
          setNecesitaApertura(true);
      } else {
          setNecesitaApertura(false);
      }
  };

  const handleAbrirCaja = async (e) => {
      e.preventDefault();
      if (!montoApertura) return notificar("Ingresa un monto válido", "error");
      
      setCargandoApertura(true);
      const email = user.email;
      const esPrueba = email === "prueba@isakari.com";
      const COL_CAJAS = esPrueba ? "cajas_pruebas" : "cajas";

      try {
          await addDoc(collection(db, COL_CAJAS), {
              fecha_apertura: Timestamp.now(),
              monto_apertura: Number(montoApertura),
              estado: "abierta",
              usuario_apertura: email,
              fechaString: new Date().toISOString().split('T')[0]
          });
          notificar("Caja abierta con éxito", "success");
          setNecesitaApertura(false);
      } catch (error) {
          console.error(error);
          notificar("Error al abrir caja", "error");
      } finally {
          setCargandoApertura(false);
      }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setSeccion('PEDIDO');
  };

  const handleEditarPedido = (orden) => {
    setOrdenParaEditar(orden);
    setSeccion('PEDIDO'); 
  };

  const handleTerminarEdicion = () => {
    setOrdenParaEditar(null);
    setSeccion('HISTORIAL'); 
  };

  const irANuevoPedido = () => {
    setOrdenParaEditar(null);
    setSeccion('PEDIDO');
  }

  if (loading) return <div>Cargando...</div>;
  if (!user) return <Login />;

  return (
    <div className="d-flex flex-column vh-100 position-relative">
      
      {/* MODAL DE APERTURA */}
      {necesitaApertura && (
          <div className="fixed inset-0 bg-black bg-opacity-90 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-200">
                  <div className="bg-gradient-to-r from-blue-600 to-blue-500 p-6 text-center">
                      <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 text-white text-3xl"><i className="bi bi-shop"></i></div>
                      <h2 className="text-white font-bold text-2xl">Apertura de Caja</h2>
                      <p className="text-blue-100 text-sm">Bienvenido, {user.email}</p>
                  </div>
                  <form onSubmit={handleAbrirCaja} className="p-8">
                      <label className="block text-gray-700 font-bold mb-2">¿Con cuánto efectivo inicias?</label>
                      <div className="input-group mb-4">
                          <span className="input-group-text bg-gray-100 border-gray-300 text-gray-500">$</span>
                          <input type="number" className="form-control form-control-lg border-gray-300" placeholder="0" value={montoApertura} onChange={e => setMontoApertura(e.target.value)} autoFocus min="0" />
                      </div>
                      <button type="submit" className="w-full btn btn-primary btn-lg fw-bold shadow-lg" disabled={cargandoApertura}>
                          {cargandoApertura ? 'Abriendo...' : 'ABRIR TURNO'}
                      </button>
                      <div className="mt-4 text-center">
                        <button type="button" onClick={handleLogout} className="text-sm text-gray-400 hover:text-red-500 underline">Cancelar y Salir</button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {/* --- NAVBAR COMPACTA --- */}
      <nav className="navbar navbar-dark bg-dark px-3 border-bottom border-secondary d-flex align-items-center" style={{height: '50px', minHeight: '50px'}}>
        <a className="navbar-brand d-flex align-items-center" href="#">
            <img src={logo} alt="IsaKari" style={{ maxHeight: '35px', width: 'auto' }} className="me-2"/>
            <span className="fw-bold text-white d-none d-md-block" style={{fontSize: '1rem'}}>POS</span>
        </a>
        <div className="d-flex gap-2 align-items-center flex-wrap justify-content-end ms-auto">
            <span className="text-white me-2 d-none d-lg-inline" style={{fontSize: '0.75rem'}}><i className="bi bi-person-fill"></i> {user.email}</span>
          
          <button 
            className={`btn btn-sm fw-bold ${seccion === 'PEDIDO' ? 'btn-warning' : 'btn-outline-secondary'}`} 
            onClick={irANuevoPedido} 
            disabled={necesitaApertura}
            style={{fontSize: '0.8rem', padding: '0.2rem 0.6rem'}}
          >
            <i className={`bi ${ordenParaEditar ? 'bi-pencil-square' : 'bi bi-plus-lg'}`}></i>
            <span className="d-none d-sm-inline ms-1">{ordenParaEditar ? 'Edit' : 'Pedido'}</span>
          </button>
          
          <button 
            className={`btn btn-sm fw-bold ${seccion === 'HISTORIAL' ? 'btn-primary' : 'btn-outline-secondary'}`} 
            onClick={() => setSeccion('HISTORIAL')} 
            disabled={necesitaApertura}
            style={{fontSize: '0.8rem', padding: '0.2rem 0.6rem'}}
          >
            <i className="bi bi-clock-history"></i> <span className="d-none d-sm-inline ms-1">Historial</span>
          </button>

           <button 
            className={`btn btn-sm fw-bold ${seccion === 'GASTOS' ? 'btn-danger' : 'btn-outline-secondary'}`} 
            onClick={() => setSeccion('GASTOS')} 
            disabled={necesitaApertura}
            style={{fontSize: '0.8rem', padding: '0.2rem 0.6rem'}}
           >
            <i className="bi bi-cart-dash"></i> <span className="d-none d-sm-inline ms-1">Gastos</span>
          </button>
          
          <button 
            className={`btn btn-sm fw-bold ${seccion === 'CAJA' ? 'btn-info text-white' : 'btn-outline-secondary'}`} 
            onClick={() => setSeccion('CAJA')} 
            disabled={necesitaApertura}
            style={{fontSize: '0.8rem', padding: '0.2rem 0.6rem'}}
          >
            <i className="bi bi-cash-coin"></i> <span className="d-none d-sm-inline ms-1">Caja</span>
          </button>

          <button 
            className={`btn btn-sm fw-bold ${seccion === 'PRODUCTOS' ? 'btn-success' : 'btn-outline-secondary'}`} 
            onClick={() => setSeccion('PRODUCTOS')} 
            disabled={necesitaApertura}
            style={{fontSize: '0.8rem', padding: '0.2rem 0.6rem'}}
          >
            <i className="bi bi-box-seam"></i> <span className="d-none d-sm-inline ms-1">Productos</span>
          </button>
          
          <button 
            className="btn btn-outline-danger btn-sm" 
            onClick={handleLogout} 
            title="Salir"
            style={{fontSize: '0.8rem', padding: '0.2rem 0.6rem'}}
          >
            <i className="bi bi-box-arrow-right"></i>
          </button>
        </div>
      </nav>

      {/* CONTENEDOR PRINCIPAL */}
      <div className="flex-grow-1 overflow-hidden bg-light h-100 position-relative">
        {seccion === 'PEDIDO' && <TomarPedido key={ordenParaEditar ? ordenParaEditar.id : 'nueva-orden'} ordenAEditar={ordenParaEditar} onTerminarEdicion={handleTerminarEdicion} />}
        {seccion === 'HISTORIAL' && <HistorialPedidos onEditar={handleEditarPedido} />}
        {seccion === 'GASTOS' && <Gastos />}
        {seccion === 'CAJA' && <Caja user={user} />}
        {seccion === 'PRODUCTOS' && <GestionProductos />}
      </div>
    </div>
  );
}

export default function App() {
    return (
        <UiProvider>
            <AppContent />
        </UiProvider>
    );
}