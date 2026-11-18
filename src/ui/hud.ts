import { Point2D } from '../types/cad';

export interface HudField {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  step?: number;
}

export class DynamicHud {
  private container: HTMLDivElement;
  private input1: HTMLInputElement;
  private input2: HTMLInputElement;
  private label1: HTMLSpanElement;
  private label2: HTMLSpanElement;
  private field2Container: HTMLDivElement;
  private commitCallback: ((val1: number, val2?: number) => void) | null = null;
  private cancelCallback: (() => void) | null = null;
  private active: boolean = false;
  private hasTwoFields: boolean = false;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'cad-dynamic-hud';
    this.container.style.display = 'none';

    // Field 1
    const field1Container = document.createElement('div');
    field1Container.className = 'hud-field';
    this.label1 = document.createElement('span');
    this.label1.className = 'hud-label';
    this.input1 = document.createElement('input');
    this.input1.type = 'number';
    this.input1.className = 'hud-input';
    field1Container.appendChild(this.label1);
    field1Container.appendChild(this.input1);

    // Field 2
    this.field2Container = document.createElement('div');
    this.field2Container.className = 'hud-field';
    this.label2 = document.createElement('span');
    this.label2.className = 'hud-label';
    this.input2 = document.createElement('input');
    this.input2.type = 'number';
    this.input2.className = 'hud-input';
    this.field2Container.appendChild(this.label2);
    this.field2Container.appendChild(this.input2);

    this.container.appendChild(field1Container);
    this.container.appendChild(this.field2Container);
    parent.appendChild(this.container);

    this.setupListeners();
  }

  private setupListeners() {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.commit();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (this.hasTwoFields) {
          if (document.activeElement === this.input1) {
            this.input2.focus();
            this.input2.select();
          } else {
            this.input1.focus();
            this.input1.select();
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        if (this.cancelCallback) this.cancelCallback();
      }
    };

    this.input1.addEventListener('keydown', handleKey);
    this.input2.addEventListener('keydown', handleKey);
  }

  showSingleField(
    screenPos: Point2D,
    label: string,
    initialVal: number,
    onCommit: (val: number) => void,
    onCancel?: () => void
  ) {
    this.active = true;
    this.hasTwoFields = false;
    this.label1.textContent = label;
    this.input1.value = initialVal ? initialVal.toFixed(2) : '0';
    this.field2Container.style.display = 'none';
    this.commitCallback = (v1) => onCommit(v1);
    this.cancelCallback = onCancel || null;
    this.updatePosition(screenPos);
    this.container.style.display = 'flex';
  }

  showDoubleFields(
    screenPos: Point2D,
    label1: string,
    val1: number,
    label2: string,
    val2: number,
    onCommit: (v1: number, v2: number) => void,
    onCancel?: () => void
  ) {
    this.active = true;
    this.hasTwoFields = true;
    this.label1.textContent = label1;
    this.input1.value = val1.toFixed(2);
    this.label2.textContent = label2;
    this.input2.value = val2.toFixed(2);
    this.field2Container.style.display = 'flex';
    this.commitCallback = (v1, v2) => onCommit(v1, v2 ?? 0);
    this.cancelCallback = onCancel || null;
    this.updatePosition(screenPos);
    this.container.style.display = 'flex';
  }

  updateLiveValues(val1: number, val2?: number) {
    if (!this.active) return;
    // Only update if input is not manually focused by user typing
    if (document.activeElement !== this.input1) {
      this.input1.value = val1.toFixed(2);
    }
    if (this.hasTwoFields && val2 !== undefined && document.activeElement !== this.input2) {
      this.input2.value = val2.toFixed(2);
    }
  }

  updatePosition(screenPos: Point2D) {
    if (!this.active) return;
    const offsetX = 25;
    const offsetY = 25;
    this.container.style.left = `${screenPos.x + offsetX}px`;
    this.container.style.top = `${screenPos.y + offsetY}px`;
  }

  focus() {
    this.input1.focus();
    this.input1.select();
  }

  commit() {
    if (!this.active || !this.commitCallback) return;
    const v1 = parseFloat(this.input1.value);
    const v2 = this.hasTwoFields ? parseFloat(this.input2.value) : undefined;
    if (!isNaN(v1)) {
      const cb = this.commitCallback;
      this.hide();
      cb(v1, v2);
    }
  }

  hide() {
    this.active = false;
    this.commitCallback = null;
    this.container.style.display = 'none';
    this.input1.blur();
    this.input2.blur();
  }

  isActive(): boolean {
    return this.active;
  }
}

