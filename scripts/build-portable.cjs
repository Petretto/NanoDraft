const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const assetsDir = path.join(distDir, 'assets');
const publicDir = path.join(rootDir, 'public');
const releaseDir = path.join(rootDir, 'release');

function buildPortable() {
  if (!fs.existsSync(assetsDir)) {
    console.error('dist/assets not found. Run vite build first.');
    process.exit(1);
  }

  const assetFiles = fs.readdirSync(assetsDir);
  const cssFile = assetFiles.find(f => f.startsWith('index-') && f.endsWith('.css'));
  const jsFile = assetFiles.find(f => f.startsWith('index-') && f.endsWith('.js'));

  if (!cssFile || !jsFile) {
    console.error('Could not locate main CSS or JS bundle in dist/assets.');
    process.exit(1);
  }

  const cssContent = fs.readFileSync(path.join(assetsDir, cssFile), 'utf8');
  let jsContent = fs.readFileSync(path.join(assetsDir, jsFile), 'utf8');
  // Escape any literal </script> inside JS string literals so inline <script> never closes prematurely
  jsContent = jsContent.replace(/<\/script>/gi, '<\\/script>');

  const portableHtml = `<!DOCTYPE html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NanoDraft 2D v2.0 — Studio CAD (Offline Portable)</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
${cssContent}
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
${jsContent}
    </script>
  </body>
</html>
`;

  // 1. Write to dist/NanoDraft_Portable.html (served on Vercel at /NanoDraft_Portable.html)
  const distPortablePath = path.join(distDir, 'NanoDraft_Portable.html');
  fs.writeFileSync(distPortablePath, portableHtml, 'utf8');

  // 2. Write to public/NanoDraft_Portable.html (served in local dev server)
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'NanoDraft_Portable.html'), portableHtml, 'utf8');

  // 3. Write to release/ directory with README and sample Projects
  fs.mkdirSync(releaseDir, { recursive: true });
  const releasePortablePath = path.join(releaseDir, 'NanoDraft_Portable.html');
  fs.writeFileSync(releasePortablePath, portableHtml, 'utf8');

  const readmeTxt = `================================================================
  NanoDraft 2D (v2.0 Studio UI) — Paczka Przenośna (Offline Portable)
================================================================

JAK URUCHOMIĆ APLIKACJĘ:
1. Kliknij dwukrotnie plik "NanoDraft_Portable.html".
2. Program otworzy się natychmiast w Twojej przeglądarce (Chrome, Edge, Brave, Firefox).
3. Nie wymaga instalacji, serwera ani połączenia z internetem!
4. Wszystkie narzędzia, przykładowe projekty (przycisk "Projekty"),
   auto-zapis, eksport DXF/CSV oraz wydruk PDF działają w 100% lokalnie.

ZAWARTOŚĆ PACZKI:
- NanoDraft_Portable.html  -> Kompletna aplikacja NanoDraft 2D w jednym pliku
- Projects/                -> Przykładowe projekty (.nanodraft, .dxf, .pdf)
`;
  fs.writeFileSync(path.join(releaseDir, 'INSTRUKCJA_URUCHOMIENIA.txt'), readmeTxt, 'utf8');

  const sizeKb = (Buffer.byteLength(portableHtml, 'utf8') / 1024).toFixed(1);
  console.log(`✓ Generated standalone offline app: NanoDraft_Portable.html (${sizeKb} kB)`);

  // On Windows, also create release/NanoDraft_2D_Portable.zip if Compress-Archive is available
  if (process.platform === 'win32') {
    try {
      const zipPath = path.join(releaseDir, 'NanoDraft_2D_Portable.zip');
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      const projDir = path.join(rootDir, 'Projects');
      const psCmd = `Compress-Archive -Path "${releasePortablePath}", "${path.join(releaseDir, 'INSTRUKCJA_URUCHOMIENIA.txt')}", "${projDir}" -DestinationPath "${zipPath}" -Force`;
      execSync(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
      if (fs.existsSync(zipPath)) {
        const zipKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
        console.log(`✓ Generated downloadable ZIP archive: release/NanoDraft_2D_Portable.zip (${zipKb} kB)`);
      }
    } catch {
      // Non-fatal if zip creation is skipped in CI/Linux
    }
  }
}

buildPortable();
