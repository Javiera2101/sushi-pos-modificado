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
  
  // FUNCIÓN DE LIMPIEZA AGRESIVA (ANTI-ERROR DE IMPRESORA)
  const limpiarTexto = (input) => {
    if (!input) return "";
    
    let str = input;
    
    // Si es un array simple, lo unimos
    if (Array.isArray(input)) {
        // Intentamos mapear si son objetos con propiedad 'nombre' o 'label'
        if (input.length > 0 && typeof input[0] === 'object') {
            str = input.map(i => i.nombre || i.name || i.label || JSON.stringify(i)).join(" ");
        } else {
            str = input.join(" ");
        }
    }
    
    // Aseguramos string
    if (typeof str !== 'string') {
        try { str = String(str); } catch(e) { str = ""; }
    }

    // 1. Normalizar caracteres (tildes)
    // 2. Eliminar todo lo que NO sea ASCII estándar (Emojis, símbolos raros que bloquean impresoras)
    // 3. Convertir a Mayúsculas
    return str.normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "") // Quitar tildes
              .replace(/[^\x20-\x7E]/g, "")    // CRÍTICO: Eliminar caracteres no imprimibles/raros
              .toUpperCase();
  };

  /**
   * FUNCIÓN DE AJUSTE INTELIGENTE (Word Wrap)
   */
  const wrapText = (text, limit = 32) => {
    if (!text) return "";
    const words = text.split(' ');
    let lines = [];
    let currentLine = '';

    words.forEach(word => {
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

  try {
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
        ticket += `Fecha: ${data.fecha || ''}\n`;
        
        if (data.horaEntrega) {
            ticket += BOLD_ON + `ENTREGA: ${data.horaEntrega}\n` + BOLD_OFF;
        }
        
        ticket += "--------------------------------\n";
        ticket += ALIGN_LEFT;

        const orden = Array.isArray(data.orden) ? data.orden : [];
        orden.forEach(item => {
          const nombreLimpio = limpiarTexto(item.nombre);
          
          // Imprimir Nombre y Cantidad
          const textoCompleto = `${item.cantidad} x ${nombreLimpio}`;
          ticket += BOLD_ON + wrapText(textoCompleto, 32) + BOLD_OFF + "\n";

          // --- FILTRO ROBUSTO PARA NO IMPRIMIR INGREDIENTES LARGOS ---
          // Detectamos palabras clave que indican "Combo" o "Mix"
          const esProductoLargo = nombreLimpio.includes("MIXTO") || 
                                  nombreLimpio.includes("PREMIUM") || 
                                  nombreLimpio.includes("PROMO") || 
                                  nombreLimpio.includes("TABLA") || 
                                  nombreLimpio.includes("COMBINADO");

          // Procesamiento seguro de descripción
          let descTexto = "";
          
          if (!esProductoLargo && item.descripcion) {
             // Manejo seguro de Arrays y Objetos para evitar errores
             if (Array.isArray(item.descripcion)) {
                 descTexto = item.descripcion.map(d => {
                     if (typeof d === 'object') return d.nombre || d.name || '';
                     return String(d);
                 }).join(", ");
             } else {
                 descTexto = String(item.descripcion);
             }
          }

          // Imprimimos descripción SOLO si no es "Largo" y tiene texto válido
          if (descTexto && descTexto.trim() !== "") {
            ticket += wrapText(limpiarTexto(descTexto), 32) + "\n";
          }
          
          // Notas (Observaciones) - Siempre se intentan imprimir, limpiando caracteres raros
          if (item.observacion) {
            let obsTexto = "";
            if (typeof item.observacion === 'object') {
                 obsTexto = JSON.stringify(item.observacion); // Fallback por si acaso
            } else {
                 obsTexto = String(item.observacion);
            }
            const obsLimpia = limpiarTexto(obsTexto);
            if (obsLimpia.trim() !== "") {
                ticket += wrapText(`  * ${obsLimpia}`, 30) + "\n";
            }
          }
          
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

        if (data.descripcion && data.descripcion.trim() !== "") {
          ticket += ALIGN_LEFT + "\n" + BOLD_ON + "OBSERVACIONES:\n" + BOLD_OFF;
          ticket += wrapText(limpiarTexto(data.descripcion), 32) + "\n";
        }

        let textoPago = "PAGO PENDIENTE";
        if (data.estadoPago && data.estadoPago.toString().toUpperCase() === 'PAGADO') {
            if (Array.isArray(data.detallesPago) && data.detallesPago.length > 0) {
                const metodos = data.detallesPago.map(d => limpiarTexto(d.metodo)).join(' Y ');
                textoPago = `PAGADO CON ${metodos}`;
            } else {
                textoPago = `PAGADO CON ${limpiarTexto(data.metodoPago || 'EFECTIVO')}`;
            }
        }

        ticket += ALIGN_CENTER + "\n--------------------------------\n";
        ticket += BOLD_ON + textoPago + BOLD_OFF + "\n";
        ticket += "--------------------------------\n";

        ticket += ALIGN_CENTER + "\nGracias por su compra!\n\n\n" + CUT;
      }

      // Guardar y ejecutar comando de impresión
      const tempPath = path.join(os.tmpdir(), 'ticket_raw.bin');
      fs.writeFileSync(tempPath, ticket, { encoding: 'binary' });

      exec(`lp -d impresora_termica -o raw "${tempPath}"`, (error) => {
        if (error) console.error(`❌ Error lp: ${error.message}`);
      });

  } catch (errGlobal) {
      console.error("CRASH EVITADO EN IMPRESIÓN:", errGlobal);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});