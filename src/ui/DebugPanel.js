import GUI from 'lil-gui';

// Panel de depuración (F1). Los sistemas registran sus controles con addAction/addToggle
// en lugar de que este archivo los conozca a todos.
export class DebugPanel {
  constructor(uiRoot) {
    this.gui = new GUI({ title: 'Depuración (F1)' });
    this.gui.hide();
    this.visible = false;
    this.folders = new Map();
    this.flags = { godMode: false, showNavGrid: false, showFlowField: false };

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'debug-stats';
    uiRoot.appendChild(this.statsEl);
    this._fpsFrames = 0;
    this._fpsTime = 0;
    this.fps = 0;
  }

  folder(name) {
    if (!this.folders.has(name)) this.folders.set(name, this.gui.addFolder(name));
    return this.folders.get(name);
  }

  addAction(folderName, label, fn) {
    this.folder(folderName).add({ [label]: fn }, label);
  }

  addToggle(folderName, label, obj, key, onChange) {
    const c = this.folder(folderName).add(obj, key).name(label);
    if (onChange) c.onChange(onChange);
    return c;
  }

  toggle() {
    this.visible = !this.visible;
    this.visible ? this.gui.show() : this.gui.hide();
    document.body.classList.toggle('debug-on', this.visible);
  }

  /** Llamado cada frame; actualiza FPS y las líneas que pasen los sistemas. */
  frame(dt, lines) {
    this._fpsFrames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsTime);
      this._fpsFrames = 0;
      this._fpsTime = 0;
    }
    if (!this.visible) return;
    this.statsEl.textContent = [`FPS ${this.fps}`, ...lines].join('\n');
  }
}
