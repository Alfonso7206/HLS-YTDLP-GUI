const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // opzionale
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

const videosFolder = path.join(process.env.USERPROFILE, 'Videos');
if (!fs.existsSync(videosFolder)) fs.mkdirSync(videosFolder, { recursive: true });

ipcMain.handle('show-context-menu', (event) => {
  const template = [
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { type: 'separator' },
    { role: 'selectAll' }
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = ''; res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractLinks(text) {
  const regex = /(https?:\/\/[^\s"'<>]+?\.(m3u8|mp4|mov|mkv|webm|avi|ts|flv|m4v)(\?[^\s"'<>]*)?)/gi;
  const matches = []; let m;
  while ((m = regex.exec(text)) !== null) matches.push(m[1]);
  return Array.from(new Set(matches));
}

ipcMain.handle('extract:fromUrl', async (event, url) => {
  try {
    const content = await fetchPage(url);
    const links = extractLinks(content);
    return { ok: true, links };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

function getBinaryPath(binary) {
  if (binary.toLowerCase() === 'yt-dlp') binary = 'yt-dlp.exe';
  if (binary.toLowerCase() === 'ffmpeg') binary = 'ffmpeg.exe';
  if (binary.toLowerCase() === 'ffprobe') binary = 'ffprobe.exe';

  let binPath;

  if (app.isPackaged) {
    binPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', binary);
  } else {
    binPath = path.join(__dirname, 'bin', binary);
  }

  if (!fs.existsSync(binPath)) {
    if (mainWindow) mainWindow.webContents.send('download:log', `[!] Binario non trovato: ${binPath}\n`);
    console.error(`[!] Binario non trovato: ${binPath}`);
    return null;
  }

  return binPath;
}
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

ipcMain.handle('getThumbnailHTML', async (event, url) => {
  try {
    const html = await fetchPage(url);
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Titolo non disponibile';
    const thumbMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    const thumbnail = thumbMatch ? thumbMatch[1] : null;
    return { ok: true, title, thumbnail };
  } catch (err) {
    return { ok: false, title: 'Errore', thumbnail: null };
  }
});

ipcMain.handle('download:links', async (event, { links, binary = 'yt-dlp', format = 'video', playlist = false }) => {
  for (const link of links) {
    await new Promise(resolve => {
      const binaryPath = getBinaryPath(binary);
      if (!binaryPath) return resolve();

      let args = [];
      if (binary.toLowerCase() === 'yt-dlp') {
        const playlistArg = playlist ? '--yes-playlist' : '--no-playlist';

        args = format === 'audio-mp3'
          ? ['-x', '--audio-format', 'mp3', '--audio-quality', '192K',
             '-o', path.join(videosFolder, '%(title)s.%(ext)s'),
             '--newline', playlistArg, link]
          : ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
             '-o', path.join(videosFolder, '%(title)s.%(ext)s'),
             '-S', 'res,vcodec:h264,hdr,vbr',
             '--newline', playlistArg, link];
      } else if (binary.toLowerCase() === 'ffmpeg') {
        args = ['-y', '-i', link, '-c', 'copy',
                path.join(videosFolder, `video_${Date.now()}.mp4`)];
      }

      const child = spawn(binaryPath, args, { shell: false });

      mainWindow.webContents.send('download:log', `[▶] Avvio download con ${binary}: ${link}\n`);

      child.stdout.on('data', data => {
        const text = data.toString();
        mainWindow.webContents.send('download:log', text);

        const regex = /\[download\]\s+(\d{1,3}\.\d)%/;
        const match = text.match(regex);
        if (match) {
          const percent = parseFloat(match[1]);
          mainWindow.webContents.send('download:progress', {
            link,
            percent,
            size: '',
            speed: '',
            eta: '',
            done: false
          });
        }
      });

      child.stderr.on('data', data =>
        mainWindow.webContents.send('download:log', data.toString())
      );

      child.on('close', code => {
        mainWindow.webContents.send('download:log',
          `[✔] Completato (${binary}) codice ${code}: ${link}\n`);
        mainWindow.webContents.send('download:progress', {
          link,
          percent: 100,
          size: '',
          speed: '',
          eta: '',
          done: true
        });
        resolve();
      });

      child.on('error', err => {
        mainWindow.webContents.send('download:log',
          `[ERRORE] ${binary}: ${err.message}\n`);
        resolve();
      });
    });
  }

  mainWindow.webContents.send('download:log', '\nTutti i download terminati.\n');
  return { ok: true };
});