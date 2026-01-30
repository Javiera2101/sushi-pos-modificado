const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Variable para la ventana principal
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Permite que React use 'require' si es necesario
    },
    icon: path.join(__dirname, 'public/logo.png'),
    // Mostramos la ventana solo cuando esté lista para evitar el destello blanco
    show: false 
  });

  const devUrl = 'http://localhost:5173';

  // --- LÓGICA DE CARGA RESILIENTE ---
  
  const loadWithRetry = () => {
    console.log("🔗 Intentando conectar con el servidor de desarrollo...");
    mainWindow.loadURL(devUrl).catch(() => {
      console.log("⏳ El servidor Vite aún no responde. Reintentando en 1s...");
      setTimeout(loadWithRetry, 1000);
    });
  };

  // Evento que se dispara si la carga falla (por ejemplo, servidor caído temporalmente)
  mainWindow.webContents.on('did-fail-load', () => {
    console.log("⚠️ Fallo en la carga inicial. Reintentando...");
    setTimeout(loadWithRetry, 1000);
  });

  // Mostrar la ventana solo cuando el contenido haya cargado realmente
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Opcional: Abrir herramientas si quieres ver errores de React directamente
    // mainWindow.webContents.openDevTools(); 
  });

  // Iniciar el ciclo de carga
  loadWithRetry();
}

app.whenReady().then(createWindow);

// --- LÓGICA DE IMPRESIÓN SEGURA (ANTI-CRASH) ---
ipcMain.on('imprimir-ticket-raw', (event, data) => {
  if (!data) {
    console.error("❌ Error: Se recibió un evento de impresión sin datos.");
    return;
  }

  // SEGURO: Garantizamos que 'items' sea siempre una lista para evitar el error .forEach
  const itemsParaImprimir = (data.items && Array.isArray(data.items)) ? data.items : [];

  console.log(`🖨️ Procesando ticket para Pedido #${data.numeroPedido || 'S/N'}`);

  try {
    if (itemsParaImprimir.length === 0) {
      console.warn("⚠️ Advertencia: El pedido no contiene productos.");
    }

    itemsParaImprimir.forEach(item => {
      const nombre = item.nombre || 'Producto';
      const cant = item.cantidad || 0;
      const precio = item.precio || 0;
      
      // Aquí se enviarían los comandos ESC/POS a la impresora térmica
      console.log(` > ${cant}x ${nombre} - Total: $${precio * cant}`);
    });

    console.log("✅ Datos procesados correctamente.");

  } catch (error) {
    console.error("❌ Error crítico en el proceso de impresión:", error.message);
  }
});

// Manejo de cierre de aplicación
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});