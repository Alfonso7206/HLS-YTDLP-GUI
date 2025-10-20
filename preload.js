const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  downloadLinks: (opts) => ipcRenderer.invoke('download:links', opts),
  extractFromUrl: (url) => ipcRenderer.invoke('extract:fromUrl', url),
  showContextMenu: () => ipcRenderer.invoke('show-context-menu'),
  onDownloadLog: (callback) => ipcRenderer.on('download:log', (e, data) => callback(data)),
  onDownloadProgress: (callback) => ipcRenderer.on('download:progress', (e, data) => callback(data)),
  getThumbnailHTML: (url) => ipcRenderer.invoke('getThumbnailHTML', url),
  updateYtDlp: () => ipcRenderer.invoke('update-yt-dlp')
});
