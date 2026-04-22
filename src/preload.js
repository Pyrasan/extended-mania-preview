const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder: () => ipcRenderer.invoke('open-folder-dialog'),
  readBeatmaps: (folderPath) => ipcRenderer.invoke('read-beatmaps', folderPath)
});