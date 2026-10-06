import { create } from "zustand";
import {
  defaultNode,
  direct,
  freeSpot,
  seedBoard,
  uid,
  type BoardEdge,
  type BoardNode,
  type Camera,
  type ChatMessage,
  type NodeKind,
} from "./board";

type Snap = { nodes: BoardNode[]; edges: BoardEdge[] };

export type PersistedBoard = {
  title: string;
  nodes: BoardNode[];
  edges: BoardEdge[];
  messages: ChatMessage[];
  camera?: Camera;
};

type BoardState = {
  title: string;
  nodes: BoardNode[];
  edges: BoardEdge[];
  messages: ChatMessage[];
  selected: string[];
  selectedEdge: string | null;
  past: Snap[];
  future: Snap[];
  gesture: Snap | null;
  hydrate: (data: PersistedBoard) => void;
  reset: () => void;
  setTitle: (title: string) => void;
  begin: () => void;
  commit: () => void;
  select: (ids: string[], edge?: string | null) => void;
  moveLive: (origins: Record<string, { x: number; y: number }>, dx: number, dy: number) => void;
  updateLive: (id: string, patch: Partial<BoardNode>) => void;
  removeSelected: () => void;
  addNode: (node: BoardNode, sources?: string[], upstreamOf?: string) => void;
  addEdge: (source: string, target: string) => boolean;
  branch: (id: string, patch: Partial<BoardNode>) => string | null;
  duplicate: (ids: string[]) => string[];
  undo: () => void;
  redo: () => void;
  ask: (text: string) => string[];
};

const seed = seedBoard();

function sameSnap(a: Snap, nodes: BoardNode[], edges: BoardEdge[]) {
  return JSON.stringify(a.nodes) === JSON.stringify(nodes) && JSON.stringify(a.edges) === JSON.stringify(edges);
}

