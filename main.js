/* eslint-env node */
/* global require, process, __dirname */

const { app, BrowserWindow, ipcMain, nativeImage } = require('electron'); // <--- IMPORTAMOS nativeImage
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

let mainWindow;

function createWindow() {
  // 1. PREPARAMOS EL ICONO EN MEMORIA
  // Esto es crucial para Linux. Cargamos la imagen antes de abrir la ventana.
  const iconPath = path.join(__dirname, 'icon.png'); 
  const appIcon = nativeImage.createFromPath(iconPath);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Isakari Sushi POS",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false 
    },
    // Pasamos el objeto de imagen, no el string
    icon: appIcon 
  });

  mainWindow = win; // Guardamos referencia global
  win.setMenuBarVisibility(false);

  // Conexión con Vite (Desarrollo vs Producción)
  if (app.isPackaged) {
      win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
      const conectarConVite = () => {
          win.loadURL('http://localhost:5173')
            .then(() => console.log("✅ Conectado a Vite."))
            .catch(() => { setTimeout(conectarConVite, 1000); });
      };
      conectarConVite();
  }
  
  // --- IMPRESIÓN RAW (ESC/POS) ---
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

    const fmt = (num) => '$' + parseInt(num).toLocaleString('es-CL');
    const limpiarTexto = (str) => {
        if(!str) return "";
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    };

    let ticket = INIT;
    ticket += OPEN_DRAWER; // Abrir cajón

    // Encabezado
    ticket += ALIGN_CENTER + BOLD_ON + "ISAKARI SUSHI\n" + BOLD_OFF;
    ticket += "Calle Comercio #1757\n+56 9 813 51797\n\n";
    ticket += BOLD_ON + `PEDIDO #${data.numeroPedido}\n` + BOLD_OFF;
    ticket += `Cliente: ${limpiarTexto(data.cliente || 'Mesa')}\n`;
    ticket += `Fecha: ${data.fecha}\n--------------------------------\n`;
    
    // Detalle
    ticket += ALIGN_LEFT;
    data.orden.forEach(item => {
        ticket += `${item.cantidad} x ${limpiarTexto(item.nombre)}\n`;
        if (item.opciones && item.opciones.length > 0) {
            item.opciones.forEach(op => ticket += `   + ${limpiarTexto(op)}\n`);
        }
        if (item.observacion && item.observacion.trim() !== "") {
            ticket += `   (Nota: ${limpiarTexto(item.observacion)})\n`;
        }
        ticket += ALIGN_RIGHT + `${fmt(item.precio * item.cantidad)}\n` + ALIGN_LEFT;
    });

    ticket += "--------------------------------\n";

    // Totales
    const totalFinal = parseInt(data.total) || 0;
    const costoEnvio = parseInt(data.costoDespacho) || 0;
    const descuento = parseInt(data.descuento) || 0;
    
    // Cálculo inverso para mostrar subtotal real
    const subTotalProductos = totalFinal - costoEnvio + descuento;

    ticket += ALIGN_RIGHT;

    if (descuento > 0) {
        ticket += `Subtotal: ${fmt(subTotalProductos)}\n`;
        ticket += `Descuento (10%): -${fmt(descuento)}\n`;
    }

    if (costoEnvio > 0) {
        ticket += `Envio: ${fmt(costoEnvio)}\n`;
    }

    ticket += ALIGN_CENTER + "\n" + BOLD_ON + `TOTAL: ${fmt(totalFinal)}\n` + BOLD_OFF;
    
    // Datos Reparto
    if(data.tipoEntrega === 'REPARTO') {
        ticket += "\n" + ALIGN_LEFT + BOLD_ON + "DATOS REPARTO:\n" + BOLD_OFF;
        ticket += `Dir: ${limpiarTexto(data.direccion || 'Sin direccion')}\n`;
        ticket += `Tel: ${data.telefono || ''}\n`;
    } else {
        ticket += "\n" + ALIGN_CENTER + "*** RETIRO EN LOCAL ***\n";
    }
    
    if (data.descripcion && data.descripcion.trim() !== "") {
        ticket += ALIGN_LEFT + "\n" + BOLD_ON + "NOTA PEDIDO:\n" + BOLD_OFF;
        ticket += limpiarTexto(data.descripcion) + "\n";
    }
    
    ticket += ALIGN_CENTER + "\nGracias por su preferencia!\n\n\n" + CUT;

    // Guardar temporal
    const tempPath = path.join(os.tmpdir(), 'ticket_sushi.bin');
    fs.writeFileSync(tempPath, ticket, { encoding: 'binary' });

    if (process.platform === 'win32') {
        console.log("⚠️ WINDOWS: Impresión simulada.");
        return; 
    }

    // Ejecutar impresión en Linux
    exec(`lp -d impresora_termica -o raw "${tempPath}"`, (error, stdout) => {
        if (error) console.error(`❌ Error impresión: ${error.message}`);
        else console.log(`✅ Ticket enviado a impresora.`);
    });
  });
}

// Configuración extra para Linux (Crea el ID de aplicación para que el dock lo reconozca)
app.setAppUserModelId("com.isakari.pos"); 

app.whenReady().then(createWindow);