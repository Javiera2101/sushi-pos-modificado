const fs = require('fs');
const path = require('path');

function fixProject() {
  const currentDir = process.cwd();
  console.log(`📂 Ejecutando en: ${currentDir}`);
  console.log("--- 🛠️ REPARANDO ESTRUCTURA SUSHI POS ---");

  // Verificar si estamos en la carpeta correcta
  if (!fs.existsSync(path.join(currentDir, 'package.json'))) {
    console.error("❌ ERROR: No encuentro 'package.json'.");
    console.error("   Asegúrate de guardar y ejecutar este script en la carpeta RAÍZ.");
    console.error("   (La misma carpeta que tiene node_modules, package.json e index.html)");
    return;
  }

  const srcDir = path.join(currentDir, 'src');
  const pathSrcJsx = path.join(srcDir, 'main.jsx'); // El archivo React correcto
  const pathSrcJs = path.join(srcDir, 'main.js');   // El archivo conflictivo
  const pathRootJs = path.join(currentDir, 'main.js'); // El archivo Electron
  const pathIndexHtml = path.join(currentDir, 'index.html');

  // 1. VALIDAR MAIN.JSX (React)
  if (fs.existsSync(pathSrcJsx)) {
    console.log("✅ src/main.jsx existe. (Correcto para React)");
  } else {
    console.log("⚠️ No encuentro src/main.jsx. Buscando alternativas...");
    // Si no existe, ver si src/main.js es en realidad React
    if (fs.existsSync(pathSrcJs)) {
      const content = fs.readFileSync(pathSrcJs, 'utf8');
      if (content.toLowerCase().includes('react') || content.includes('createRoot')) {
        console.log("   -> src/main.js parece ser React. Renombrándolo a .jsx...");
        try {
          fs.renameSync(pathSrcJs, pathSrcJsx);
          console.log("   -> ✅ Arreglado: src/main.js -> src/main.jsx");
        } catch (e) {
          console.error(`   -> ❌ Error al renombrar: ${e.message}`);
        }
      }
    }
  }

  // 2. LIMPIAR EL INTRUSO (src/main.js)
  // Si existen ambos, src/main.js sobra o está mal ubicado
  if (fs.existsSync(pathSrcJs) && fs.existsSync(pathSrcJsx)) {
    console.log("🚨 CONFLICTO DETECTADO: Tienes main.js y main.jsx en 'src'.");
    try {
      const content = fs.readFileSync(pathSrcJs, 'utf8');
      
      // Detectar si es código de Electron perdido en src
      if (content.toLowerCase().includes('electron') || content.includes('app.on')) {
        console.log("   -> src/main.js contiene código de Electron (Error de ubicación).");
        if (!fs.existsSync(pathRootJs)) {
          fs.renameSync(pathSrcJs, pathRootJs);
          console.log("   -> 📦 MOVIDO: src/main.js -> ./main.js (A la raíz)");
        } else {
          console.log("   -> ⚠️ Ya tienes un main.js en la raíz. Borrando el duplicado en src...");
          fs.unlinkSync(pathSrcJs);
          console.log("   -> 🗑️ ELIMINADO: src/main.js duplicado.");
        }
      } else {
        // Si no es Electron, es un duplicado viejo de React
        fs.unlinkSync(pathSrcJs);
        console.log("   -> 🗑️ ELIMINADO: src/main.js (Era un duplicado innecesario de React)");
      }
    } catch (e) {
      console.error(`   -> Error procesando archivo: ${e.message}`);
    }
  }

  // 3. ARREGLAR INDEX.HTML
  if (fs.existsSync(pathIndexHtml)) {
    console.log("🔧 Ajustando index.html...");
    try {
      let html = fs.readFileSync(pathIndexHtml, 'utf8');
      let newHtml = html;
      
      // Reemplazar referencias viejas a .js por .jsx
      // Busca src="/src/main.js" o src="./src/main.js"
      newHtml = newHtml.replace(/src="\/src\/main\.js"/g, 'src="/src/main.jsx"');
      newHtml = newHtml.replace(/src="\.\/src\/main\.js"/g, 'src="/src/main.jsx"');
      newHtml = newHtml.replace(/src="src\/main\.js"/g, 'src="/src/main.jsx"');

      if (html !== newHtml) {
        fs.writeFileSync(pathIndexHtml, newHtml, 'utf8');
        console.log("   -> ✅ index.html actualizado: Ahora apunta a src/main.jsx");
      } else {
        console.log("   -> index.html ya estaba correcto.");
      }
    } catch (e) {
      console.error(`   -> Error leyendo index.html: ${e.message}`);
    }
  }

  console.log("\n--- ✅ REPARACIÓN COMPLETADA ---");
  console.log("Pasos siguientes:");
  console.log("1. Borra este archivo (arreglar_proyecto.js) si quieres.");
  console.log("2. Ejecuta: npm run dev");
}

fixProject();