export const useBoard = create<BoardState>((set, get) => ({
  title: seed.title,
  nodes: seed.nodes,
  edges: seed.edges,
  messages: [],
  selected: [],
  selectedEdge: null,
  past: [],
  future: [],
  gesture: null,

  hydrate: (data) =>
    set({
      title: data.title || seed.title,
      nodes: data.nodes,
      edges: data.edges,
      messages: data.messages ?? [],
      selected: [],
      selectedEdge: null,
      past: [],
      future: [],
      gesture: null,
    }),

  reset: () => {
    const next = seedBoard();
    set({
      title: next.title,
      nodes: next.nodes,
      edges: next.edges,
      messages: [],
      selected: [],
      selectedEdge: null,
      past: [],
      future: [],
      gesture: null,
    });
  },

  setTitle: (title) => set({ title }),

  begin: () => {
    const { gesture, nodes, edges } = get();
    if (gesture) return;
    set({ gesture: { nodes, edges } });
  },

  commit: () => {
    const { gesture, nodes, edges, past } = get();
    if (!gesture) return;
    if (sameSnap(gesture, nodes, edges)) set({ gesture: null });
    else set({ past: [...past, gesture].slice(-60), future: [], gesture: null });
  },

  select: (ids, edge = null) => set({ selected: ids, selectedEdge: edge }),

  moveLive: (origins, dx, dy) =>
    set({
      nodes: get().nodes.map((n) => {
        const o = origins[n.id];
        return o ? { ...n, x: o.x + dx, y: o.y + dy } : n;
      }),
    }),

  updateLive: (id, patch) =>
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }),

  removeSelected: () => {
    const { nodes, edges, selected, selectedEdge, past, gesture } = get();
    if (!selected.length && !selectedEdge) return;
    const ids = new Set(selected);
    const base = gesture ?? { nodes, edges };
    set({
      past: [...past, base].slice(-60),
      future: [],
      gesture: null,
      nodes: nodes.filter((n) => !ids.has(n.id)),
      edges: edges.filter((e) => e.id !== selectedEdge && !ids.has(e.source) && !ids.has(e.target)),
      selected: [],
      selectedEdge: null,
    });
  },

  addNode: (node, sources = [], upstreamOf?: string) => {
    const { nodes, edges, past, gesture } = get();
    const base = gesture ?? { nodes, edges };
    const spot = freeSpot(nodes, node.x, node.y, node.w, node.h);
    const placed = { ...node, x: spot.x, y: spot.y };
    const links = sources
      .filter((source) => source && source !== placed.id)
      .map((source) => ({ id: uid("e"), source, target: placed.id }));
    if (upstreamOf && upstreamOf !== placed.id) {
      links.push({ id: uid("e"), source: placed.id, target: upstreamOf });
    }
    set({
      past: [...past, base].slice(-60),
      future: [],
      gesture: null,
      nodes: [...nodes, placed],
      edges: [...edges, ...links],
      selected: [placed.id],
      selectedEdge: null,
    });
  },

  addEdge: (source, target) => {
    if (!source || !target || source === target) return false;
    const { nodes, edges, past, gesture } = get();
    if (edges.some((e) => e.source === source && e.target === target)) return false;
    if (!nodes.some((n) => n.id === source) || !nodes.some((n) => n.id === target)) return false;
    const base = gesture ?? { nodes, edges };
    set({
      past: [...past, base].slice(-60),
      future: [],
      gesture: null,
      edges: [...edges, { id: uid("e"), source, target }],
      selectedEdge: null,
    });
    return true;
  },

  branch: (id, patch) => {
    const { nodes, edges, past, gesture } = get();
    const src = nodes.find((n) => n.id === id);
    if (!src) return null;
    const draft: BoardNode = {
      ...src,
      ...patch,
      id: uid(),
      bars: src.bars.slice(),
      x: src.x + src.w + 64,
      y: src.y,
    };
    const spot = freeSpot(nodes, draft.x, draft.y, draft.w, draft.h);
    draft.x = spot.x;
    draft.y = spot.y;
    const base = gesture ?? { nodes, edges };
    set({
      past: [...past, base].slice(-60),
      future: [],
      gesture: null,
      nodes: [...nodes, draft],
      edges: [...edges, { id: uid("e"), source: id, target: draft.id }],
      selected: [draft.id],
      selectedEdge: null,
    });
    return draft.id;
  },

  duplicate: (ids) => {
    const { nodes, edges, past, gesture } = get();
    const idset = new Set(ids);
    const map = new Map<string, string>();
    const copies = nodes
      .filter((n) => idset.has(n.id))
      .map((n) => {
        const id = uid();
        map.set(n.id, id);
        return { ...n, id, x: n.x + 36, y: n.y + 36, bars: n.bars.slice() };
      });
    if (!copies.length) return [];
    const extra = edges
      .filter((e) => idset.has(e.source) && idset.has(e.target))
      .map((e) => ({ id: uid("e"), source: map.get(e.source) ?? e.source, target: map.get(e.target) ?? e.target }));
    const base = gesture ?? { nodes, edges };
    const nextIds = copies.map((n) => n.id);
    set({
      past: [...past, base].slice(-60),
      future: [],
      gesture: null,
      nodes: [...nodes, ...copies],
      edges: [...edges, ...extra],
      selected: nextIds,
      selectedEdge: null,
    });
    return nextIds;
  },

  undo: () => {
    const { past, future, nodes, edges } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      past: past.slice(0, -1),
      future: [...future, { nodes, edges }],
      gesture: null,
      selected: [],
      selectedEdge: null,
    });
  },

  redo: () => {
    const { past, future, nodes, edges } = get();
    const next = future[future.length - 1];
    if (!next) return;
    set({
      nodes: next.nodes,
      edges: next.edges,
      future: future.slice(0, -1),
      past: [...past, { nodes, edges }],
      gesture: null,
      selected: [],
      selectedEdge: null,
    });
  },

  ask: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const { nodes, edges, messages, selected, past, gesture } = get();
    const picked = nodes.filter((n) => selected.includes(n.id));
    const result = direct(trimmed, picked, nodes);
    const links = result.links
      .filter((l) => l.source && l.target && l.source !== l.target)
      .map((l) => ({ id: uid("e"), source: l.source, target: l.target }));
    const base = gesture ?? { nodes, edges };
    const ids = result.created.map((n) => n.id);
    set({
      past: [...past, base].slice(-60),
      future: [],
      gesture: null,
      nodes: [...nodes, ...result.created],
      edges: [...edges, ...links],
      messages: [
        ...messages,
        { id: uid("m"), role: "user", text: trimmed },
        { id: uid("m"), role: "agent", text: result.reply },
      ],
      selected: ids,
      selectedEdge: null,
    });
    return ids;
  },
}));

if (typeof window !== "undefined" && localStorage.getItem("lumen-layout") !== "7") {
  localStorage.setItem("lumen-layout", "7");
  localStorage.removeItem("lumen-board-v6");
  localStorage.removeItem("lumen-board-v7");
  queueMicrotask(() => useBoard.getState().reset());
}

export function makeNode(kind: NodeKind, x: number, y: number) {
  return defaultNode(kind, x, y);
}
