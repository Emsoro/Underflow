import { useCallback, useState, useRef, useMemo, useEffect, createContext, useContext } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { saveFlowchart, loadFlowchart, saveFileDialog, openFileDialog, saveImageDialog, saveBinaryFile, saveTextFile, isTauri, getLicenseStatus, openExternalUrl } from '../../lib/tauri';
import type { LicenseStatus } from '../../lib/tauri';
import { getCurrentWindow } from '@tauri-apps/api/window';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { toPng, toSvg } from 'html-to-image';
import RegistrationDialog from './RegistrationDialog';
import {
  ReactFlow,
  MiniMap,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Panel,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
} from '@xyflow/react';
import type {
  Node,
  Edge,
  Connection,
  OnSelectionChangeParams,
  ReactFlowInstance,
  NodeProps,
  EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ---------- Types ----------
type NodeData = {
  label: string;
  color?: string;
  borderColor?: string;
  borderStyle?: string;
  description?: string;
  condition?: string;
  yesLabel?: string;
  noLabel?: string;
};

type EdgeMarkerType =
  | 'none'
  | 'open-arrow'
  | 'filled-arrow'
  | 'hollow-triangle'
  | 'hollow-diamond'
  | 'filled-diamond'
  | 'hollow-diamond-arrow'
  | 'filled-diamond-arrow';

type EdgeLineStyle = 'solid' | 'dashed' | 'dotted';

type EdgeData = {
  markerType?: EdgeMarkerType;
  lineStyle?: EdgeLineStyle;
};

// ---------- Custom Condition Node (Diamond) ----------
function ConditionNode({ id, data }: NodeProps<Node<NodeData>>) {
  const { editing, text, inputRef, setEditing, setText, commit, onKeyDown } = useInlineEdit(id, (data as NodeData)?.label);
  const edges = useContext(EdgesContext);
  const handleStyleType = useContext(HandleStyleContext);
  const [hovered, setHovered] = useState(false);
  const hs = (handleId: string | null | undefined, type: 'source' | 'target'): React.CSSProperties => {
    const base = getHandleStyleCSS(handleStyleType);
    if (isHandleConnected(edges, id, handleId, type)) return { ...base, opacity: 1 };
    return hovered ? { ...base, opacity: 1 } : base;
  };
  const hasColor = !!(data as NodeData)?.color;
  const color = (data as NodeData)?.color;
  const hasBorderColor = !!(data as NodeData)?.borderColor;
  const bColor = (data as NodeData)?.borderColor;
  const fillColor = hasColor ? color! : '#fff';
  const strokeColor = hasBorderColor ? bColor! : (hasColor ? color! : '#cbd5e1');
  const textColor = hasColor ? '#fff' : '#333';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: 140, height: 80, position: 'relative' }}
    >
      <svg width="140" height="80" viewBox="0 0 140 80" style={{ position: 'absolute', top: 0, left: 0 }}>
        <polygon
          points="70,2 138,40 70,78 2,40"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={1.5}
          strokeDasharray={(data as NodeData)?.borderStyle === 'dashed' ? '6,3' : undefined}
        />
      </svg>
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)', zIndex: 1,
        color: textColor, fontSize: 12, fontWeight: 600,
        textAlign: 'center', maxWidth: 80, lineHeight: 1.2,
        fontFamily: 'sans-serif',
      }}>
        {editing ? (
          <input ref={inputRef} value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit} onKeyDown={onKeyDown}
            style={{
              width: 70, border: 'none', outline: 'none', background: 'transparent',
              color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', textAlign: 'center',
              fontFamily: 'inherit', padding: 0,
            }}
          />
        ) : (
          <div onDoubleClick={() => setEditing(true)} style={{ cursor: 'text' }}>
            {(data as NodeData)?.label || 'Condition'}
          </div>
        )}
      </div>
      <Handle type="target" position={Position.Top} style={{ ...hs(null, 'target'), top: -4 }} />
      <Handle type="source" position={Position.Bottom} style={{ ...hs(null, 'source'), bottom: -4 }} />
      <Handle type="target" id="left-in" position={Position.Left} style={{ ...hs('left-in', 'target'), left: -4 }} />
      <Handle type="source" id="left-out" position={Position.Left} style={{ ...hs('left-out', 'source'), left: -4 }} />
      <Handle type="target" id="right-in" position={Position.Right} style={{ ...hs('right-in', 'target'), right: -4 }} />
      <Handle type="source" id="right-out" position={Position.Right} style={{ ...hs('right-out', 'source'), right: -4 }} />
    </div>
  );
}

type SelectedElement =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | null;

// ---------- Arrow rendering helpers ----------
function getSourceAngle(position?: Position): number {
  // Direction the edge goes FROM the source handle
  if (position) {
    switch (position) {
      case Position.Top: return -90;    // edge goes up from source top
      case Position.Bottom: return 90;  // edge goes down from source bottom
      case Position.Left: return 180;   // edge goes left from source left
      case Position.Right: return 0;    // edge goes right from source right
    }
  }
  return 0;
}

function getTargetAngle(position?: Position): number {
  // Direction the arrow points when arriving at the target handle
  if (position) {
    switch (position) {
      case Position.Top: return 90;    // arrow points down into target top
      case Position.Bottom: return -90; // arrow points up into target bottom
      case Position.Left: return 0;     // arrow points right into target left
      case Position.Right: return 180;  // arrow points left into target right
    }
  }
  return 0;
}

