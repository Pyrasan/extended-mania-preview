const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('open-folder-dialog', async () => {
  const songsPath = path.join(process.env.APPDATA || process.env.HOME, 'osu!', 'Songs');
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: fs.existsSync(songsPath) ? songsPath : undefined
  });

  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('read-beatmaps', async (event, folderPath) => {
  try {
    console.log('Reading folder:', folderPath);
    
    const beatmapSet = {
      folderName: path.basename(folderPath),
      artist: '',
      title: '',
      difficulties: []
    };

    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.osu'));
    console.log('Found files:', files.length);
    
    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const diff = parseOsuFile(content, path.basename(file, '.osu'));
      console.log('Parsed:', file, 'isMania:', diff ? diff.isMania : 'null');
      if (diff) {
        beatmapSet.difficulties.push(diff);
      }
    }

    console.log('Total difficulties:', beatmapSet.difficulties.length);

    if (beatmapSet.difficulties.length > 0) {
      beatmapSet.artist = beatmapSet.difficulties[0].artist;
      beatmapSet.title = beatmapSet.difficulties[0].title;
      beatmapSet.bpm = beatmapSet.difficulties[0].bpm;
    }

    beatmapSet.difficulties.sort((a, b) => a.starRating - b.starRating);

    return beatmapSet;
  } catch (err) {
    console.error('Error reading beatmaps:', err);
    return null;
  }
});

function parseOsuFile(content, fileName) {
  const lines = content.split('\n');
  const diff = {
    fileName: fileName,
    artist: '',
    title: '',
    version: '',
    mode: -1,
    isMania: false,
    circles: [],
    sliders: [],
    spinner: [],
    bpm: 120,
    ar: 9,
    cs: 4,
    od: 8,
    hp: 8,
    sliderVelocity: 1,
    timingPoints: [],
    starRating: 0
  };

  let section = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1);
      continue;
    }

    if (section === 'General') {
      if (line.startsWith('Mode:')) {
        diff.mode = parseInt(line.split(':')[1].trim());
      }
    } else if (section === 'Metadata') {
      if (line.startsWith('Artist:')) diff.artist = line.split(':').slice(1).join(':').trim();
      if (line.startsWith('Title:')) diff.title = line.split(':').slice(1).join(':').trim();
      if (line.startsWith('Version:')) diff.version = line.split(':').slice(1).join(':').trim();
    } else if (section === 'Difficulty') {
      if (line.startsWith('CircleSize:')) diff.cs = parseFloat(line.split(':')[1]);
      if (line.startsWith('ApproachRate:')) diff.ar = parseFloat(line.split(':')[1]);
      if (line.startsWith('OverallDifficulty:')) diff.od = parseFloat(line.split(':')[1]);
      if (line.startsWith('HPDrainRate:')) diff.hp = parseFloat(line.split(':')[1]);
      if (line.startsWith('SliderMultiplier:')) diff.sliderVelocity = parseFloat(line.split(':')[1]);
      if (line.startsWith('OverallDifficulty:')) {
        diff.starRating = parseFloat(line.split(':')[1]);
      }
    } else if (section === 'TimingPoints') {
      const parts = line.split(',');
      if (parts.length >= 2) {
        const msPerBeat = parseFloat(parts[1]);
        if (msPerBeat > 0) {
          const bpm = 60000 / msPerBeat;
          if (!diff.timingPoints.some(tp => Math.abs(tp.time - parseFloat(parts[0])) < 1)) {
            diff.timingPoints.push({
              time: parseFloat(parts[0]),
              msPerBeat: msPerBeat,
              bpm: bpm
            });
            if (diff.timingPoints.length === 1 || parseFloat(parts[0]) === 0) {
              diff.bpm = bpm;
            }
          }
        }
      }
    } else if (section === 'HitObjects') {
      const parts = line.split(',');
      if (parts.length >= 5) {
        const x = parseInt(parts[0]);
        const y = parseInt(parts[1]);
        const time = parseInt(parts[2]);
        const type = parseInt(parts[3]);

        if (type & 1) {
          diff.circles.push({ x, y, time, type: 'circle' });
        } else if (type & 2) {
          let endTime = time + 200;
          if (parts.length >= 7) {
            const sliderVelocity = diff.sliderVelocity || 1;
            const pixelLength = parseFloat(parts[6]) || 100;
            const slides = parseInt(parts[5]) || 1;
            const msPerPixel = 100 / sliderVelocity;
            endTime = time + pixelLength * msPerPixel * slides;
          }
          diff.sliders.push({ x, y, time, endTime, type: 'slider' });
        } else if (type & 128) {
          let endTime = time + 500;
          if (parts.length >= 6 && parts[5]) {
            const endParts = parts[5].split(':');
            endTime = parseInt(endParts[0]) || (time + 500);
          }
          diff.sliders.push({ x, y, time, endTime, type: 'hold' });
        } else if (type & 8) {
          diff.spinner.push({ x, y, time, type: 'spinner' });
        }
      }
    }
  }

  if (!diff.version) diff.version = fileName;
  diff.totalNotes = diff.circles.length + diff.sliders.length + diff.spinner.length;
  
  diff.isMania = diff.mode === 3 || (diff.mode === -1 && diff.cs >= 3);
  if (!diff.isMania) return null;

  return diff;
}