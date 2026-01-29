/* eslint-env node */
/* global require, process, __dirname */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false 
    },
    icon: path.join(__dirname, 'src/images/logo.png') 
  });

  win.setMenuBarVisibility(false);

  // --- 1. LÓGICA DE ESPERA (Arregla el error de conexión) ---
  if (app.isPackaged) {
      win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
      const cargarDevServer = () => {
          console.log("🔄 [SISTEMA] Intentando conectar con Vite...");
          win.loadURL('http://localhost:5173')
            .then(() => console.log("✅ [SISTEMA] ¡Conectado a Vite correctamente!"))
            .catch(() => {
                console.log("⏳ [SISTEMA] Vite aún no está listo. Reintentando en 1 segundo...");
                setTimeout(cargarDevServer, 1000);
            });
      };
      cargarDevServer();
  }
  
  // --- 2. MANEJADOR DE IMPRESIÓN CON DIAGNÓSTICO ---
  ipcMain.on('imprimir-ticket', async (event) => {
    console.log("\n--- 🖨️ INICIO INTENTO DE IMPRESIÓN ---");
    
    // Listar impresoras para ver si Electron las detecta
    const printers = await win.webContents.getPrintersAsync();
    console.log(`🔎 Se detectaron ${printers.length} impresoras en el sistema.`);
    
    const defaultPrinter = printers.find(p => p.isDefault);
    
    if (!defaultPrinter) {
        // SI SALE ESTE ERROR: Ve a http://localhost:631 y marca una como "Set as Server Default"
        console.error("❌ ERROR CRÍTICO: No hay ninguna impresora marcada como 'Predeterminada' (Default).");
        console.log("--- FIN PROCESO (CANCELADO) ---\n");
        return;
    }

    console.log(`✅ Impresora seleccionada: "${defaultPrinter.name}"`);

    const options = {
      silent: true,
      printBackground: true,
      deviceName: defaultPrinter.name // Nombre exacto de la impresora
    };

    // Intentar imprimir
    win.webContents.print(options, (success, errorType) => {
        if (!success) {
            console.error("❌ FALLÓ LA IMPRESIÓN. Razón:", errorType);
        } else {
            console.log("✅ ÉXITO: Enviado a la cola de impresión.");
        }
        console.log("--- FIN PROCESO ---\n");
    });
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});