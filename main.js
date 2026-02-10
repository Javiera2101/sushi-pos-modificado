/* eslint-env node */
/* global require, process, __dirname */

const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

// 1. SOLUCIÓN A PANTALLA BLANCA
app.disableHardwareAcceleration();

let mainWindow;

// 2. PROTECCIÓN CONTRA EL ERROR DE LOCK (Instancia Única)
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

// 3. LÓGICA DE IMPRESIÓN RAW (ESC/POS) - REPARADO PARA NOTAS
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
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  };

  /**
   * Ajuste de texto para que no se corte bruscamente
   */
  const wrap = (text, limit = 32) => {
    if (!text) return "";
    let words = text.split(' ');
    let lines = [];
    let currentLine = '';

    words.forEach(word => {
      if ((currentLine + ' ' + word).length <= limit) {
        currentLine += (currentLine === '' ? '' : ' ') + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    });
    lines.push(currentLine);
    return lines.join('\n');
  };

  let ticket = INIT;

  // --- CASO A: INVENTARIO (LIMPIO) ---
  if (data.tipo === 'INVENTARIO') {
    ticket += ALIGN_CENTER + BOLD_ON + "ISAKARI SUSHI\n" + BOLD_OFF;
    ticket += "CONTROL DE INVENTARIO\n";
    ticket += `FECHA: ${data.fecha || ''}\n`;
    ticket += "--------------------------------\n\n";
    ticket += ALIGN_LEFT;

    const items = Array.isArray(data.items) ? data.items : [];
    items.forEach(insumo => {
      const nombre = limpiarTexto(insumo);
      ticket += nombre.padEnd(22, '.') + " ____\n";
    });

    ticket += "\n--------------------------------\n";
    ticket += ALIGN_CENTER + "FIN DEL REPORTE\n\n\n\n" + CUT;
  } 
  // --- CASO B: VENTA (CON NOTAS REPARADAS) ---
  else {
    ticket += OPEN_DRAWER;
    ticket += ALIGN_CENTER + BOLD_ON + "ISAKARI SUSHI\n" + BOLD_OFF;
    ticket += "Calle Comercio #1757\n+56 9 813 51797\n\n";
    ticket += BOLD_ON + `PEDIDO #${data.numeroPedido}\n` + BOLD_OFF;
    ticket += `Cliente: ${limpiarTexto(data.cliente || 'CLIENTE')}\n`;
    ticket += `Fecha: ${data.fecha || ''}\n--------------------------------\n`;
    ticket += ALIGN_LEFT;

    const orden = Array.isArray(data.orden) ? data.orden : [];
    orden.forEach(item => {
      // Nombre del producto
      ticket += `${item.cantidad} x ${limpiarTexto(item.nombre)}\n`;
      
      // NOTAS ESPECÍFICAS DEL PRODUCTO
      if (item.observacion && item.observacion.trim() !== "") {
        ticket += `  * ${limpiarTexto(item.observacion)}\n`;
      }
      
      // Precio a la derecha
      ticket += ALIGN_RIGHT + `${fmt(item.precio * item.cantidad)}\n` + ALIGN_LEFT;
    });

    ticket += "--------------------------------\n";
    if (parseInt(data.costoDespacho) > 0) {
      ticket += ALIGN_RIGHT + `Envio: ${fmt(data.costoDespacho)}\n`;
    }
    ticket += ALIGN_CENTER + "\n" + BOLD_ON + `TOTAL: ${fmt(data.total)}\n` + BOLD_OFF;
 
    if(data.tipoEntrega === 'REPARTO') {
      ticket += "\n" + ALIGN_LEFT + BOLD_ON + "DATOS REPARTO:\n" + BOLD_OFF;
      ticket += `Dir: ${wrap(limpiarTexto(data.direccion), 30)}\nTel: ${data.telefono || ''}\n`;
    } else {
      ticket += "\n" + ALIGN_CENTER + "*** RETIRO EN LOCAL ***\n";
    }

    // NOTAS GENERALES DEL PEDIDO
    if (data.descripcion && data.descripcion.trim() !== "") {
      ticket += ALIGN_LEFT + "\n" + BOLD_ON + "OBSERVACIONES:\n" + BOLD_OFF;
      ticket += `${wrap(limpiarTexto(data.descripcion), 32)}\n`;
    }

    ticket += ALIGN_CENTER + "\nGracias por su compra!\n\n\n" + CUT;
  }

  const tempPath = path.join(os.tmpdir(), 'ticket_raw.bin');
  fs.writeFileSync(tempPath, ticket, { encoding: 'binary' });

  exec(`lp -d impresora_termica -o raw "${tempPath}"`, (error) => {
    if (error) console.error(`❌ Error lp: ${error.message}`);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});