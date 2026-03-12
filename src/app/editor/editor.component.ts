import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface CanvasElement {
  id: string;
  field: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  fontSize: number;
  color: string;
  fontWeight: string;
  textAlign: string;
  // QR Code styling
  qrFgColor?: string;       // dot/foreground color
  qrBgColor?: string;       // background color
  qrDotStyle?: 'square' | 'rounded' | 'dots';      // dot shape
  qrCornerStyle?: 'square' | 'rounded';             // corner frames shape
}

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss'
})
export class EditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('wrapper') wrapper!: ElementRef<HTMLDivElement>;

  availableFields = ['Place', 'Bibcode', 'Distance', 'FullName', 'Age', 'Category', 'Group'];
  qrField = '__QRCode__';

  /** 21×21 QR-like module matrix (placeholder — not scannable) */
  readonly qrMatrix: boolean[][] = (() => {
    const N = 21;
    const reserved = (r: number, c: number) =>
      (r <= 7 && c <= 7) || (r <= 7 && c >= 13) || (r >= 13 && c <= 7) ||
      r === 6 || c === 6;
    const m: boolean[][] = Array.from({length: N}, () => Array(N).fill(false));
    // Timing patterns (alternating, row 6 & col 6, positions 8-12)
    for (let i = 8; i <= 12; i++) {
      if (i % 2 === 0) { m[6][i] = true; m[i][6] = true; }
    }
    m[8][13] = true; // dark alignment module
    // Pseudo-random data fill in non-reserved cells
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (reserved(r, c) || m[r][c]) continue;
        m[r][c] = (r * 7 + c * 11 + r * c) % 5 > 1;
      }
    }
    return m;
  })();

  /** Returns true for the 3 finder-pattern zones (including separator) */
  isFinderArea(r: number, c: number): boolean {
    return (r <= 7 && c <= 7) || (r <= 7 && c >= 13) || (r >= 13 && c <= 7);
  }


  layout: 'portrait' | 'landscape' = 'landscape';
  backgroundImage: string | null = null;
  canvasScale: number = 0.6;
  
  elements: CanvasElement[] = [];
  focusedElement: CanvasElement | null = null; // selected element — opens right panel on single click
  draggedField: string | null = null;

  draggingElementId: string | null = null;
  elementDragOffsetX = 0;
  elementDragOffsetY = 0;

  // Resize state
  resizingElement: CanvasElement | null = null;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private resizeMoveListener = (e: MouseEvent) => this.onResizeMove(e);
  private resizeEndListener = () => this.onResizeEnd();

  private isBrowser: boolean;
  private resizeListener = () => this.calculateScale();

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngAfterViewInit() {
    if (!this.isBrowser) return;
    setTimeout(() => this.calculateScale());
    window.addEventListener('resize', this.resizeListener);
  }
  
  ngOnDestroy() {
    if (!this.isBrowser) return;
    window.removeEventListener('resize', this.resizeListener);
    window.removeEventListener('mousemove', this.resizeMoveListener);
    window.removeEventListener('mouseup', this.resizeEndListener);
  }

  calculateScale() {
    if (!this.wrapper) return;
    const wrapperRect = this.wrapper.nativeElement.getBoundingClientRect();
    const padding = 64; // Margin around the canvas within the workspace
    const availableWidth = wrapperRect.width - padding;
    const availableHeight = wrapperRect.height - padding;

    // Use current physical dimensions of standard A4 based on layout
    const docWidth = this.layout === 'landscape' ? 1123 : 794;
    const docHeight = this.layout === 'landscape' ? 794 : 1123;

    const scaleX = availableWidth / docWidth;
    const scaleY = availableHeight / docHeight;
    // Scale uniformly to fit within both dimensions
    this.canvasScale = Math.min(scaleX, scaleY);
  }

  setLayout(layout: 'portrait' | 'landscape') {
    this.layout = layout;
    setTimeout(() => this.calculateScale());
  }

  onBackgroundUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.backgroundImage = e.target?.result as string;
      };
      reader.readAsDataURL(input.files[0]);
    }
  }

  onDragStartNew(event: DragEvent, field: string) {
    this.draggedField = field;
    this.draggingElementId = null;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', field);
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  onDragStartExisting(event: DragEvent, el: CanvasElement) {
    this.draggingElementId = el.id;
    this.draggedField = null;
    
    // Attempt to compute offset within the element being dragged
    const target = event.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    
    this.elementDragOffsetX = event.clientX - rect.left;
    this.elementDragOffsetY = event.clientY - rect.top;

    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', el.id);
      event.dataTransfer.effectAllowed = 'move';
    }
    
    // Prevents potential drag conflicts
    event.stopPropagation();
  }

  allowDrop(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = this.draggingElementId ? 'move' : 'copy';
    }
  }

  onDrop(event: DragEvent) {
    event.preventDefault();

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    
    // A simple way to compute the CSS transform scale applied to the canvas div
    // We compare standard expected width to bounding client rect width
    const expectedWidth = this.layout === 'landscape' ? 1123 : 794;
    const scale = rect.width / expectedWidth; 

    if (this.draggingElementId) {
      const el = this.elements.find(e => e.id === this.draggingElementId);
      if (el) {
        // Calculate new position converting to the unscaled canvas coordinates
        const dropX = (event.clientX - rect.left - this.elementDragOffsetX) / scale;
        const dropY = (event.clientY - rect.top - this.elementDragOffsetY) / scale;

        el.x = dropX;
        el.y = dropY;
      }
      this.draggingElementId = null;
      return;
    }

    if (this.draggedField) {
      const dropX = (event.clientX - rect.left) / scale;
      const dropY = (event.clientY - rect.top) / scale;

      const newElement: CanvasElement = {
        id: Math.random().toString(36).substring(2, 9),
        field: this.draggedField,
        x: dropX,
        y: dropY,
        width: this.draggedField === '__QRCode__' ? 120 : 150,
        height: this.draggedField === '__QRCode__' ? 120 : undefined,
        fontSize: 24,
        color: '#000000',
        fontWeight: 'normal',
        textAlign: 'left',
        // QR defaults
        qrFgColor: this.draggedField === '__QRCode__' ? '#000000' : undefined,
        qrBgColor: this.draggedField === '__QRCode__' ? '#ffffff' : undefined,
        qrDotStyle: this.draggedField === '__QRCode__' ? 'square' : undefined,
        qrCornerStyle: this.draggedField === '__QRCode__' ? 'square' : undefined,
      };

      this.elements.push(newElement);
      // Highlight the new element and open properties panel right away
      this.focusedElement = newElement;
      this.draggedField = null;
    }
  }

  onCanvasElementClick(event: MouseEvent, el: CanvasElement) {
    event.stopPropagation(); // prevent canvas click from firing and clearing focusedElement
    this.focusedElement = el;
  }

  onCanvasElementDoubleClick(event: MouseEvent, el: CanvasElement) {
    event.stopPropagation();
    this.focusedElement = el;
  }

  onCanvasClick() {
    // Click on empty canvas area: close the right panel
    this.focusedElement = null;
  }

  deselectElement() {
    this.focusedElement = null;
  }

  deleteElement(el: CanvasElement) {
    this.elements = this.elements.filter(e => e.id !== el.id);
    this.focusedElement = null;
  }

  setQrDotStyle(el: CanvasElement, style: 'square' | 'rounded' | 'dots') {
    el.qrDotStyle = style;
  }

  setQrCornerStyle(el: CanvasElement, style: 'square' | 'rounded') {
    el.qrCornerStyle = style;
  }



  onResizeStart(event: MouseEvent, el: CanvasElement) {
    event.preventDefault();
    event.stopPropagation();
    this.resizingElement = el;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = el.width;
    window.addEventListener('mousemove', this.resizeMoveListener);
    window.addEventListener('mouseup', this.resizeEndListener);
  }

  private onResizeMove(event: MouseEvent) {
    if (!this.resizingElement) return;
    const dx = (event.clientX - this.resizeStartX) / this.canvasScale;
    const newWidth = Math.max(40, this.resizeStartWidth + dx);
    this.resizingElement.width = Math.round(newWidth);
  }

  private onResizeEnd() {
    this.resizingElement = null;
    window.removeEventListener('mousemove', this.resizeMoveListener);
    window.removeEventListener('mouseup', this.resizeEndListener);
  }

  downloadJson() {
    const data = {
      layout: this.layout,
      backgroundImage: this.backgroundImage,
      elements: this.elements
    };
    
    // Create a Blob from the JSON data
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    
    // Create a temporary anchor to trigger the download
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'certificate-template.json';
    document.body.appendChild(anchor);
    anchor.click();
    
    // Cleanup
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  }
}
