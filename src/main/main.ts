import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BusinessPatch, ScanRequest, Settings } from '../shared/types';
import { toCsv } from './csv';
import { Scanner } from './scanner';
import { geocode } from './geocode';
import { getMapsSessionStatus, logoutMaps, openMapsLoginWindow } from './scraper/maps-browser';
import { Store } from './store';

let mainWindow: BrowserWindow | undefined;
let store: Store;
let scanner: Scanner;

function send(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Comercial Scrapper',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  void mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function registerIpc(): void {
  ipcMain.handle('scan:start', (_e, req: ScanRequest) => scanner.start(req));
  ipcMain.handle('scan:cancel', () => scanner.cancel());
  ipcMain.handle('scan:running', () => scanner.running);
  ipcMain.handle('businesses:list', () => store.listBusinesses());
  ipcMain.handle('business:update', (_e, id: string, patch: BusinessPatch) => store.updateBusiness(id, patch));
  ipcMain.handle('business:delete', (_e, id: string) => store.deleteBusiness(id));
  ipcMain.handle('scans:list', () => store.listScans());
  ipcMain.handle('settings:get', () => store.settings);
  ipcMain.handle('settings:save', (_e, s: Settings) => {
    const saved = store.saveSettings(s);
    send('data:changed');
    return saved;
  });
  ipcMain.handle('export:csv', async (_e, ids: string[]) => {
    const rows = ids.map((id) => store.getBusiness(id)).filter((b) => !!b);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      title: 'Exportar negocios',
      defaultPath: `negocios-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return undefined;
    await fs.writeFile(filePath, toCsv(rows), 'utf8');
    return filePath;
  });
  const notifySession = () => void getMapsSessionStatus().then((st) => send('maps:session', st));
  ipcMain.handle('maps:login', () => openMapsLoginWindow(notifySession));
  ipcMain.handle('maps:logout', async () => {
    await logoutMaps();
    notifySession();
  });
  ipcMain.handle('maps:session', () => getMapsSessionStatus());
  ipcMain.handle('geo:search', (_e, query: string) => geocode(String(query).slice(0, 200)));
  ipcMain.handle('shell:open', (_e, url: string) => {
    // Solo enlaces web: nunca abrir rutas locales ni otros protocolos desde datos scrapeados.
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
    return undefined;
  });
}

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'data.json'));
  scanner = new Scanner(
    store,
    (p) => send('scan:progress', p),
    () => send('data:changed'),
  );
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  scanner?.cancel();
  void store?.flush().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});
