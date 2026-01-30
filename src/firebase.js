import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  enableIndexedDbPersistence 
} from "firebase/firestore";
import { 
  getAuth, 
  setPersistence, 
  browserLocalPersistence 
} from "firebase/auth";

// 1. Configuración de Firebase
// REEMPLAZA LOS VALORES DE ABAJO CON LOS DE TU PROYECTO FIREBASE
// (Los encuentras en Consola Firebase -> Configuración del proyecto -> General -> Tus apps)

const firebaseConfig = {
  apiKey: "AIzaSyCnHl35ah-tmjDy4_rUNq-Q5iizrBuBhWI",
  authDomain: "sushi-b002f.firebaseapp.com",
  projectId: "sushi-b002f",
  storageBucket: "sushi-b002f.firebasestorage.app",
  messagingSenderId: "151574461812",
  appId: "1:151574461812:web:ad19bddf83a9d8ff0c0021"
};

// 2. Inicializar la aplicación
const app = initializeApp(firebaseConfig);

// 3. Inicializar servicios
const db = getFirestore(app);
const auth = getAuth(app);

// 4. Activar Persistencia de Base de Datos (Modo Offline)
// Esto permite guardar datos sin internet y sincronizarlos luego
enableIndexedDbPersistence(db, { forceOwnership: false })
  .catch((err) => {
    if (err.code == 'failed-precondition') {
      // Múltiples pestañas abiertas pueden causar este error
      console.warn('La persistencia de datos solo funciona en una pestaña a la vez.');
    } else if (err.code == 'unimplemented') {
      // El navegador no soporta esta característica
      console.warn('El navegador no soporta persistencia local (IndexedDB).');
    }
  });

// 5. Activar Persistencia de Sesión (Login)
// Esto evita que el usuario tenga que iniciar sesión cada vez que abre la app
setPersistence(auth, browserLocalPersistence)
  .then(() => {
    console.log("Sistema de sesión persistente activado.");
  })
  .catch((error) => {
    console.error("Error al configurar la persistencia de sesión:", error);
  });

// Exportamos las instancias para usarlas en el resto de la app
export { db, auth };