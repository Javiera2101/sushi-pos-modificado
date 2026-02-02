/* eslint-env node */
/* global require, process, __dirname */

const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

// 1. SOLUCIÓN A PANTALLA BLANCA EN LINUX/INTEL
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
      console.log("Icono no encontrado, usando genérico.");
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

// 3. LÓGICA DE IMPRESIÓN RAW (ESC/POS)
ipcMain.on('imprimir-ticket-raw', (event, data) => {
  console.log("🖨️ Generando Ticket RAW...");

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

  // --- FUNCIONES AUXILIARES DE FORMATEO ---
  const fmt = (num) => '$' + parseInt(num || 0).toLocaleString('es-CL');
  
  const limpiarTexto = (str) => {
    if(!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  };

  /**
   * Divide un texto en varias líneas si supera el límite de caracteres.
   * Límite bajado a 24 para asegurar compatibilidad total.
   */
  const formatearTextoLargo = (text, limite = 24) => {
    if (!text) return "";
    const palabras = text.split(' ');
    let lineas = [];
    let lineaActual = '';

    palabras.forEach(palabra => {
      // Si la palabra sola es más larga que el límite (ej. una dirección sin espacios)
      if (palabra.length > limite) {
        if (lineaActual !== '') {
          lineas.push(lineaActual);
          lineaActual = '';
        }
        for (let i = 0; i < palabra.length; i += limite) {
          lineas.push(palabra.substring(i, i + limite));
        }
        return;
      }

      const separador = lineaActual === '' ? '' : ' ';
      if ((lineaActual + separador + palabra).length <= limite) {
        lineaActual += separador + palabra;
      } else {
        lineas.push(lineaActual);
        lineaActual = palabra;
      }
    });

    if (lineaActual !== '') {
      lineas.push(lineaActual);
    }
    
    // Usamos \n para el buffer binario
    return lineas.filter(l => l.trim() !== '').join('\n');
  };

  let ticket = INIT;
  ticket += OPEN_DRAWER;

  // Encabezado
  ticket += ALIGN_CENTER + BOLD_ON + "ISAKARI SUSHI\n" + BOLD_OFF;
  ticket += "Calle Comercio #1757\n+56 9 813 51797\n\n";
  ticket += BOLD_ON + `PEDIDO #${data.numeroPedido}\n` + BOLD_OFF;
  
  // Cliente con wrap forzado
  const clienteLimpio = limpiarTexto(data.cliente || 'CLIENTE');
  ticket += `Cliente: ${formatearTextoLargo(clienteLimpio, 20)}\n`;
  ticket += `Fecha: ${data.fecha || ''}\n--------------------------------\n`;
 
  // DETALLE DE LA ORDEN
  ticket += ALIGN_LEFT;
  const orden = Array.isArray(data.orden) ? data.orden : [];
  orden.forEach(item => {
    // Nombre del producto con wrap a 24
    const nombreProd = formatearTextoLargo(limpiarTexto(item.nombre), 24);
    ticket += `${item.cantidad} x ${nombreProd}\n`;
    
    if (item.observacion && item.observacion.trim() !== "") {
      const obs = formatearTextoLargo(limpiarTexto(item.observacion), 22);
      ticket += `  * ${obs}\n`;
    }
    ticket += ALIGN_RIGHT + `${fmt(item.precio * item.cantidad)}\n` + ALIGN_LEFT;
  });

  ticket += "--------------------------------\n";

  const totalFinal = parseInt(data.total) || 0;
  const costoEnvio = parseInt(data.costoDespacho) || 0;
  const subTotal = totalFinal - costoEnvio;

  ticket += ALIGN_RIGHT;
  if (costoEnvio > 0) {
    ticket += `Envio: ${fmt(costoEnvio)}\n`;
  }

  ticket += ALIGN_CENTER + "\n" + BOLD_ON + `TOTAL: ${fmt(totalFinal)}\n` + BOLD_OFF;
 
  if(data.tipoEntrega === 'REPARTO') {
    ticket += "\n" + ALIGN_LEFT + BOLD_ON + "DATOS REPARTO:\n" + BOLD_OFF;
    // DIRECCIÓN: Wrap forzado a 24 caracteres (Máxima seguridad)
    const dirLimpia = limpiarTexto(data.direccion || 'Sin direccion');
    const direccionFormateada = formatearTextoLargo(dirLimpia, 24);
    ticket += `Dir: ${direccionFormateada}\n`;
    ticket += `Tel: ${data.telefono || ''}\n`;
  } else {
    ticket += "\n" + ALIGN_CENTER + "*** RETIRO EN LOCAL ***\n";
  }
 
  if (data.descripcion && data.descripcion.trim() !== "") {
    ticket += ALIGN_LEFT + "\n" + BOLD_ON + "OBS:\n" + BOLD_OFF;
    ticket += formatearTextoLargo(limpiarTexto(data.descripcion), 24) + "\n";
  }
 
  ticket += ALIGN_CENTER + "\nGracias por su compra!\n\n\n" + CUT;

  const tempPath = path.join(os.tmpdir(), 'ticket_raw.bin');
  fs.writeFileSync(tempPath, ticket, { encoding: 'binary' });

  exec(`lp -d impresora_termica -o raw "${tempPath}"`, (error) => {
    if (error) console.error(`❌ Error lp: ${error.message}`);
    else console.log(`✅ Ticket enviado.`);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});