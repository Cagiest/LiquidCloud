const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
    on: (channel, fn) => {
        if (['settings', 'state', 'hover', 'audio'].includes(channel)) ipcRenderer.on(channel, (_, value) => fn(value));
    },
    resizeStart: () => ipcRenderer.send('resize-start'),
    resizeEnd: () => ipcRenderer.send('resize-end')
});