function renderEndMarker(targetX: number, targetY: number, angle: number, type: 'open-arrow' | 'filled-arrow' | 'hollow-triangle' | 'hollow-diamond' | 'filled-diamond', color: string) {
  const size = 10;
  // Offset diamond markers away from the handle so they aren't obscured
  const isDiamond = type === 'hollow-diamond' || type === 'filled-diamond';
  const offset = isDiamond ? 8 : 0;
  const rad = (angle * Math.PI) / 180;
  const ox = targetX - Math.cos(rad) * offset;
  const oy = targetY - Math.sin(rad) * offset;
  const transform = `translate(${ox}, ${oy}) rotate(${angle})`;

  switch (type) {
    case 'open-arrow':
      return (
        <polygon
          points={`0,0 ${-size},${-size * 0.5} ${-size},${size * 0.5}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          transform={transform}
        />
      );
    case 'filled-arrow':
      return (
        <polygon
          points={`0,0 ${-size},${-size * 0.5} ${-size},${size * 0.5}`}
          fill={color}
          stroke={color}
          strokeWidth={1}
          strokeLinejoin="round"
          transform={transform}
        />
      );
    case 'hollow-triangle':
      return (
        <polygon
          points={`0,0 ${-size * 1.2},${-size * 0.6} ${-size * 1.2},${size * 0.6}`}
          fill="#fff"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          transform={transform}
        />
      );
    case 'hollow-diamond':
      return (
        <polygon
          points={`${size * 0.6},0 0,${-size * 0.5} ${-size * 0.6},0 0,${size * 0.5}`}
          fill="#fff"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          transform={transform}
        />
      );
    case 'filled-diamond':
      return (
        <polygon
          points={`${size * 0.6},0 0,${-size * 0.5} ${-size * 0.6},0 0,${size * 0.5}`}
          fill={color}
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          transform={transform}
        />
      );
  }
}

function renderStartMarker(sourceX: number, sourceY: number, angle: number, type: 'hollow-diamond' | 'filled-diamond', color: string) {
  const size = 10;
  // Offset diamond markers away from the source handle
  const offset = 8;
  const rad = (angle * Math.PI) / 180;
  const ox = sourceX + Math.cos(rad) * offset;
  const oy = sourceY + Math.sin(rad) * offset;
  const transform = `translate(${ox}, ${oy}) rotate(${angle})`;

  switch (type) {
    case 'hollow-diamond':
      return (
        <polygon
          points={`${size * 0.6},0 0,${-size * 0.5} ${-size * 0.6},0 0,${size * 0.5}`}
          fill="#fff"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          transform={transform}
        />
      );
    case 'filled-diamond':
      return (
        <polygon
          points={`${size * 0.6},0 0,${-size * 0.5} ${-size * 0.6},0 0,${size * 0.5}`}
          fill={color}
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          transform={transform}
        />
      );
  }
}

// ---------- Editable Edge (double-click label to edit) ----------
function EditableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, selected, style, data }: EdgeProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState((label as string) ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText((label as string) ?? ''); }, [label]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.select(); }, [editing]);

  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const commit = () => {
    setEditing(false);
    window.dispatchEvent(new CustomEvent('edge-label-update', { detail: { id, label: text } }));
  };

  const markerType = (data as EdgeData)?.markerType ?? 'open-arrow';
  const lineStyle = (data as EdgeData)?.lineStyle ?? 'solid';
  const edgeColor = selected ? '#2196F3' : (style?.stroke as string) || '#555';
  const endAngle = getTargetAngle(targetPosition);
  const startAngle = getSourceAngle(sourcePosition);

  const dashArray = lineStyle === 'dashed' ? '8,4' : lineStyle === 'dotted' ? '2,4' : undefined;

  // Determine what markers to render
  let endMarkerType: 'open-arrow' | 'filled-arrow' | 'hollow-triangle' | 'hollow-diamond' | 'filled-diamond' | null = null;
  let startMarkerType: 'hollow-diamond' | 'filled-diamond' | null = null;

  switch (markerType) {
    case 'open-arrow': endMarkerType = 'open-arrow'; break;
    case 'filled-arrow': endMarkerType = 'filled-arrow'; break;
    case 'hollow-triangle': endMarkerType = 'hollow-triangle'; break;
    case 'hollow-diamond': endMarkerType = 'hollow-diamond'; break;
    case 'filled-diamond': endMarkerType = 'filled-diamond'; break;
    case 'hollow-diamond-arrow': startMarkerType = 'hollow-diamond'; endMarkerType = 'open-arrow'; break;
    case 'filled-diamond-arrow': startMarkerType = 'filled-diamond'; endMarkerType = 'open-arrow'; break;
  }

  return (
    <>
      <BaseEdge path={edgePath} style={{
        ...style,
        stroke: edgeColor,
        strokeWidth: selected ? 2 : 1.5,
        strokeDasharray: dashArray,
      }} />
      {/* Render markers as SVG shapes */}
      {endMarkerType && renderEndMarker(targetX, targetY, endAngle, endMarkerType, edgeColor)}
      {startMarkerType && renderStartMarker(sourceX, sourceY, startAngle, startMarkerType, edgeColor)}
      <EdgeLabelRenderer>
        <div style={{
          position: 'absolute',
          transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          pointerEvents: 'all',
          zIndex: 10,
        }}>
          {editing ? (
            <input ref={inputRef} value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') { setEditing(false); setText((label as string) ?? ''); }
              }}
              style={{
                border: '1.5px solid #2196F3', borderRadius: 4,
                padding: '2px 8px', fontSize: 11, textAlign: 'center', outline: 'none',
                fontFamily: 'sans-serif', background: '#fff', minWidth: 40, color: '#333',
              }}
            />
          ) : (label as string) ? (
            <div onDoubleClick={() => setEditing(true)}
              style={{
                fontSize: 11, padding: '2px 8px',
                background: '#fff', borderRadius: 3,
                color: '#666', cursor: 'text', whiteSpace: 'nowrap',
              }}
            >
              {label as string}
            </div>
          ) : (
            <div onDoubleClick={() => setEditing(true)}
              style={{
                width: 20, height: 12, cursor: 'text',
              }}
            />
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

// ---------- IndexedDB helpers ----------
const DB_NAME = 'UnderFlowSettings';
const DB_VERSION = 1;
const STORE_NAME = 'settings';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadSettings<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? defaultValue);
      req.onerror = () => resolve(defaultValue);
    });
  } catch {
    return defaultValue;
  }
}

async function saveSettings<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(value, key);
  } catch {}
}

// ---------- Translations ----------
type Lang = 'en' | 'zh';
const translations = {
  en: {
    background: 'Background',
    pattern: 'Pattern',
    dots: 'Dots',
    lines: 'Lines',
    cross: 'Cross',
    none: 'None',
    gap: 'Gap',
    size: 'Size',
    nodeHandleStyle: 'Node Handle Style',
    solidBlack: 'Solid Black',
    hollowBlack: 'Hollow Black',
    lightGray: 'Light Gray',
    language: 'Language',
    nodeProperties: 'Node Properties',
    edgeProperties: 'Edge Properties',
    label: 'Label',
    shape: 'Shape',
    rectangle: 'Rectangle',
    diamond: 'Diamond',
    borderStyle: 'Border Style',
    solid: 'Solid',
    dashed: 'Dashed',
    color: 'Color',
    type: 'Type',
    arrow: 'Arrow',
    line: 'Line',
    dotted: 'Dotted',
    animated: 'Animated',
    save: 'Save',
    open: 'Open',
    layout: 'Layout',
    start: 'Start',
    node: 'Node',
    end: 'End',
    saveSuccess: 'Saved',
    saveFail: 'Save failed',
    saveOnlyDesktop: 'Save is only available in the desktop app.',
    openOnlyDesktop: 'Open is only available in the desktop app.',
    exportSvgFail: 'Export SVG failed',
    exportPngFail: 'Export PNG failed',
    license: 'License',
    registerActivate: 'Register / Activate',
    registeredVersion: 'Registered',
    days: 'days',
    edgeDefault: 'Default',
    edgeSmoothStep: 'Smooth Step',
    edgeStep: 'Step',
    edgeStraight: 'Straight',
    markerNone: 'None',
    markerOpenArrow: 'Open Arrow (Association)',
    markerFilledArrow: 'Filled Arrow (Navigable)',
    markerHollowTriangle: 'Hollow Triangle (Generalization)',
    markerHollowDiamond: 'Hollow Diamond (Aggregation)',
    markerFilledDiamond: 'Filled Diamond (Composition)',
    markerHollowDiamondArrow: 'Hollow Diamond + Arrow',
    markerFilledDiamondArrow: 'Filled Diamond + Arrow',
    exportWatermark: 'Export Watermark',
    aboutUs: 'About Us',
  },
  zh: {
    background: '背景',
    pattern: '图案',
    dots: '点阵',
    lines: '线条',
    cross: '十字',
    none: '无',
    gap: '间距',
    size: '大小',
    nodeHandleStyle: '节点连接点样式',
    solidBlack: '黑色实心',
    hollowBlack: '黑色空心',
    lightGray: '浅白灰',
    language: '语言',
    nodeProperties: '节点属性',
    edgeProperties: '连线属性',
    label: '标签',
    shape: '形状',
    rectangle: '矩形',
    diamond: '菱形',
    borderStyle: '边框样式',
    solid: '实线',
    dashed: '虚线',
    color: '颜色',
    type: '类型',
    arrow: '箭头',
    line: '线条',
    dotted: '点线',
    animated: '动画',
    save: '保存',
    open: '打开',
    layout: '布局',
    start: '开始',
    node: '节点',
    end: '结束',
    saveSuccess: '保存成功',
    saveFail: '保存失败',
    saveOnlyDesktop: '保存功能仅在桌面应用中可用。',
    openOnlyDesktop: '打开功能仅在桌面应用中可用。',
    exportSvgFail: '导出 SVG 失败',
    exportPngFail: '导出 PNG 失败',
    license: '授权',
    registerActivate: '注册 / 激活',
    registeredVersion: '注册版',
    days: '天',
    edgeDefault: '默认',
    edgeSmoothStep: '平滑阶梯',
    edgeStep: '阶梯',
    edgeStraight: '直线',
    markerNone: '无',
    markerOpenArrow: '开放箭头 (关联)',
    markerFilledArrow: '实心箭头 (可导航)',
    markerHollowTriangle: '空心三角 (泛化)',
    markerHollowDiamond: '空心菱形 (聚合)',
    markerFilledDiamond: '实心菱形 (组合)',
    markerHollowDiamondArrow: '空心菱形 + 箭头',
    markerFilledDiamondArrow: '实心菱形 + 箭头',
    exportWatermark: '导出水印',
    aboutUs: '关于我们',
  },
} as const;

type HandleStyleType = 'solid-black' | 'hollow-black' | 'light-gray';

function useT() {
  const lang = useContext(LangContext);
  return useCallback((key: keyof typeof translations.en): string => {
    return translations[lang][key];
  }, [lang]);
}

// ---------- Custom Flow Node (with 4 handles: top/right/bottom/left) ----------
const HandleStyleContext = createContext<HandleStyleType>('solid-black');
const LangContext = createContext<Lang>('en');

function getHandleStyleCSS(type: HandleStyleType): React.CSSProperties {
  switch (type) {
    case 'hollow-black':
      return { width: 6, height: 6, background: '#fff', border: '1.5px solid #333', opacity: 0, transition: 'opacity 150ms ease' };
    case 'light-gray':
      return { width: 8, height: 8, background: '#e2e8f0', border: '2px solid #fff', opacity: 0, transition: 'opacity 150ms ease' };
    case 'solid-black':
    default:
      return { width: 8, height: 8, background: '#333', border: '2px solid #fff', opacity: 0, transition: 'opacity 150ms ease' };
  }
}

const EdgesContext = createContext<Edge[]>([]);

function isHandleConnected(edges: Edge[], nodeId: string, handleId: string | null | undefined, handleType: 'source' | 'target'): boolean {
  const id = handleId ?? undefined;
  return edges.some((e) => {
    if (handleType === 'source') {
      return e.source === nodeId && (e.sourceHandle ?? undefined) === id;
    } else {
      return e.target === nodeId && (e.targetHandle ?? undefined) === id;
    }
  });
}

function useInlineEdit(id: string, label: string | undefined) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(label ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(label ?? ''); }, [label]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    window.dispatchEvent(new CustomEvent('node-label-update', { detail: { id, label: text } }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { setEditing(false); setText(label ?? ''); }
  };

  return { editing, text, inputRef, setEditing, setText, commit, onKeyDown };
}

function FlowNode({ id, data }: NodeProps<Node<NodeData>>) {
  const { editing, text, inputRef, setEditing, setText, commit, onKeyDown } = useInlineEdit(id, (data as NodeData)?.label);
  const edges = useContext(EdgesContext);
  const handleStyleType = useContext(HandleStyleContext);
  const [hovered, setHovered] = useState(false);
  const hs = (handleId: string | null | undefined, type: 'source' | 'target'): React.CSSProperties => {
    const base = getHandleStyleCSS(handleStyleType);
    if (isHandleConnected(edges, id, handleId, type)) return { ...base, opacity: 1 };
    return hovered ? { ...base, opacity: 1 } : base;
  };
  const hasColor = !!(data as NodeData)?.color;
  const color = (data as NodeData)?.color;
  const hasBorderColor = !!(data as NodeData)?.borderColor;
  const bColor = (data as NodeData)?.borderColor;
  const border = hasBorderColor ? bColor! : (hasColor ? color! : '#cbd5e1');
  const borderStyle = (data as NodeData)?.borderStyle === 'dashed' ? 'dashed' : 'solid';
  const bgStyle: React.CSSProperties = hasColor
    ? { background: color, color: '#fff', border: `1px ${borderStyle} ${border}` }
    : { background: '#fff', color: '#333', border: `1px ${borderStyle} ${border}` };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 18px', borderRadius: 4, minWidth: 80,
        textAlign: 'center', fontSize: 13, fontWeight: 500,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)', ...bgStyle,
      }}
    >
      {editing ? (
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
          onBlur={commit} onKeyDown={onKeyDown}
          style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent',
            color: 'inherit', fontSize: 'inherit', fontFamily: 'inherit', fontWeight: 'inherit', textAlign: 'center', padding: 0 }} />
      ) : (
        <div onDoubleClick={() => setEditing(true)} style={{ cursor: 'text' }}>{(data as NodeData)?.label || 'Node'}</div>
      )}
      <Handle type="target" position={Position.Top} style={{ ...hs(null, 'target'), top: -4 }} />
      <Handle type="source" position={Position.Bottom} style={{ ...hs(null, 'source'), bottom: -4 }} />
      <Handle type="target" id="left-in" position={Position.Left} style={{ ...hs('left-in', 'target'), left: -4 }} />
      <Handle type="source" id="left-out" position={Position.Left} style={{ ...hs('left-out', 'source'), left: -4 }} />
      <Handle type="target" id="right-in" position={Position.Right} style={{ ...hs('right-in', 'target'), right: -4 }} />
      <Handle type="source" id="right-out" position={Position.Right} style={{ ...hs('right-out', 'source'), right: -4 }} />
    </div>
  );
}

// ---------- Input Node (bottom handle only) ----------
function InputNode({ id, data }: NodeProps<Node<NodeData>>) {
  const { editing, text, inputRef, setEditing, setText, commit, onKeyDown } = useInlineEdit(id, (data as NodeData)?.label);
  const edges = useContext(EdgesContext);
  const handleStyleType = useContext(HandleStyleContext);
  const [hovered, setHovered] = useState(false);
  const hs = (handleId: string | null | undefined, type: 'source' | 'target'): React.CSSProperties => {
    const base = getHandleStyleCSS(handleStyleType);
    if (isHandleConnected(edges, id, handleId, type)) return { ...base, opacity: 1 };
    return hovered ? { ...base, opacity: 1 } : base;
  };
  const hasColor = !!(data as NodeData)?.color;
  const color = (data as NodeData)?.color;
  const hasBorderColor = !!(data as NodeData)?.borderColor;
  const bColor = (data as NodeData)?.borderColor;
  const border = hasBorderColor ? bColor! : (hasColor ? color! : '#cbd5e1');
  const borderStyle = (data as NodeData)?.borderStyle === 'dashed' ? 'dashed' : 'solid';
  const bgStyle: React.CSSProperties = hasColor
    ? { background: color, color: '#fff', border: `1px ${borderStyle} ${border}` }
    : { background: '#fff', color: '#333', border: `1px ${borderStyle} ${border}` };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 18px', borderRadius: 4, minWidth: 80,
        textAlign: 'center', fontSize: 13, fontWeight: 500,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)', ...bgStyle,
      }}
    >
      {editing ? (
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
          onBlur={commit} onKeyDown={onKeyDown}
          style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent',
            color: 'inherit', fontSize: 'inherit', fontFamily: 'inherit', fontWeight: 'inherit', textAlign: 'center', padding: 0 }} />
      ) : (
        <div onDoubleClick={() => setEditing(true)} style={{ cursor: 'text' }}>{(data as NodeData)?.label || 'Input'}</div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ ...hs(null, 'source'), bottom: -4 }} />
    </div>
  );
}

// ---------- Output Node (top handle only) ----------
function OutputNode({ id, data }: NodeProps<Node<NodeData>>) {
  const { editing, text, inputRef, setEditing, setText, commit, onKeyDown } = useInlineEdit(id, (data as NodeData)?.label);
  const edges = useContext(EdgesContext);
  const handleStyleType = useContext(HandleStyleContext);
  const [hovered, setHovered] = useState(false);
  const hs = (handleId: string | null | undefined, type: 'source' | 'target'): React.CSSProperties => {
    const base = getHandleStyleCSS(handleStyleType);
    if (isHandleConnected(edges, id, handleId, type)) return { ...base, opacity: 1 };
    return hovered ? { ...base, opacity: 1 } : base;
  };
  const hasColor = !!(data as NodeData)?.color;
  const color = (data as NodeData)?.color;
  const hasBorderColor = !!(data as NodeData)?.borderColor;
  const bColor = (data as NodeData)?.borderColor;
  const border = hasBorderColor ? bColor! : (hasColor ? color! : '#cbd5e1');
  const borderStyle = (data as NodeData)?.borderStyle === 'dashed' ? 'dashed' : 'solid';
  const bgStyle: React.CSSProperties = hasColor
    ? { background: color, color: '#fff', border: `1px ${borderStyle} ${border}` }
    : { background: '#fff', color: '#333', border: `1px ${borderStyle} ${border}` };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 18px', borderRadius: 4, minWidth: 80,
        textAlign: 'center', fontSize: 13, fontWeight: 500,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)', ...bgStyle,
      }}
    >
      {editing ? (
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
          onBlur={commit} onKeyDown={onKeyDown}
          style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent',
            color: 'inherit', fontSize: 'inherit', fontFamily: 'inherit', fontWeight: 'inherit', textAlign: 'center', padding: 0 }} />
      ) : (
        <div onDoubleClick={() => setEditing(true)} style={{ cursor: 'text' }}>{(data as NodeData)?.label || 'Output'}</div>
      )}
      <Handle type="target" position={Position.Top} style={{ ...hs(null, 'target'), top: -4 }} />
    </div>
  );
}

// ---------- Initial Data ----------
const initialNodes: Node<NodeData>[] = [
  {
    id: '1',
    type: 'input',
    data: { label: 'Start', color: '', borderColor: '#334155', borderStyle: 'solid', description: 'Flow entry point' },
    position: { x: 250, y: 5 },
  },
  {
    id: '2',
    data: { label: 'Process', color: '', borderColor: '#334155', borderStyle: 'solid', description: 'Main processing step' },
    position: { x: 100, y: 150 },
  },
  {
    id: '3',
    type: 'condition',
    data: { label: 'Decision', color: '', borderColor: '#334155', borderStyle: 'solid', description: 'Decision step', condition: 'value > 10', yesLabel: 'Yes', noLabel: 'No' },
    position: { x: 400, y: 150 },
  },
  {
    id: '4',
    type: 'output',
    data: { label: 'End', color: '', borderColor: '#334155', borderStyle: 'solid', description: 'Flow exit point' },
    position: { x: 250, y: 300 },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', type: 'editable', animated: true, label: 'next', reconnectable: true },
  { id: 'e1-3', source: '1', target: '3', type: 'editable', label: 'branch', reconnectable: true },
  { id: 'e3-4', source: '3', target: '4', type: 'editable', label: 'done', reconnectable: true },
];

// ---------- Node color options ----------
const nodeColors = [
  { label: 'Light Gray', value: '#cbd5e1' },
  { label: 'Rose', value: '#E11D48' },
  { label: 'Coral', value: '#F97316' },
  { label: 'Amber', value: '#F59E0B' },
  { label: 'Emerald', value: '#10B981' },
  { label: 'Cyan', value: '#06B6D4' },
  { label: 'Blue', value: '#3B82F6' },
  { label: 'Violet', value: '#8B5CF6' },
  { label: 'Pink', value: '#EC4899' },
];

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------- Edge type options ----------
const edgeTypeValues = ['default', 'smoothstep', 'step', 'straight'] as const;
const edgeMarkerValues = ['none', 'open-arrow', 'filled-arrow', 'hollow-triangle', 'hollow-diamond', 'filled-diamond', 'hollow-diamond-arrow', 'filled-diamond-arrow'] as const;

// ---------- Property Panel ----------
function PropertyPanel({
  selected,
  nodes,
  edges,
  onUpdateNode,
  onUpdateEdge,
  bgVariant,
  bgGap,
  bgSize,
  handleStyleType,
  language,
  onBgVariantChange,
  onBgGapChange,
  onBgSizeChange,
  onHandleStyleChange,
  onLanguageChange,
  onOpenRegistration,
  licenseStatus,
  showWatermark,
  onShowWatermarkChange,
}: {
  selected: SelectedElement;
  nodes: Node<NodeData>[];
  edges: Edge[];
  onUpdateNode: (id: string, data: Partial<NodeData>, newType?: string) => void;
  onUpdateEdge: (id: string, updates: Partial<Edge>) => void;
  bgVariant: string;
  bgGap: number;
  bgSize: number;
  handleStyleType: HandleStyleType;
  language: 'en' | 'zh';
  onBgVariantChange: (v: string) => void;
  onBgGapChange: (v: number) => void;
  onBgSizeChange: (v: number) => void;
  onHandleStyleChange: (v: HandleStyleType) => void;
  onLanguageChange: (v: 'en' | 'zh') => void;
  onOpenRegistration: () => void;
  licenseStatus: LicenseStatus | null;
  showWatermark: boolean;
  onShowWatermarkChange: (v: boolean) => void;
}) {
  const t = useT();
  if (!selected) {
    return (
      <div style={panelStyle}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 16, color: '#666' }}>{t('background')}</h3>
        <div style={fieldStyle}>
          <label>{t('pattern')}</label>
          <select
            style={inputStyle}
            value={bgVariant}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              onBgVariantChange(e.target.value)
            }
          >
            <option value={BackgroundVariant.Dots}>{t('dots')}</option>
            <option value={BackgroundVariant.Lines}>{t('lines')}</option>
            <option value={BackgroundVariant.Cross}>{t('cross')}</option>
            <option value="none">{t('none')}</option>
          </select>
        </div>
        {bgVariant !== 'none' && (
          <>
            <div style={fieldStyle}>
              <label>{t('gap')}</label>
              <input
                type="range"
                min={10}
                max={60}
                step={5}
                value={bgGap}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onBgGapChange(Number(e.target.value))}
                style={{ width: '100%', marginTop: 4 }}
              />
              <span style={{ fontSize: 12, color: '#999' }}>{bgGap}px</span>
            </div>
            <div style={fieldStyle}>
              <label>{t('size')}</label>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.5}
                value={bgSize}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onBgSizeChange(Number(e.target.value))}
                style={{ width: '100%', marginTop: 4 }}
              />
              <span style={{ fontSize: 12, color: '#999' }}>{bgSize}</span>
            </div>
          </>
        )}
        <div style={{ ...fieldStyle, marginTop: 16 }}>
          <label>{t('nodeHandleStyle')}</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {([
              { value: 'solid-black' as HandleStyleType, label: t('solidBlack'), bg: '#333', border: '#333' },
              { value: 'hollow-black' as HandleStyleType, label: t('hollowBlack'), bg: '#fff', border: '#333' },
              { value: 'light-gray' as HandleStyleType, label: t('lightGray'), bg: '#e2e8f0', border: '#e2e8f0' },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => onHandleStyleChange(opt.value)}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 6,
                  border: handleStyleType === opt.value ? '2px solid #10b981' : '1px solid #e0e0e0',
                  background: '#fff', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  transition: 'all 150ms ease',
                }}
              >
                <div style={{
                  width: 14, height: 14, borderRadius: '50%',
                  background: opt.bg, border: `2px solid ${opt.border}`,
                }} />
                <span style={{ fontSize: 10, color: '#666', whiteSpace: 'nowrap' }}>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div style={{ ...fieldStyle, marginTop: 16 }}>
          <label>{t('language')}</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {([
              { value: 'en' as const, label: 'English' },
              { value: 'zh' as const, label: '中文' },
            ]).map((opt) => (
              <button
                key={opt.value}
                onClick={() => onLanguageChange(opt.value)}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 6,
                  border: language === opt.value ? '2px solid #10b981' : '1px solid #e0e0e0',
                  background: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 150ms ease',
                  fontSize: 12, fontWeight: 500, color: '#333',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {isTauri() && licenseStatus?.is_registered && (
          <div style={fieldStyle}>
            <label>
              <input
                type="checkbox"
                checked={showWatermark}
                onChange={(e) => onShowWatermarkChange(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              {t('exportWatermark')}
            </label>
          </div>
        )}
        {isTauri() && (
          <div style={{ ...fieldStyle, marginTop: 28, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
            <label style={{ color: '#64748b' }}>{t('license')}</label>
            <button
              onClick={onOpenRegistration}
              style={{
                width: '100%', padding: '10px', borderRadius: 8, marginTop: 6,
                border: licenseStatus?.is_registered ? '1px solid #bbf7d0' : '1px solid #3b82f6',
                background: licenseStatus?.is_registered ? '#f0fdf4' : '#eff6ff',
                color: licenseStatus?.is_registered ? '#166534' : '#1d4ed8',
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {licenseStatus?.is_registered ? (
                <>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                  {t('registeredVersion')} · {licenseStatus.days_remaining}{t('days')}
                </>
              ) : (
                t('registerActivate')
              )}
            </button>
          </div>
        )}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e2e8f0', textAlign: 'center' }}>
          <a href="https://underflow.emsoro.cn/" onClick={(e) => { e.preventDefault(); if (isTauri()) openExternalUrl('https://underflow.emsoro.cn/'); else window.open('https://underflow.emsoro.cn/', '_blank'); }} rel="noopener noreferrer" style={{ fontSize: 12, color: '#3b82f6', textDecoration: 'none', cursor: 'pointer' }}>{t('aboutUs')}</a>
        </div>
      </div>
    );
  }

  if (selected.type === 'node') {
    const node = nodes.find((n) => n.id === selected.id);
    if (!node) return null;
    return (
      <div style={panelStyle}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}>{t('nodeProperties')}</h3>
        <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>ID: {node.id}</span>
        </div>
        <div style={fieldStyle}>
          <label>{t('label')}</label>
          <input
            style={inputStyle}
            value={node.data?.label ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onUpdateNode(node.id, { label: e.target.value })
            }
          />
        </div>
        <div style={fieldStyle}>
          <label>{t('shape')}</label>
          <select
            style={inputStyle}
            value={node.type === 'condition' ? 'diamond' : 'rectangle'}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              if (e.target.value === 'diamond') {
                onUpdateNode(node.id, {
                  ...node.data,
                  condition: node.data?.condition || '',
                  yesLabel: node.data?.yesLabel || 'Yes',
                  noLabel: node.data?.noLabel || 'No',
                }, 'condition');
              } else {
                onUpdateNode(node.id, { ...node.data }, 'default');
              }
            }}
          >
            <option value="rectangle">{t('rectangle')}</option>
            <option value="diamond">{t('diamond')}</option>
          </select>
        </div>
        <div style={fieldStyle}>
          <label>{t('borderStyle')}</label>
          <select
            style={inputStyle}
            value={node.data?.borderStyle || 'solid'}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              onUpdateNode(node.id, { borderStyle: e.target.value })
            }
          >
            <option value="solid">{t('solid')}</option>
            <option value="dashed">{t('dashed')}</option>
          </select>
        </div>
        <div style={fieldStyle}>
          <label>{t('color')}</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
            <button
              title="Default (Black border)"
              onClick={() => onUpdateNode(node.id, { color: '', borderColor: '#333333' })}
              style={{
                width: 28, height: 28, borderRadius: '50%',
                border: '2px solid #ddd',
                boxShadow: !(node.data?.color) && (node.data?.borderColor || '') === '#333333' ? `0 0 0 2px ${hexToRgba('#333333', 0.25)}` : 'none',
                background: '#333', cursor: 'pointer', position: 'relative', boxSizing: 'border-box',
              }}
            >
              <span style={{
                position: 'absolute', top: 4, left: 4, right: 4, bottom: 4,
                borderRadius: '50%', background: '#fff',
              }} />
            </button>
            {nodeColors.map((c) => (
              <button
                key={`hollow-${c.value || 'none'}`}
                title={c.label ? `Hollow ${c.label}` : 'None'}
                onClick={() => onUpdateNode(node.id, { color: '', borderColor: c.value })}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  border: '2px solid #ddd',
                  boxShadow: !(node.data?.color) && (node.data?.borderColor || '') === c.value ? `0 0 0 2px ${hexToRgba(c.value, 0.25)}` : 'none',
                  background: c.value || '#f5f5f5',
                  cursor: 'pointer', position: 'relative', boxSizing: 'border-box',
                }}
              >
                {c.value && (
                  <span style={{
                    position: 'absolute', top: 4, left: 4, right: 4, bottom: 4,
                    borderRadius: '50%', background: '#fff',
                  }} />
                )}
              </button>
            ))}
            <label
              title="Custom border"
              style={{
                width: 28, height: 28, borderRadius: '50%', border: '2px solid #ddd',
                background: 'conic-gradient(from 180deg, #E11D48, #F59E0B, #10B981, #3B82F6, #8B5CF6, #E11D48)',
                cursor: 'pointer', overflow: 'hidden', position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                WebkitMask: 'radial-gradient(circle, transparent 7px, black 8px)',
                mask: 'radial-gradient(circle, transparent 7px, black 8px)',
              }}
            >
              <input type="color" value={node.data?.borderColor || '#333333'}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onUpdateNode(node.id, { color: '', borderColor: e.target.value })}
                style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
              />
            </label>
            {nodeColors.filter((c) => c.value).map((c) => (
              <button
                key={`solid-${c.value}`}
                title={`Solid ${c.label}`}
                onClick={() => onUpdateNode(node.id, { color: c.value, borderColor: c.value })}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  border: '2px solid #ddd',
                  boxShadow: (node.data?.color || '') === c.value && (node.data?.borderColor || '') === c.value ? `0 0 0 2px ${hexToRgba(c.value, 0.25)}` : 'none',
                  background: c.value,
                  cursor: 'pointer', position: 'relative', boxSizing: 'border-box',
                }}
              />
            ))}
            <label
              title="Custom color"
              style={{
                width: 28, height: 28, borderRadius: '50%', border: '2px solid #ddd',
                background: 'conic-gradient(from 180deg, #E11D48, #F59E0B, #10B981, #3B82F6, #8B5CF6, #E11D48)',
                cursor: 'pointer', overflow: 'hidden', position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
              }}
            >
              <input type="color" value={node.data?.color || node.data?.borderColor || '#3B82F6'}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onUpdateNode(node.id, { color: e.target.value, borderColor: e.target.value })}
                style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
              />
            </label>
          </div>
        </div>
      </div>
    );
  }

  // Edge
  const edge = edges.find((e) => e.id === selected.id);
  if (!edge) return null;
  return (
    <div style={panelStyle}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}>{t('edgeProperties')}</h3>
      <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>{edge.source} → {edge.target}</span>
      </div>
      <div style={fieldStyle}>
        <label>{t('label')}</label>
        <input
          style={inputStyle}
          value={(edge.label as string) ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onUpdateEdge(edge.id, { label: e.target.value })
          }
        />
      </div>
      <div style={fieldStyle}>
        <label>{t('type')}</label>
        <select
          style={inputStyle}
          value={edge.type ?? 'default'}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            onUpdateEdge(edge.id, { type: e.target.value })
          }
        >
          {edgeTypeValues.map((v) => {
            const keyMap: Record<string, keyof typeof translations.en> = {
              default: 'edgeDefault', smoothstep: 'edgeSmoothStep', step: 'edgeStep', straight: 'edgeStraight',
            };
            return <option key={v} value={v}>{t(keyMap[v])}</option>;
          })}
        </select>
      </div>
      <div style={fieldStyle}>
        <label>{t('arrow')}</label>
        <select
          style={inputStyle}
          value={(edge.data as EdgeData)?.markerType ?? 'open-arrow'}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            onUpdateEdge(edge.id, { data: { ...edge.data, markerType: e.target.value } });
          }}
        >
          {edgeMarkerValues.map((v) => {
            const keyMap: Record<string, keyof typeof translations.en> = {
              'none': 'markerNone', 'open-arrow': 'markerOpenArrow', 'filled-arrow': 'markerFilledArrow',
              'hollow-triangle': 'markerHollowTriangle', 'hollow-diamond': 'markerHollowDiamond',
              'filled-diamond': 'markerFilledDiamond', 'hollow-diamond-arrow': 'markerHollowDiamondArrow',
              'filled-diamond-arrow': 'markerFilledDiamondArrow',
            };
            return <option key={v} value={v}>{t(keyMap[v])}</option>;
          })}
        </select>
      </div>
      <div style={fieldStyle}>
        <label>{t('line')}</label>
        <select
          style={inputStyle}
          value={(edge.data as EdgeData)?.lineStyle ?? 'solid'}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            onUpdateEdge(edge.id, { data: { ...edge.data, lineStyle: e.target.value } });
          }}
        >
          <option value="solid">{t('solid')}</option>
          <option value="dashed">{t('dashed')}</option>
          <option value="dotted">{t('dotted')}</option>
        </select>
      </div>
      <div style={fieldStyle}>
        <label>
          <input
            type="checkbox"
            checked={!!edge.animated}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onUpdateEdge(edge.id, { animated: e.target.checked })
            }
            style={{ marginRight: 6 }}
          />
          {t('animated')}
        </label>
      </div>
    </div>
  );
}

// ---------- Main Flow Component ----------
const FlowchartAppInner = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selected, setSelected] = useState<SelectedElement>(null);
  const [nodeCount, setNodeCount] = useState(5);
  const [panelOpen, setPanelOpen] = useState(true);
  const [bgVariant, setBgVariant] = useState<string>(BackgroundVariant.Dots);
  const [bgGap, setBgGap] = useState(20);
  const [bgSize, setBgSize] = useState(1);
  const [showWatermark, setShowWatermark] = useState(true);
  const [handleStyleType, setHandleStyleType] = useState<HandleStyleType>('solid-black');
  const [language, setLanguage] = useState<'en' | 'zh'>('en');
  const rfInstance = useRef<ReactFlowInstance<Node<NodeData>, Edge> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const t = useCallback((key: keyof typeof translations.en): string => {
    return translations[language][key];
  }, [language]);

  // Load settings from IndexedDB on mount
  useEffect(() => {
    (async () => {
      const [savedBgVariant, savedBgGap, savedBgSize, savedHandleStyle, savedLang] = await Promise.all([
        loadSettings('bgVariant', BackgroundVariant.Dots),
        loadSettings('bgGap', 20),
        loadSettings('bgSize', 1),
        loadSettings('handleStyle', 'solid-black' as HandleStyleType),
        loadSettings('language', 'en' as 'en' | 'zh'),
      ]);
      setBgVariant(savedBgVariant);
      setBgGap(savedBgGap);
      setBgSize(savedBgSize);
      setHandleStyleType(savedHandleStyle);
      setLanguage(savedLang);
    })();
  }, []);

  // Save settings to IndexedDB when changed
  useEffect(() => { saveSettings('bgVariant', bgVariant); }, [bgVariant]);
  useEffect(() => { saveSettings('bgGap', bgGap); }, [bgGap]);
  useEffect(() => { saveSettings('bgSize', bgSize); }, [bgSize]);
  useEffect(() => { saveSettings('handleStyle', handleStyleType); }, [handleStyleType]);
  useEffect(() => { saveSettings('language', language); }, [language]);

  // File state
  const [filePath, setFilePath] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const isDirtyRef = useRef(false);
  const skipDirtyRef = useRef(true); // skip initial render
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const clipboardRef = useRef<Node<NodeData> | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [showRegistration, setShowRegistration] = useState(false);

  // Auto-hide save notification
  useEffect(() => {
    if (!saveMsg) return;
    const timer = setTimeout(() => setSaveMsg(null), 3000);
    return () => clearTimeout(timer);
  }, [saveMsg]);

  // Load license status on mount
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const status = await getLicenseStatus();
        setLicenseStatus(status);
      } catch (err) {
        console.error('Failed to load license status:', err);
      }
    })();
  }, []);

  // Track changes to mark dirty
  useEffect(() => {
    if (skipDirtyRef.current) { skipDirtyRef.current = false; return; }
    setIsDirty(true);
    isDirtyRef.current = true;
  }, [nodes]);
  useEffect(() => {
    if (skipDirtyRef.current) { skipDirtyRef.current = false; return; }
    setIsDirty(true);
    isDirtyRef.current = true;
  }, [edges]);

  // Update window title
  useEffect(() => {
    if (!isTauri()) return;
    const fileName = filePath ? filePath.split(/[\\/]/).pop() : '未命名';
    getCurrentWindow().setTitle(`${fileName} - UnderFlow`);
  }, [filePath, isDirty, lastSavedTime]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge({ ...params, type: 'editable', data: { markerType: 'open-arrow' as EdgeMarkerType }, reconnectable: true }, eds)
      );
    },
    [setEdges]
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === oldEdge.id
            ? { ...e, source: newConnection.source, target: newConnection.target, sourceHandle: newConnection.sourceHandle, targetHandle: newConnection.targetHandle }
            : e
        )
      );
    },
    [setEdges]
  );

  const onSelectionChange = useCallback(({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
    if (selNodes.length === 1 && selEdges.length === 0) {
      setSelected({ type: 'node', id: selNodes[0].id });
    } else if (selEdges.length === 1 && selNodes.length === 0) {
      setSelected({ type: 'edge', id: selEdges[0].id });
    } else {
      setSelected(null);
    }
  }, []);

  const addNode = useCallback(() => {
    const id = `node-${nodeCount}`;
    setNodeCount((c) => c + 1);
    const newNode: Node<NodeData> = {
      id,
      data: { label: `Node ${nodeCount}`, color: '', borderColor: '#334155', description: '' },
      position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodeCount, setNodes]);

  const addInputNode = useCallback(() => {
    const id = `node-${nodeCount}`;
    setNodeCount((c) => c + 1);
    const newNode: Node<NodeData> = {
      id,
      type: 'input',
      data: { label: `Start ${nodeCount}`, color: '', borderColor: '#334155', description: '' },
      position: { x: 200 + Math.random() * 200, y: 50 + Math.random() * 100 },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodeCount, setNodes]);

  const addOutputNode = useCallback(() => {
    const id = `node-${nodeCount}`;
    setNodeCount((c) => c + 1);
    const newNode: Node<NodeData> = {
      id,
      type: 'output',
      data: { label: `End ${nodeCount}`, color: '', borderColor: '#334155', description: '' },
      position: { x: 200 + Math.random() * 200, y: 300 + Math.random() * 100 },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodeCount, setNodes]);

  const onUpdateNode = useCallback(
    (id: string, data: Partial<NodeData>, newType?: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          const newData = { ...n.data, ...data };
          const nodeType = newType || n.type;
          // Condition nodes handle color via SVG diamond, skip background style
          if (nodeType === 'condition') {
            return { ...n, type: nodeType, data: newData };
          }
          // Apply color to style for regular nodes
          let style = { ...(n.style || {}) };
          if (data.color !== undefined) {
            style = data.color
              ? { ...style, background: data.color, color: '#fff', border: `1px solid ${data.color}` }
              : { ...style, background: undefined, color: undefined, border: undefined };
          }
          return { ...n, type: nodeType, data: newData, style };
        })
      );
    },
    [setNodes]
  );

  const onUpdateEdge = useCallback(
    (id: string, updates: Partial<Edge>) => {
      setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, ...updates } : e)));
    },
    [setEdges]
  );

  // Listen for inline node label edits
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, label } = (e as CustomEvent).detail;
      onUpdateNode(id, { label });
    };
    window.addEventListener('node-label-update', handler);
    return () => window.removeEventListener('node-label-update', handler);
  }, [onUpdateNode]);

  // Listen for inline edge label edits
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, label } = (e as CustomEvent).detail;
      onUpdateEdge(id, { label });
    };
    window.addEventListener('edge-label-update', handler);
    return () => window.removeEventListener('edge-label-update', handler);
  }, [onUpdateEdge]);

  // Register custom node/edge types
  const nodeTypes = useMemo(() => ({
    condition: ConditionNode,
    default: FlowNode,
    input: InputNode,
    output: OutputNode,
  }), []);

  const edgeTypes = useMemo(() => ({
    editable: EditableEdge,
  }), []);

  // Auto-layout using ELK
  const elk = useMemo(() => new ELK(), []);

  const onAutoLayout = useCallback(async () => {
    const graph: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.layered.edgeRouting': 'POLYLINE',
        'elk.layered.mergeEdges': 'true',
      },
      children: nodes.map((n) => ({
        id: n.id,
        width: n.type === 'condition' ? 140 : (n.measured?.width ?? 120),
        height: n.type === 'condition' ? 80 : (n.measured?.height ?? 40),
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      })),
    };

    const laid = await elk.layout(graph);

    setNodes((nds) =>
      nds.map((n) => {
        const elkNode = laid.children?.find((c) => c.id === n.id);
        if (!elkNode) return n;
        return { ...n, position: { x: elkNode.x ?? 0, y: elkNode.y ?? 0 } };
      })
    );

    // Update edge types to smoothstep for cleaner routing
    setEdges((eds) =>
      eds.map((e) => ({ ...e, type: 'editable' }))
    );

    // Fit view after layout
    setTimeout(() => rfInstance.current?.fitView({ padding: 0.2, duration: 300 }), 50);
  }, [nodes, edges, elk, setNodes, setEdges]);

  // Save / Open flowchart JSON (Tauri)
  const doSave = useCallback(async (path: string) => {
    const flowData = JSON.stringify({ nodes, edges }, null, 2);
    await saveFlowchart(path, flowData);
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    setFilePath(path);
    setIsDirty(false);
    isDirtyRef.current = false;
    setLastSavedTime(timeStr);
    skipDirtyRef.current = true; // prevent save from triggering dirty
    // Show save success notification
    const fileName = path.split(/[\\/]/).pop() ?? path;
    setSaveMsg(`${t('saveSuccess')} ${fileName} (${timeStr})`);
  }, [nodes, edges]);

  const getDefaultFileName = useCallback(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `flow_${y}${m}${d}_${h}${mi}${s}.uflow`;
  }, []);

  const handleSave = useCallback(async () => {
    if (!isTauri()) { alert(t('saveOnlyDesktop')); return; }
    try {
      if (filePath) {
        await doSave(filePath);
      } else {
        const path = await saveFileDialog(getDefaultFileName());
        if (!path) return;
        await doSave(path);
      }
    } catch (err) {
      console.error('Save failed:', err);
      alert(t('saveFail'));
    }
  }, [filePath, doSave, getDefaultFileName]);

  const handleSaveAs = useCallback(async () => {
    if (!isTauri()) { alert(t('saveOnlyDesktop')); return; }
    try {
      const path = await saveFileDialog(getDefaultFileName());
      if (!path) return;
      await doSave(path);
    } catch (err) {
      console.error('Save As failed:', err);
      alert(t('saveFail'));
    }
  }, [doSave, getDefaultFileName]);

  // Keyboard shortcuts: Ctrl+S save, Ctrl+Shift+S save as, Ctrl+C copy, Ctrl+V paste
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.key === 'S') {
        if (e.shiftKey) {
          e.preventDefault();
          handleSaveAs();
        } else {
          e.preventDefault();
          handleSave();
        }
      }
      if (isMod && e.key === 'c' && selected?.type === 'node') {
        const node = nodes.find((n) => n.id === selected.id);
        if (node) {
          clipboardRef.current = JSON.parse(JSON.stringify(node));
        }
      }
      if (isMod && e.key === 'v' && clipboardRef.current) {
        e.preventDefault();
        const src = clipboardRef.current;
        const id = `node-${nodeCount}`;
        setNodeCount((c) => c + 1);
        const newNode: Node<NodeData> = {
          ...src,
          id,
          selected: false,
          position: { x: src.position.x + 40, y: src.position.y + 40 },
        };
        setNodes((nds) => [...nds, newNode]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, handleSaveAs, selected, nodes, nodeCount, setNodes]);

  // Auto-save every 60 seconds
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setInterval(() => {
      if (isDirtyRef.current && filePath) {
        const flowData = JSON.stringify({ nodes, edges }, null, 2);
        saveFlowchart(filePath, flowData).then(() => {
          const now = new Date();
          const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
          setIsDirty(false);
          isDirtyRef.current = false;
          setLastSavedTime(timeStr);
        }).catch((err) => {
          console.error('Auto-save failed:', err);
        });
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [filePath, nodes, edges]);

  const handleOpen = useCallback(async () => {
    if (!isTauri()) { alert(t('openOnlyDesktop')); return; }
    try {
      const path = await openFileDialog();
      if (!path) return;
      const raw = await loadFlowchart(path);
      const parsed = JSON.parse(raw);
      skipDirtyRef.current = true;
      if (Array.isArray(parsed.nodes)) setNodes(parsed.nodes);
      if (Array.isArray(parsed.edges)) setEdges(parsed.edges);
      setFilePath(path);
      setIsDirty(false);
      isDirtyRef.current = false;
      setLastSavedTime(null);
    } catch (err) {
      console.error('Open failed:', err);
      alert(t('openOnlyDesktop'));
    }
  }, [setNodes, setEdges]);

  // Export functions
  const getExportName = (ext: string) => {
    const d = new Date();
    const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    return `underflow_${ts}.${ext}`;
  };

  const exportCapture = useCallback(async () => {
    await rfInstance.current?.fitView({ padding: 0.1, duration: 0 });
    const panels = document.querySelectorAll('.react-flow__panel') as NodeListOf<HTMLElement>;
    const controls = document.querySelectorAll('.react-flow__controls') as NodeListOf<HTMLElement>;
    const minimap = document.querySelectorAll('.react-flow__minimap') as NodeListOf<HTMLElement>;
    panels.forEach((p) => { p.style.visibility = 'hidden'; });
    controls.forEach((c) => { c.style.visibility = 'hidden'; });
    minimap.forEach((m) => { m.style.visibility = 'hidden'; });
    const el = document.querySelector('.react-flow__renderer') as HTMLElement;
    return { el, restore: () => { panels.forEach((p) => { p.style.visibility = ''; }); controls.forEach((c) => { c.style.visibility = ''; }); minimap.forEach((m) => { m.style.visibility = ''; }); } };
  }, []);

  const addWatermarkToSvg = (svgText: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return svgText;

    const getAttr = (name: string): number => {
      const val = svgEl.getAttribute(name);
      if (!val) return 0;
      const num = parseFloat(val);
      return isNaN(num) ? 0 : num;
    };

    let w = getAttr('width');
    let h = getAttr('height');

    if (w === 0 || h === 0) {
      const viewBox = svgEl.getAttribute('viewBox');
      if (viewBox) {
        const parts = viewBox.split(/\s+/).map(p => parseFloat(p));
        if (parts.length >= 4 && !isNaN(parts[2]) && !isNaN(parts[3])) {
          w = parts[2];
          h = parts[3];
        }
      }
    }

    if (w === 0) w = 800;
    if (h === 0) h = 600;

    const fontSize = Math.max(12, Math.min(w / 60, 16));
    const wmY = h - fontSize - 4;
    const wmX = w / 2;

    const watermarkGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    watermarkGroup.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    watermarkGroup.setAttribute('font-size', fontSize.toString());

    const textEl = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
    textEl.setAttribute('x', wmX.toString());
    textEl.setAttribute('y', wmY.toString());
    textEl.setAttribute('text-anchor', 'middle');

    const tspan1 = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tspan1.setAttribute('fill', '#cbd5e1');
    tspan1.setAttribute('font-weight', '500');
    tspan1.textContent = 'Presented with ';

    const tspan2 = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tspan2.setAttribute('fill', '#475569');
    tspan2.setAttribute('font-weight', '600');
    tspan2.textContent = 'UnderFlow';

    textEl.appendChild(tspan1);
    textEl.appendChild(tspan2);
    watermarkGroup.appendChild(textEl);
    svgEl.appendChild(watermarkGroup);

    return new XMLSerializer().serializeToString(doc);
  };

  const addWatermarkToCanvas = (canvas: HTMLCanvasElement): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const fontSize = 48;
    const text1 = 'Presented with ';
    const text2 = 'UnderFlow';
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
    const text1Width = ctx.measureText(text1).width;
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
    const text2Width = ctx.measureText(text2).width;
    const totalWidth = text1Width + text2Width;
    const x = (canvas.width - totalWidth) / 2;
    const y = canvas.height - fontSize * 0.6;
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(text1, x, y);
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = '#475569';
    ctx.fillText(text2, x + text1Width, y);
  };

  const onExportSVG = useCallback(async () => {
    let restore: (() => void) | undefined;
    try {
      const { el, restore: r } = await exportCapture();
      restore = r;
      if (!el) { alert('Viewport not found'); return; }
      const dataUrl = await toSvg(el, { backgroundColor: '#fff', quality: 1, cacheBust: true, skipAutoScale: true });
      const header = dataUrl.split(',')[0];
      const payload = dataUrl.split(',').slice(1).join(',');
      let svgText: string;
      if (header.includes(';base64')) {
        svgText = atob(payload);
      } else {
        svgText = decodeURIComponent(payload);
      }
      if (showWatermark || !licenseStatus?.is_registered) {
        svgText = addWatermarkToSvg(svgText);
      }
      const fileName = getExportName('svg');
      if (isTauri()) {
        const path = await saveImageDialog(fileName, 'SVG Image', ['svg']);
        if (path) await saveTextFile(path, svgText);
      } else {
        const blob = new Blob([svgText], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = fileName;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) { console.error('Export SVG failed:', err); alert('Export SVG failed: ' + err); }
    finally { restore?.(); }
  }, [exportCapture]);

  const onExportPNG = useCallback(async () => {
    let restore: (() => void) | undefined;
    try {
      const { el, restore: r } = await exportCapture();
      restore = r;
      if (!el) { alert('Viewport not found'); return; }
      const dataUrl = await toPng(el, { backgroundColor: '#fff', pixelRatio: 3, cacheBust: true, skipAutoScale: true });
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = dataUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      if (showWatermark || !licenseStatus?.is_registered) {
        addWatermarkToCanvas(canvas);
      }
      const finalDataUrl = canvas.toDataURL('image/png');
      const base64 = finalDataUrl.split(',')[1];
      const fileName = getExportName('png');
      if (isTauri()) {
        const path = await saveImageDialog(fileName, 'PNG Image', ['png']);
        if (path) await saveBinaryFile(path, base64);
      } else {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = finalDataUrl;
        link.click();
      }
    } catch (err) { console.error('Export PNG failed:', err); alert('Export PNG failed: ' + err); }
    finally { restore?.(); }
  }, [exportCapture]);

  // Apply initial colors to nodes
  const styledNodes = nodes.map((n) => {
    // Condition nodes use SVG diamond fill, skip background style override
    if (n.type === 'condition') return n;
    if (n.data?.color || n.data?.borderColor) {
      const fill = n.data?.color || '#fff';
      const border = n.data?.borderColor || n.data?.color || '#cbd5e1';
      const textColor = n.data?.color ? '#fff' : '#333';
      return {
        ...n,
        style: {
          ...n.style,
          background: fill,
          color: textColor,
          border: `1px solid ${border}`,
        },
      };
    }
    return n;
  });

  return (
    <EdgesContext.Provider value={edges}>
    <HandleStyleContext.Provider value={handleStyleType}>
    <LangContext.Provider value={language}>
    <div ref={wrapperRef} style={{ display: 'flex', width: '100%', height: '100vh' }}>
      {/* Canvas */}
      <div style={{ flex: 1, height: '100%' }}>
        <ReactFlow
          nodes={styledNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          defaultEdgeOptions={{ type: 'editable', reconnectable: true, data: { markerType: 'open-arrow' as EdgeMarkerType } }}
          connectionLineStyle={{ stroke: '#10b981', strokeWidth: 2 }}
          onSelectionChange={onSelectionChange}
          onInit={(instance) => {
            rfInstance.current = instance;
          }}
          proOptions={{ hideAttribution: true }}
          fitView
          deleteKeyCode="Delete"
          snapToGrid
          snapGrid={[20, 20]}
          style={{ margin: 0, padding: 0 }}
        >
          {bgVariant !== 'none' && <Background variant={bgVariant as BackgroundVariant} gap={bgGap} size={bgSize} />}
          <MiniMap
            nodeColor={(n) => (n.data as NodeData)?.color || '#eee'}
            maskColor="rgba(0,0,0,0.1)"
          />
          <Controls />
          <Panel position="top-left">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Add node buttons */}
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.92)',
                padding: '10px 14px', borderRadius: 16,
                boxShadow: '0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)',
                backdropFilter: 'blur(12px)',
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {[
                  { label: t('start'), color: '#059669', hover: '#047857', icon: (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ pointerEvents: 'none' }}>
                      <path d="M4 9h10M10 5l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ), onClick: addInputNode },
                  { label: t('node'), color: '#10b981', hover: '#059669', icon: (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ pointerEvents: 'none' }}>
                      <path d="M9 4v10M4 9h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  ), onClick: addNode },
                  { label: t('end'), color: '#34d399', hover: '#10b981', icon: (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ pointerEvents: 'none' }}>
                      <path d="M14 9H4M8 5L4 9l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ), onClick: addOutputNode },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={item.onClick}
                    title={item.label}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px',
                      borderRadius: 12, transition: 'all 180ms ease', pointerEvents: 'all',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = `${item.color}12`;
                      (e.currentTarget.querySelector('.node-icon') as HTMLElement).style.background = item.hover;
                      (e.currentTarget.querySelector('.node-icon') as HTMLElement).style.transform = 'scale(1.08)';
                      (e.currentTarget.querySelector('.node-icon') as HTMLElement).style.boxShadow = `0 4px 14px ${item.color}50`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'none';
                      (e.currentTarget.querySelector('.node-icon') as HTMLElement).style.background = item.color;
                      (e.currentTarget.querySelector('.node-icon') as HTMLElement).style.transform = 'scale(1)';
                      (e.currentTarget.querySelector('.node-icon') as HTMLElement).style.boxShadow = `0 2px 8px ${item.color}30`;
                    }}
                  >
                    <div
                      className="node-icon"
                      style={{
                        width: 36, height: 36, borderRadius: 10, background: item.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', boxShadow: `0 2px 8px ${item.color}30`,
                        transition: 'all 180ms ease',
                      }}
                    >
                      {item.icon}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: 0.3 }}>
                      {item.label}
                    </span>
                  </button>
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <a href="https://underflow.emsoro.cn/" onClick={(e) => { e.preventDefault(); if (isTauri()) openExternalUrl('https://underflow.emsoro.cn/'); else window.open('https://underflow.emsoro.cn/', '_blank'); }} rel="noopener noreferrer" style={{ fontSize: 10, color: '#3b82f6', textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer' }}>{t('aboutUs')}</a>
                  <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', userSelect: 'none' }}>v1.1.0</span>
                </div>
                </div>
              </div>
              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {isTauri() && (
                  <>
                    <button onClick={handleSave} style={actionBtnStyle}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: 'none' }}>
                        <path d="M11 13H3a1 1 0 01-1-1V2a1 1 0 011-1h5l3 3v8a1 1 0 01-1 1z" stroke="currentColor" strokeWidth="1.2"/>
                        <path d="M9 13V8H5v5M5 1v3h3" stroke="currentColor" strokeWidth="1.2"/>
                      </svg>
                      {t('save')}
                    </button>
                    <button onClick={handleOpen} style={actionBtnStyle}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: 'none' }}>
                        <path d="M12 10v2a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1h3l2 2h3a1 1 0 011 1v4z" stroke="currentColor" strokeWidth="1.2"/>
                      </svg>
                      {t('open')}
                    </button>
                  </>
                )}
                <button onClick={onAutoLayout} style={actionBtnStyle}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: 'none' }}>
                    <path d="M1 3h4M9 3h4M1 7h4M9 7h4M1 11h4M9 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <circle cx="7" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
                    <circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
                    <circle cx="7" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                  {t('layout')}
                </button>
                <button onClick={onExportSVG} style={actionBtnStyle}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: 'none' }}>
                    <path d="M7 1v8M3 6l4 4 4-4M2 12h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  SVG
                </button>
                <button onClick={onExportPNG} style={actionBtnStyle}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: 'none' }}>
                    <path d="M7 1v8M3 6l4 4 4-4M2 12h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  PNG
                </button>
              </div>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* Collapsible Property Panel */}
      <div style={{
        display: 'flex',
        flexShrink: 0,
        height: '100%',
        position: 'relative',
      }}>
        {/* Toggle tab */}
        <button
          onClick={() => setPanelOpen(!panelOpen)}
          style={{
            width: 24,
            height: 64,
            alignSelf: 'center',
            border: 'none',
            borderRight: '1px solid #e8e8e8',
            borderRadius: '8px 0 0 8px',
            background: 'linear-gradient(180deg, #fafafa 0%, #f0f0f0 100%)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#aaa',
            fontSize: 14,
            fontWeight: 300,
            boxShadow: '-2px 0 8px rgba(0,0,0,0.04)',
            transition: 'background 150ms ease, color 150ms ease',
            flexShrink: 0,
            padding: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'linear-gradient(180deg, #f0f0f0 0%, #e8e8e8 100%)';
            e.currentTarget.style.color = '#666';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(180deg, #fafafa 0%, #f0f0f0 100%)';
            e.currentTarget.style.color = '#aaa';
          }}
        >
          {panelOpen ? '›' : '‹'}
        </button>
        {/* Panel content */}
        {panelOpen && (
          <div style={sidebarStyle}>
            <PropertyPanel
              selected={selected}
              nodes={styledNodes}
              edges={edges}
              onUpdateNode={onUpdateNode}
              onUpdateEdge={onUpdateEdge}
              bgVariant={bgVariant}
              bgGap={bgGap}
              bgSize={bgSize}
              handleStyleType={handleStyleType}
              language={language}
              onBgVariantChange={setBgVariant}
              onBgGapChange={setBgGap}
              onBgSizeChange={setBgSize}
              onHandleStyleChange={setHandleStyleType}
              onLanguageChange={setLanguage}
              onOpenRegistration={() => setShowRegistration(true)}
              licenseStatus={licenseStatus}
              showWatermark={showWatermark}
              onShowWatermarkChange={setShowWatermark}
            />
          </div>
        )}
      </div>
      {/* Save success notification */}
      {saveMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1e293b', color: '#fff', padding: '10px 24px',
          borderRadius: 8, fontSize: 14, fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 9999,
          transition: 'opacity 300ms ease',
        }}>
          {saveMsg}
        </div>
      )}
      <RegistrationDialog
        isOpen={showRegistration}
        onClose={() => setShowRegistration(false)}
        onStatusChange={(status) => setLicenseStatus(status)}
        language={language}
      />
    </div>
    </LangContext.Provider>
    </HandleStyleContext.Provider>
    </EdgesContext.Provider>
  );
};

// ---------- Styles ----------
const sidebarStyle: React.CSSProperties = {
  width: 220,
  borderLeft: '1px solid #e0e0e0',
  background: '#fafafa',
  overflowY: 'auto',
  flexShrink: 0,
};

const panelStyle: React.CSSProperties = {
  padding: 16,
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 14,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid #ddd',
  borderRadius: 4,
  fontSize: 13,
  marginTop: 4,
  boxSizing: 'border-box',
};

const actionBtnStyle: React.CSSProperties = {
  background: '#fff',
  color: '#555',
  border: '1px solid #e0e0e0',
  borderRadius: 6,
  padding: '5px 10px',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  transition: 'all 120ms ease',
  pointerEvents: 'all',
};

// ---------- Export with Provider ----------
function FlowchartApp() {
  return (
    <ReactFlowProvider>
      <FlowchartAppInner />
    </ReactFlowProvider>
  );
}

export default FlowchartApp;
