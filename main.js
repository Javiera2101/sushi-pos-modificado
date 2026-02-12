/* eslint-env node */
/* global require, process, __dirname */

const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

// 1. SOLUCIÓN A PANTALLA BLANCA Y RENDIMIENTO
app.disableHardwareAcceleration();

let mainWindow;

// 2. PROTECCIÓN CONTRA INSTANCIA MÚLTIPLE (Single Instance Lock)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.exit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow() {
    let appIcon;
    try {
      const iconPath = path.join(__dirname, 'icon.png'); 
      appIcon = nativeImage.createFromPath(iconPath);
    } catch (e) {
      console.log("Icono no encontrado.");
    }

    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: "Isakari Sushi POS",
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false 
      },
      icon: appIcon 
    });

    mainWindow.setMenuBarVisibility(false);

    if (app.isPackaged) {
      mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
    } else {
      const conectarConVite = () => {
        mainWindow.loadURL('http://localhost:5173')
          .then(() => console.log("✅ Conectado a Vite."))
          .catch(() => { setTimeout(conectarConVite, 1000); });
      };
      conectarConVite();
    }
  }

  app.whenReady().then(createWindow);
}

// 3. LÓGICA DE IMPRESIÓN RAW (ESC/POS) MEJORADA
ipcMain.on('imprimir-ticket-raw', (event, data) => {
  const ESC = '\x1B';
  const GS = '\x1D';
  const INIT = ESC + '@';
  const ALIGN_CENTER = ESC + 'a' + '\x01';
  const ALIGN_LEFT = ESC + 'a' + '\x00';
  const ALIGN_RIGHT = ESC + 'a' + '\x02';
  const BOLD_ON = ESC + 'E' + '\x01';
  const BOLD_OFF = ESC + 'E' + '\x00';
  const CUT = GS + 'V' + '\x41' + '\x00'; 
  const OPEN_DRAWER = ESC + 'p' + '\x00' + '\x19' + '\xFA'; 

  const fmt = (num) => '$' + parseInt(num || 0).toLocaleString('es-CL');
  
  const limpiarTexto = (str) => {
    if(!str) return "";
    // Elimina tildes y caracteres especiales para evitar errores en la impresora
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  };

  /**
   * FUNCIÓN DE AJUSTE INTELIGENTE (Word Wrap)
   * Evita que las palabras se corten a la mitad.
   */
  const wrapText = (text, limit = 32) => {
    if (!text) return "";
    const words = text.split(' ');
    let lines = [];
    let currentLine = '';

    words.forEach(word => {
      // Si la palabra sola es más larga que el límite, hay que cortarla (caso raro en comida)
      if (word.length > limit) {
        if (currentLine) lines.push(currentLine);
        lines.push(word.substring(0, limit));
        currentLine = word.substring(limit);
        return;
      }

      const testLine = currentLine ? currentLine + ' ' + word : word;
      if (testLine.length <= limit) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    });

    if (currentLine) lines.push(currentLine);
    return lines.join('\n');
  };

  let ticket = INIT;

  // --- CASO A: INVENTARIO (LISTA LIMPIA) ---
  if (data.tipo === 'INVENTARIO') {
    ticket += ALIGN_CENTER + BOLD_ON + "ISAKARI SUSHI\n" + BOLD_OFF;
    ticket += "CONTROL DE INVENTARIO\n";
    ticket += `FECHA: ${data.fecha || ''}\n`;
    ticket += "--------------------------------\n\n";
    ticket += ALIGN_LEFT;

    const items = Array.isArray(data.items) ? data.items : [];
    items.forEach(insumo => {
      const nombre = limpiarTexto(insumo);
      // Ajuste de puntos para que no salte de línea
      ticket += nombre.padEnd(22, '.') + " ____\n";
    });

    ticket += "\n--------------------------------\n";
    ticket += ALIGN_CENTER + "FIN DEL REPORTE\n\n\n\n" + CUT;
  } 
  // --- CASO B: VENTA (CON AJUSTE DE PALABRAS MEJORADO) ---
  else {
    ticket += OPEN_DRAWER;
    ticket += ALIGN_CENTER + BOLD_ON + "ISAKARI SUSHI\n" + BOLD_OFF;
    ticket += "Calle Comercio #1757\n+56 9 813 51797\n\n";
    ticket += BOLD_ON + `PEDIDO #${data.numeroPedido}\n` + BOLD_OFF;
    ticket += `Cliente: ${wrapText(limpiarTexto(data.cliente || 'CLIENTE'), 22)}\n`;
    ticket += `Fecha: ${data.fecha || ''}\n--------------------------------\n`;
    ticket += ALIGN_LEFT;

    const orden = Array.isArray(data.orden) ? data.orden : [];
    orden.forEach(item => {
      // Unificamos cantidad y nombre para el ajuste de línea
      const textoCompleto = `${item.cantidad} x ${limpiarTexto(item.nombre)}`;
      
      // Aplicamos wrapText al bloque completo para que no se corte "QUESO"
      ticket += wrapText(textoCompleto, 32) + "\n";
      
      // Notas específicas del producto (Si existen)
      if (item.observacion && item.observacion.trim() !== "") {
        ticket += wrapText(`  * ${limpiarTexto(item.observacion)}`, 30) + "\n";
      }
      
      // Precio alineado a la derecha
      ticket += ALIGN_RIGHT + `${fmt(item.precio * item.cantidad)}\n` + ALIGN_LEFT;
    });

    ticket += "--------------------------------\n";
    if (parseInt(data.costoDespacho) > 0) {
      ticket += ALIGN_RIGHT + `Envio: ${fmt(data.costoDespacho)}\n`;
    }
    ticket += ALIGN_CENTER + "\n" + BOLD_ON + `TOTAL: ${fmt(data.total)}\n` + BOLD_OFF;
 
    if(data.tipoEntrega === 'REPARTO') {
      ticket += "\n" + ALIGN_LEFT + BOLD_ON + "DATOS REPARTO:\n" + BOLD_OFF;
      const dirLimpia = wrapText(`Dir: ${limpiarTexto(data.direccion)}`, 32);
      ticket += `${dirLimpia}\nTel: ${data.telefono || ''}\n`;
    } else {
      ticket += "\n" + ALIGN_CENTER + "*** RETIRO EN LOCAL ***\n";
    }

    // Notas generales del pedido
    if (data.descripcion && data.descripcion.trim() !== "") {
      ticket += ALIGN_LEFT + "\n" + BOLD_ON + "OBSERVACIONES:\n" + BOLD_OFF;
      ticket += wrapText(limpiarTexto(data.descripcion), 32) + "\n";
    }

    ticket += ALIGN_CENTER + "\nGracias por su compra!\n\n\n" + CUT;
  }

  // Guardar y ejecutar comando de impresión local (funciona OFFLINE)
  const tempPath = path.join(os.tmpdir(), 'ticket_raw.bin');
  fs.writeFileSync(tempPath, ticket, { encoding: 'binary' });

  exec(`lp -d impresora_termica -o raw "${tempPath}"`, (error) => {
    if (error) console.error(`❌ Error lp: ${error.message}`);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});