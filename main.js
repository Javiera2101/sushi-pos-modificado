/* eslint-env node */
/* global require, process, __dirname */

const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

// Desactivar aceleración por hardware para evitar pantallas blancas
app.disableHardwareAcceleration();

let mainWindow;

// Control de instancia única para evitar múltiples ventanas abiertas
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
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false 
      },
      icon: appIcon 
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.maximize(); 

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

// --- ESCUCHA DE EVENTOS DE IMPRESIÓN FÍSICA RAW (ESC/POS 80mm) ---
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

  // Formateador de moneda chilena nativo para el ticket
  const fmt = (num) => '$' + parseInt(num || 0).toLocaleString('es-CL');
  
  // Limpia caracteres especiales y acentos para evitar símbolos extraños en la impresora térmica
  const limpiarTexto = (input) => {
    if (!input) return "";
    let str = input;
    if (Array.isArray(input)) {
        if (input.length > 0 && typeof input[0] === 'object') {
            str = input.map(i => i.nombre || i.name || i.label || JSON.stringify(i)).join(" ");
        } else {
            str = input.join(" ");
        }
    }
    if (typeof str !== 'string') {
        try { str = String(str); } catch(e) { str = ""; }
    }
    return str.normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "") 
              // IMPORTANTE: Aquí ahora respetamos \n (saltos de línea) y \r (retorno de carro)
              .replace(/[^\x20-\x7E\n\r]/g, "")    
              .toUpperCase();
  };

  // Ajuste automático de saltos de línea según el ancho del papel
  const wrapText = (text, limit = 48) => {
    if (!text) return "";
    // Separamos el texto usando los saltos de línea (enters) que haya escrito el usuario
    const paragraphs = text.split(/\r?\n/);
    let finalLines = [];

    paragraphs.forEach(paragraph => {
      // Si hay un enter en blanco, lo mantenemos como una línea vacía
      if (paragraph.trim() === '') {
          finalLines.push('');
          return;
      }
      const words = paragraph.split(' ');
      let currentLine = '';

      words.forEach(word => {
        if (word.length > limit) {
          if (currentLine) finalLines.push(currentLine);
          finalLines.push(word.substring(0, limit));
          currentLine = word.substring(limit);
          return;
        }
        const testLine = currentLine ? currentLine + ' ' + word : word;
        if (testLine.length <= limit) {
          currentLine = testLine;
        } else {
          finalLines.push(currentLine);
          currentLine = word;
        }
      });

      if (currentLine) finalLines.push(currentLine);
    });

    return finalLines.join('\n');
  };

  let ticket = INIT;
  const ANCHO = 48; // Ancho máximo de caracteres en impresoras térmicas de 80mm
  const SEPARATOR = "-".repeat(ANCHO) + "\n";

  try {
      // --- CASO 1: IMPRESIÓN DE INVENTARIO ---
      if (data.tipo === 'INVENTARIO') {
        ticket += ALIGN_CENTER + BOLD_ON + "ISAKARI SUSHI\n" + BOLD_OFF;
        ticket += "CONTROL DE INVENTARIO\n";
        ticket += `FECHA: ${data.fecha || ''}\n`;
        ticket += SEPARATOR + "\n";
        ticket += ALIGN_LEFT;

        const items = Array.isArray(data.items) ? data.items : [];
        items.forEach(insumo => {
          const nombre = limpiarTexto(insumo);
          ticket += nombre.padEnd(40, '.') + " __\n";
        });

        ticket += "\n" + SEPARATOR;
        ticket += ALIGN_CENTER + "FIN DEL REPORTE\n\n\n\n" + CUT;
      } 
      
      // --- CASO 2: IMPRESIÓN DE CIERRE DE CAJA DIARIO (Tu solicitud) ---
      else if (data.tipo === 'CIERRE_CAJA') {
        ticket += ALIGN_CENTER + BOLD_ON + "ISAKARI SUSHI\n" + BOLD_OFF;
        ticket += "REPORTE DE CIERRE DE CAJA\n";
        ticket += `FECHA TURNO: ${data.fecha || ''}\n`;
        if (data.usuario) {
            ticket += `USUARIO: ${limpiarTexto(data.usuario)}\n`;
        }
        ticket += SEPARATOR + "\n";
        ticket += ALIGN_LEFT;

        // Estructura de Montos de Caja de forma ordenada y alineada a la derecha
        ticket += `CAJA INICIAL:`.padEnd(30, ' ') + fmt(data.montoApertura).padStart(18, ' ') + "\n";
        ticket += `TOTAL VENTAS NETAS:`.padEnd(30, ' ') + fmt(data.totalVentasNetas).padStart(18, ' ') + "\n";
        ticket += `REPARTOS:`.padEnd(30, ' ') + fmt(data.totalEnvios).padStart(18, ' ') + "\n";
        ticket += `GASTOS CAJA:`.padEnd(30, ' ') + `-${fmt(data.totalGastos)}`.padStart(18, ' ') + "\n";
        
        ticket += SEPARATOR;
        ticket += BOLD_ON + "INGRESOS POR MEDIO DE PAGO:\n" + BOLD_OFF;
        ticket += ` - EFECTIVO:`.padEnd(30, ' ') + fmt(data.totalEfectivo).padStart(18, ' ') + "\n";
        ticket += ` - TRANSFERENCIAS:`.padEnd(30, ' ') + fmt(data.totalTransferencia).padStart(18, ' ') + "\n";
        ticket += ` - DEBITO:`.padEnd(30, ' ') + fmt(data.totalDebito).padStart(18, ' ') + "\n";
        
        ticket += SEPARATOR;
        ticket += BOLD_ON + `UTILIDAD NETA DIARIA:`.padEnd(30, ' ') + fmt(data.totalGanancia).padStart(18, ' ') + "\n" + BOLD_OFF;
        ticket += SEPARATOR;
        
        ticket += ALIGN_CENTER + BOLD_ON + "EFECTIVO EN CAJA:\n";
        ticket += `${fmt(data.montoCierreSistema)}\n\n` + BOLD_OFF;
        ticket += SEPARATOR;
        
        ticket += ALIGN_CENTER + "FIN DEL REPORTE DE CAJA\n\n\n\n" + CUT;
      }
      
      // --- CASO 3: IMPRESIÓN DE BOLETA DE VENTA NORMAL ---
      else {
        ticket += OPEN_DRAWER; // Abre la gaveta antes de imprimir
        ticket += ALIGN_CENTER + BOLD_ON + "ISAKARI SUSHI\n" + BOLD_OFF;
        ticket += "Calle Comercio #1757\n+56 9 8421 7160\n\n";
        ticket += BOLD_ON + `PEDIDO #${data.numeroPedido}\n` + BOLD_OFF;
        
        ticket += `Cliente: ${wrapText(limpiarTexto(data.cliente || 'CLIENTE'), 38)}\n`;
        ticket += `Fecha: ${data.fecha || ''}\n`;
        
        if (data.horaEntrega) {
            ticket += BOLD_ON + `ENTREGA: ${data.horaEntrega}\n` + BOLD_OFF;
        }
        
        ticket += SEPARATOR;
        ticket += ALIGN_LEFT;

        const orden = Array.isArray(data.orden) ? data.orden : [];
        orden.forEach(item => {
          const nombreLimpio = limpiarTexto(item.nombre);
          // CORRECCIÓN: Se reemplazó la variable inexistente "nombreLinter" por "nombreLimpio"
          const textoCompleto = `${item.cantidad} x ${nombreLimpio}`;
          
          ticket += BOLD_ON + wrapText(textoCompleto, ANCHO) + BOLD_OFF + "\n";

          const esProductoLargo = nombreLimpio.includes("MIXTO") || nombreLimpio.includes("PREMIUM");

          let descTexto = "";
          if (!esProductoLargo && item.descripcion) {
             if (Array.isArray(item.descripcion)) {
                 descTexto = item.descripcion.map(d => {
                     if (typeof d === 'object') return d.nombre || d.name || '';
                     return String(d);
                 }).join(", ");
             } else {
                 descTexto = String(item.descripcion);
             }
          }

          if (descTexto && descTexto.trim() !== "") {
            ticket += wrapText(limpiarTexto(descTexto), ANCHO) + "\n";
          }
          
          if (item.observacion) {
            let obsTexto = String(item.observacion);
            const obsLimpia = limpiarTexto(obsTexto);
            if (obsLimpia.trim() !== "") {
                ticket += wrapText(`  * ${obsLimpia}`, 46) + "\n";
            }
          }
          
          ticket += ALIGN_RIGHT + `${fmt(item.precio * item.cantidad)}\n` + ALIGN_LEFT;
        });

        ticket += SEPARATOR;
        if (parseInt(data.costoDespacho) > 0) {
          ticket += ALIGN_RIGHT + `Envio: ${fmt(data.costoDespacho)}\n`;
        }

        if (data.descuento && parseInt(data.descuento) > 0) {
            ticket += ALIGN_RIGHT + `Subtotal: ${fmt(data.total)}\n`;
            ticket += ALIGN_RIGHT + `DCTO 10% (PROD): -${fmt(data.descuento)}\n`;
            ticket += ALIGN_CENTER + "\n" + BOLD_ON + `TOTAL FINAL: ${fmt(data.total - data.descuento)}\n` + BOLD_OFF;
        } else {
            ticket += ALIGN_CENTER + "\n" + BOLD_ON + `TOTAL: ${fmt(data.total)}\n` + BOLD_OFF;
        }
    
        if(data.tipoEntrega === 'REPARTO') {
          ticket += "\n" + ALIGN_LEFT + BOLD_ON + "DATOS REPARTO:\n" + BOLD_OFF;
          const dirLimpia = wrapText(`Dir: ${limpiarTexto(data.direccion)}`, ANCHO);
          ticket += `${dirLimpia}\nTel: ${data.telefono || ''}\n`;
        } else {
          ticket += "\n" + ALIGN_CENTER + "*** RETIRO EN LOCAL ***\n";
        }

        if (data.descripcion && data.descripcion.trim() !== "") {
          ticket += ALIGN_LEFT + "\n" + BOLD_ON + "OBSERVACIONES:\n" + BOLD_OFF;
          ticket += wrapText(limpiarTexto(data.descripcion), ANCHO) + "\n";
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

        ticket += ALIGN_CENTER + "\n" + SEPARATOR;
        ticket += BOLD_ON + textoPago + BOLD_OFF + "\n";
        ticket += SEPARATOR;

        ticket += ALIGN_CENTER + "\nGracias por su compra!\n\n\n" + CUT;
      }

      // Guardar de forma temporal el binario del ticket
      const uniqueId = Date.now();
      const tempPath = path.join(os.tmpdir(), `ticket_80_${uniqueId}.bin`);
      fs.writeFileSync(tempPath, ticket, { encoding: 'binary' });

      // Comando lp para enviar raw en sistemas Linux (POS estándar)
      const comando = `/usr/bin/lp -d impresora_pos80 -o raw "${tempPath}"`;

      exec(comando, (error) => {
        if (error) {
            console.error(`❌ Error con /usr/bin/lp: ${error.message}`);
            // Fallback lp general
            exec(`lp -d impresora_pos80 -o raw "${tempPath}"`, (err2) => {
                if (err2) console.error("❌ Fallback error:", err2.message);
                setTimeout(() => { try { fs.unlinkSync(tempPath); } catch(e) {} }, 5000);
            });
        } else {
            console.log("✅ Ticket impreso con éxito en Linux");
            setTimeout(() => { try { fs.unlinkSync(tempPath); } catch(e) {} }, 5000);
        }
      });

  } catch (errGlobal) {
      console.error("CRASH EVITADO EN IMPRESIÓN:", errGlobal);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});