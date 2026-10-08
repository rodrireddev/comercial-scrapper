import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { MapsSessionStatus, RendererApi, ScanProgress } from '../shared/types';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: RendererApi = {
  startScan: (req) => ipcRenderer.invoke('scan:start', req),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  isScanning: () => ipcRenderer.invoke('scan:running'),
  onScanProgress: (cb) => subscribe<ScanProgress>('scan:progress', cb),
  onDataChanged: (cb) => subscribe<void>('data:changed', cb),
  listBusinesses: () => ipcRenderer.invoke('businesses:list'),
  updateBusiness: (id, patch) => ipcRenderer.invoke('business:update', id, patch),
  deleteBusiness: (id) => ipcRenderer.invoke('business:delete', id),
  listScans: () => ipcRenderer.invoke('scans:list'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  exportCsv: (ids) => ipcRenderer.invoke('export:csv', ids),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  openMapsLogin: () => ipcRenderer.invoke('maps:login'),
  logoutMaps: () => ipcRenderer.invoke('maps:logout'),
  getMapsSession: () => ipcRenderer.invoke('maps:session'),
  onMapsSessionChanged: (cb) => subscribe<MapsSessionStatus>('maps:session', cb),
  geocode: (query) => ipcRenderer.invoke('geo:search', query),
};

contextBridge.exposeInMainWorld('api', api);
