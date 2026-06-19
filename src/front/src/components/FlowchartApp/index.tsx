import { useCallback, useState, useRef, useMemo, useEffect, createContext, useContext } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { saveFlowchart, loadFlowchart, saveFileDialog, openFileDialog, saveImageDialog, saveBinaryFile, saveTextFile, isTauri } from '../../lib/tauri';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { toPng, toSvg } from 'html-to-image';
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
  MarkerType,
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

// ---------- Custom Condition Node (Diamond) ----------
function ConditionNode({ id, data }: NodeProps<Node<NodeData>>) {
  const { editing, text, inputRef, setEditing, setText, commit, onKeyDown } = useInlineEdit(id, (data as NodeData)?.label);
  const edges = useContext(EdgesContext);
  const [hovered, setHovered] = useState(false);
  const hs = (handleId: string | null | undefined, type: 'source' | 'target'): React.CSSProperties => {
    if (isHandleConnected(edges, id, handleId, type)) return handleVisibleStyle;
    return hovered ? handleVisibleStyle : handleStyle;
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

// ---------- Editable Edge (double-click label to edit) ----------
function EditableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, selected, markerEnd, style }: EdgeProps) {
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

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={{
        ...style,
        stroke: selected ? '#2196F3' : (style?.stroke as string) || '#555',
        strokeWidth: selected ? 2 : 1.5,
      }} />
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

// ---------- Custom Flow Node (with 4 handles: top/right/bottom/left) ----------
const handleStyle: React.CSSProperties = { width: 8, height: 8, background: '#555', border: '2px solid #fff', opacity: 0, transition: 'opacity 150ms ease' };
const handleVisibleStyle: React.CSSProperties = { ...handleStyle, opacity: 1 };

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
  const [hovered, setHovered] = useState(false);
  const hs = (handleId: string | null | undefined, type: 'source' | 'target'): React.CSSProperties => {
    if (isHandleConnected(edges, id, handleId, type)) return handleVisibleStyle;
    return hovered ? handleVisibleStyle : handleStyle;
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
  const [hovered, setHovered] = useState(false);
  const hs = (handleId: string | null | undefined, type: 'source' | 'target'): React.CSSProperties => {
    if (isHandleConnected(edges, id, handleId, type)) return handleVisibleStyle;
    return hovered ? handleVisibleStyle : handleStyle;
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
  const [hovered, setHovered] = useState(false);
  const hs = (handleId: string | null | undefined, type: 'source' | 'target'): React.CSSProperties => {
    if (isHandleConnected(edges, id, handleId, type)) return handleVisibleStyle;
    return hovered ? handleVisibleStyle : handleStyle;
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
  { id: 'e1-2', source: '1', target: '2', type: 'editable', animated: true, label: 'next' },
  { id: 'e1-3', source: '1', target: '3', type: 'editable', label: 'branch' },
  { id: 'e3-4', source: '3', target: '4', type: 'editable', label: 'done' },
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
const edgeTypeOptions = [
  { label: 'Default', value: 'default' },
  { label: 'Smooth Step', value: 'smoothstep' },
  { label: 'Step', value: 'step' },
  { label: 'Straight', value: 'straight' },
];

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
  onBgVariantChange,
  onBgGapChange,
  onBgSizeChange,
}: {
  selected: SelectedElement;
  nodes: Node<NodeData>[];
  edges: Edge[];
  onUpdateNode: (id: string, data: Partial<NodeData>, newType?: string) => void;
  onUpdateEdge: (id: string, updates: Partial<Edge>) => void;
  bgVariant: string;
  bgGap: number;
  bgSize: number;
  onBgVariantChange: (v: string) => void;
  onBgGapChange: (v: number) => void;
  onBgSizeChange: (v: number) => void;
}) {
  if (!selected) {
    return (
      <div style={panelStyle}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 16, color: '#666' }}>Background</h3>
        <div style={fieldStyle}>
          <label>Pattern</label>
          <select
            style={inputStyle}
            value={bgVariant}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              onBgVariantChange(e.target.value)
            }
          >
            <option value={BackgroundVariant.Dots}>Dots</option>
            <option value={BackgroundVariant.Lines}>Lines</option>
            <option value={BackgroundVariant.Cross}>Cross</option>
            <option value="none">None</option>
          </select>
        </div>
        {bgVariant !== 'none' && (
          <>
            <div style={fieldStyle}>
              <label>Gap</label>
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
              <label>Size</label>
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
      </div>
    );
  }

  if (selected.type === 'node') {
    const node = nodes.find((n) => n.id === selected.id);
    if (!node) return null;
    return (
      <div style={panelStyle}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Node Properties</h3>
        <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>ID: {node.id}</span>
        </div>
        <div style={fieldStyle}>
          <label>Label</label>
          <input
            style={inputStyle}
            value={node.data?.label ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onUpdateNode(node.id, { label: e.target.value })
            }
          />
        </div>
        <div style={fieldStyle}>
          <label>Shape</label>
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
            <option value="rectangle">Rectangle</option>
            <option value="diamond">Diamond</option>
          </select>
        </div>
        <div style={fieldStyle}>
          <label>Border Style</label>
          <select
            style={inputStyle}
            value={node.data?.borderStyle || 'solid'}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              onUpdateNode(node.id, { borderStyle: e.target.value })
            }
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
          </select>
        </div>
        <div style={fieldStyle}>
          <label>Color</label>
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
      <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Edge Properties</h3>
      <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>{edge.source} → {edge.target}</span>
      </div>
      <div style={fieldStyle}>
        <label>Label</label>
        <input
          style={inputStyle}
          value={(edge.label as string) ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onUpdateEdge(edge.id, { label: e.target.value })
          }
        />
      </div>
      <div style={fieldStyle}>
        <label>Type</label>
        <select
          style={inputStyle}
          value={edge.type ?? 'default'}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            onUpdateEdge(edge.id, { type: e.target.value })
          }
        >
          {edgeTypeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div style={fieldStyle}>
        <label>Arrow</label>
        <select
          style={inputStyle}
          value={(edge.markerEnd as { type: MarkerType })?.type ?? MarkerType.ArrowClosed}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            onUpdateEdge(edge.id, { markerEnd: { type: e.target.value as MarkerType } })
          }
        >
          <option value={MarkerType.ArrowClosed}>Filled Arrow</option>
          <option value={MarkerType.Arrow}>Open Arrow</option>
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
          Animated
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
  const rfInstance = useRef<ReactFlowInstance<Node<NodeData>, Edge> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge({ ...params, type: 'editable', markerEnd: { type: MarkerType.ArrowClosed } }, eds)
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
  const handleSave = useCallback(async () => {
    if (!isTauri()) { alert('Save is only available in the desktop app.'); return; }
    try {
      const path = await saveFileDialog();
      if (!path) return;
      const flowData = JSON.stringify({ nodes, edges }, null, 2);
      await saveFlowchart(path, flowData);
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save flowchart.');
    }
  }, [nodes, edges]);

  const handleOpen = useCallback(async () => {
    if (!isTauri()) { alert('Open is only available in the desktop app.'); return; }
    try {
      const path = await openFileDialog();
      if (!path) return;
      const raw = await loadFlowchart(path);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.nodes)) setNodes(parsed.nodes);
      if (Array.isArray(parsed.edges)) setEdges(parsed.edges);
    } catch (err) {
      console.error('Open failed:', err);
      alert('Failed to open flowchart.');
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
      const fileName = getExportName('svg');
      if (isTauri()) {
        const path = await saveImageDialog(fileName, 'SVG Image', ['svg']);
        if (path) await saveTextFile(path, svgText);
      } else {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = dataUrl;
        link.click();
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
      const base64 = dataUrl.split(',')[1];
      const fileName = getExportName('png');
      if (isTauri()) {
        const path = await saveImageDialog(fileName, 'PNG Image', ['png']);
        if (path) await saveBinaryFile(path, base64);
      } else {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = dataUrl;
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
                display: 'flex', gap: 8, background: 'rgba(255,255,255,0.92)',
                padding: '10px 14px', borderRadius: 16,
                boxShadow: '0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)',
                backdropFilter: 'blur(12px)',
              }}>
                {[
                  { label: 'Start', color: '#059669', hover: '#047857', icon: (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ pointerEvents: 'none' }}>
                      <path d="M4 9h10M10 5l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ), onClick: addInputNode },
                  { label: 'Node', color: '#10b981', hover: '#059669', icon: (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ pointerEvents: 'none' }}>
                      <path d="M9 4v10M4 9h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  ), onClick: addNode },
                  { label: 'End', color: '#34d399', hover: '#10b981', icon: (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ pointerEvents: 'none' }}>
                      <path d="M14 9H4M8 5L4 9l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ), onClick: addOutputNode },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={item.onClick}
                    title={`Add ${item.label}`}
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
              </div>
              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {isTauri() && (
                  <>
                    <button onClick={handleSave} style={actionBtnStyle}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: 'none' }}>
                        <path d="M11 13H3a1 1 0 01-1-1V2a1 1 0 011-1h5l3 3v8a1 1 0 01-1 1z" stroke="currentColor" strokeWidth="1.2"/>
                        <path d="M9 13V8H5v5M5 1v3h3" stroke="currentColor" strokeWidth="1.2"/>
                      </svg>
                      Save
                    </button>
                    <button onClick={handleOpen} style={actionBtnStyle}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: 'none' }}>
                        <path d="M12 10v2a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1h3l2 2h3a1 1 0 011 1v4z" stroke="currentColor" strokeWidth="1.2"/>
                      </svg>
                      Open
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
                  Layout
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
              onBgVariantChange={setBgVariant}
              onBgGapChange={setBgGap}
              onBgSizeChange={setBgSize}
            />
          </div>
        )}
      </div>
    </div>
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
