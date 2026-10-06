import { clsx } from "clsx";
import {
  Aperture,
  Clapperboard,
  Crop,
  Film,
  Image as ImageIcon,
  Maximize2,
  Minus,
  Moon,
  Music,
  Pause,
  PenLine,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Sun,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import {
  KIND_LABEL,
  boundsOf,
  edgeAnchors,
  edgePath,
  frameCamera,
  frameMobile,
  nextStill,
  stillForPrompt,
  type BoardNode,
  type Camera,
  type NodeKind,
} from "./board";
import { makeNode, useBoard, type PersistedBoard } from "./store";

const STORAGE_KEY = "lumen-board-v7";
const THEME_KEY = "lumen-theme";

type MenuState = {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  sourceId?: string;
  upstream?: boolean;
};

type Drag =
  | { type: "pan"; sx: number; sy: number; ox: number; oy: number; button: number }
  | { type: "marquee"; sx: number; sy: number; x: number; y: number; shift: boolean }
  | { type: "move"; sx: number; sy: number; origins: Record<string, { x: number; y: number }> }
  | { type: "link"; sourceId: string; sx: number; sy: number; x: number; y: number };

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function Workbench() {
  const board = useBoard();
  const viewportRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<Camera>({ x: 40, y: 40, z: 0.7 });
  const dragRef = useRef<Drag | null>(null);
  const copyRef = useRef<string[]>([]);
  const spaceRef = useRef(false);
  const [camera, setCamera] = useState<Camera>(camRef.current);
  const [view, setView] = useState({ w: 1280, h: 800 });
  const [narrow, setNarrow] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [tool, setTool] = useState<"light" | "inpaint" | null>(null);
  const [prompt, setPrompt] = useState("桌面换成湿润的湖岸石头，音箱和铜环不动。");
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [link, setLink] = useState<{ sourceId: string; x: number; y: number } | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [armReset, setArmReset] = useState(false);
  const [panning, setPanning] = useState(false);
  const [hint, setHint] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f3f0e8" : "#0c0c0d");
  }, [theme]);

  useEffect(() => {
    camRef.current = camera;
  }, [camera]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setView({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let saved: Camera | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as PersistedBoard;
        if (Array.isArray(data.nodes) && data.nodes.length) {
          useBoard.getState().hydrate(data);
          saved = data.camera ?? null;
        }
      } else {
        useBoard.getState().reset();
      }
    } catch {
      saved = null;
    }
    const frame = requestAnimationFrame(() => {
      const nodes = useBoard.getState().nodes;
      const w = el.clientWidth || window.innerWidth;
      const h = el.clientHeight || window.innerHeight;
      const narrowScreen = window.innerWidth < 760;
      const next = saved ?? (narrowScreen ? frameMobile(nodes, w, h) : frameCamera(nodes, w, h, 80));
      camRef.current = next;
      setCamera(next);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let timer = 0;
    const persist = () => {
      const s = useBoard.getState();
      const payload: PersistedBoard = {
        title: s.title,
        nodes: s.nodes,
        edges: s.edges,
        messages: s.messages,
        camera: camRef.current,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    };
    const unsub = useBoard.subscribe(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(persist, 200);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const s = useBoard.getState();
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          title: s.title,
          nodes: s.nodes,
          edges: s.edges,
          messages: s.messages,
          camera,
        } satisfies PersistedBoard),
      );
    }, 200);
    return () => window.clearTimeout(timer);
  }, [camera]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (isTyping(e.target)) return;
      e.preventDefault();
      const cam = camRef.current;
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const wx = (mx - cam.x) / cam.z;
        const wy = (my - cam.y) / cam.z;
        const next = Math.min(2.2, Math.max(0.2, cam.z * (e.deltaY > 0 ? 0.92 : 1.08)));
        const ncam = { z: next, x: mx - wx * next, y: my - wy * next };
        camRef.current = ncam;
        setCamera(ncam);
      } else {
        const ncam = { ...cam, x: cam.x - e.deltaX, y: cam.y - e.deltaY };
        camRef.current = ncam;
        setCamera(ncam);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAgentOpen((v) => !v);
        return;
      }
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        spaceRef.current = true;
        e.preventDefault();
        return;
      }
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) board.redo();
        else board.undo();
      } else if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        board.redo();
      } else if (meta && e.key.toLowerCase() === "c") {
        copyRef.current = board.selected.slice();
      } else if (meta && e.key.toLowerCase() === "v" && copyRef.current.length) {
        e.preventDefault();
        board.duplicate(copyRef.current);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        board.removeSelected();
      } else if (e.key === "Escape") {
        setMenu(null);
        setTool(null);
        board.select([]);
      } else if (meta && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomBy(1.08);
      } else if (meta && e.key === "-") {
        e.preventDefault();
        zoomBy(1 / 1.08);
      } else if (meta && e.key === "0") {
        e.preventDefault();
        fit(useBoard.getState().nodes);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", up);
    };
  });

  function hold(e: PointerEvent) {
    const el = viewportRef.current;
    if (!el) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
  }

  function clientToWorld(cx: number, cy: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    const cam = camRef.current;
    if (!rect) return { x: 0, y: 0 };
    return { x: (cx - rect.left - cam.x) / cam.z, y: (cy - rect.top - cam.y) / cam.z };
  }

  function zoomBy(factor: number) {
    const cam = camRef.current;
    const next = Math.min(2.2, Math.max(0.2, cam.z * factor));
    const wx = (view.w / 2 - cam.x) / cam.z;
    const wy = (view.h / 2 - cam.y) / cam.z;
    const ncam = { z: next, x: view.w / 2 - wx * next, y: view.h / 2 - wy * next };
    camRef.current = ncam;
    setCamera(ncam);
  }

  function fit(nodes: BoardNode[]) {
    const next = frameCamera(nodes, view.w, view.h, narrow ? 28 : 80);
    camRef.current = next;
    setCamera(next);
  }

  function openMenu(clientX: number, clientY: number, sourceId?: string, place?: "left" | "right") {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const world = clientToWorld(clientX, clientY);
    let worldX = world.x;
    let worldY = world.y;
    if (place && sourceId) {
      const src = useBoard.getState().nodes.find((n) => n.id === sourceId);
      if (src) {
        worldX = place === "left" ? src.x - 360 : src.x + src.w + 88;
        worldY = src.y + 36;
      }
    }
    setMenu({
      x: clientX - rect.left,
      y: clientY - rect.top,
      worldX,
      worldY,
      sourceId,
      upstream: place === "left",
    });
    setTool(null);
  }

  function createAt(kind: NodeKind, worldX: number, worldY: number, sourceId?: string, upstream = false) {
    const node = makeNode(kind, worldX, worldY);
    if (upstream && sourceId) board.addNode(node, [], sourceId);
    else board.addNode(node, sourceId ? [sourceId] : []);
    setMenu(null);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-node],[data-ui]")) return;
    if (e.button === 0) {
      setMenu(null);
      setTool(null);
    }
    const touchPan = e.pointerType === "touch" && e.button === 0;
    if (e.button === 1 || e.button === 2 || spaceRef.current || touchPan) {
      dragRef.current = {
        type: "pan",
        sx: e.clientX,
        sy: e.clientY,
        ox: camRef.current.x,
        oy: camRef.current.y,
        button: e.button,
      };
      setPanning(true);
      hold(e);
      return;
    }
    if (e.button !== 0) return;
    dragRef.current = { type: "marquee", sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, shift: e.shiftKey };
    hold(e);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMarquee({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: 0, h: 0 });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === "pan") {
      const ncam = { ...camRef.current, x: drag.ox + e.clientX - drag.sx, y: drag.oy + e.clientY - drag.sy };
      camRef.current = ncam;
      setCamera(ncam);
      return;
    }
    if (drag.type === "marquee") {
      drag.x = e.clientX;
      drag.y = e.clientY;
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.min(drag.sx, e.clientX) - rect.left;
      const y = Math.min(drag.sy, e.clientY) - rect.top;
      setMarquee({ x, y, w: Math.abs(e.clientX - drag.sx), h: Math.abs(e.clientY - drag.sy) });
      return;
    }
    if (drag.type === "move") {
      const dx = (e.clientX - drag.sx) / camRef.current.z;
      const dy = (e.clientY - drag.sy) / camRef.current.z;
      board.moveLive(drag.origins, dx, dy);
      return;
    }
    if (drag.type === "link") {
      drag.x = e.clientX;
      drag.y = e.clientY;
      const world = clientToWorld(e.clientX, e.clientY);
      setLink({ sourceId: drag.sourceId, x: world.x, y: world.y });
    }
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    setPanning(false);
    setMarquee(null);
    setLink(null);
    if (!drag) return;
    if (drag.type === "pan") {
      const dist = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
      if (drag.button === 2 && dist < 6) openMenu(e.clientX, e.clientY);
      return;
    }
    if (drag.type === "marquee") {
      const dist = Math.hypot(drag.x - drag.sx, drag.y - drag.sy);
      if (dist < 5) {
        if (!drag.shift) board.select([]);
        return;
      }
      const a = clientToWorld(drag.sx, drag.sy);
      const b = clientToWorld(drag.x, drag.y);
      const box = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(a.x - b.x),
        h: Math.abs(a.y - b.y),
      };
      const hits = useBoard
        .getState()
        .nodes.filter((n) => n.x < box.x + box.w && n.x + n.w > box.x && n.y < box.y + box.h && n.y + n.h > box.y)
        .map((n) => n.id);
      board.select(drag.shift ? Array.from(new Set([...board.selected, ...hits])) : hits);
      return;
    }
    if (drag.type === "move") {
      board.commit();
      return;
    }
    if (drag.type === "link") {
      const dist = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node]");
      const target = hit?.getAttribute("data-node");
      if (target && target !== drag.sourceId && dist >= 4) {
        board.addEdge(drag.sourceId, target);
        return;
      }
      const src = useBoard.getState().nodes.find((n) => n.id === drag.sourceId);
      if (src && dist < 8) {
        const rect = viewportRef.current?.getBoundingClientRect();
        const cam = camRef.current;
        const sx = (src.x + src.w + 28) * cam.z + cam.x + (rect?.left ?? 0);
        const sy = (src.y + src.h / 2) * cam.z + cam.y + (rect?.top ?? 0);
        openMenu(sx, sy, src.id, "right");
        return;
      }
      openMenu(e.clientX, e.clientY, drag.sourceId);
    }
  }

  function startMove(node: BoardNode, e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { selected, nodes, select, begin } = useBoard.getState();
    if (e.shiftKey) {
      const next = selected.includes(node.id) ? selected.filter((id) => id !== node.id) : [...selected, node.id];
      select(next, null);
      return;
    }
    const ids = selected.includes(node.id) ? selected : [node.id];
    if (!selected.includes(node.id)) select([node.id], null);
    begin();
    const origins: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) if (ids.includes(n.id)) origins[n.id] = { x: n.x, y: n.y };
    dragRef.current = { type: "move", sx: e.clientX, sy: e.clientY, origins };
    hold(e);
    setMenu(null);
  }

  function startLink(nodeId: string, e: PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const world = clientToWorld(e.clientX, e.clientY);
    dragRef.current = { type: "link", sourceId: nodeId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
    hold(e);
    setLink({ sourceId: nodeId, x: world.x, y: world.y });
    setMenu(null);
  }

  function ask(text: string) {
    const ids = board.ask(text);
    setDraft("");
    setAgentOpen(true);
    const created = useBoard.getState().nodes.filter((n) => ids.includes(n.id));
    if (created.length) fit(created);
  }

  function resetBoard() {
    if (!armReset) {
      setArmReset(true);
      return;
    }
    board.reset();
    localStorage.removeItem(STORAGE_KEY);
    setArmReset(false);
    requestAnimationFrame(() => fit(useBoard.getState().nodes));
  }

  const selectedNodes = board.nodes.filter((n) => board.selected.includes(n.id));
  const primary = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const worldNodes = board.nodes;

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-3 md:px-4">
        <div className="grid size-8 place-items-center text-ink" aria-hidden>
          <svg viewBox="0 0 24 24" className="size-5">
            <circle cx="12" cy="12" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="12" cy="12" r="1.7" fill="currentColor" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <input
            aria-label="项目名称"
            value={board.title}
            onChange={(e) => board.setTitle(e.target.value)}
            className="w-full min-w-0 truncate bg-transparent font-display text-base text-ink outline-none"
          />
        </div>
        <span className="hidden shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-muted sm:inline">
          界面样稿
        </span>
        <div className="flex items-center gap-1">
          <IconButton label="撤销" onClick={() => board.undo()}>
            <Undo2 className="size-4" />
          </IconButton>
          <IconButton label="重做" onClick={() => board.redo()}>
            <Redo2 className="size-4" />
          </IconButton>
          <button
            type="button"
            onClick={resetBoard}
            onBlur={() => setArmReset(false)}
            className="ml-1 hidden h-9 items-center gap-1.5 rounded-full border border-line px-3 text-xs text-muted sm:inline-flex"
          >
            <RotateCcw className="size-3.5" />
            {armReset ? "确认恢复" : "恢复示例"}
          </button>
          <button
            type="button"
            onClick={() => setAgentOpen((v) => !v)}
            className={clsx(
              "ml-1 inline-flex h-9 items-center rounded-full px-3 text-sm",
              agentOpen ? "bg-paper text-paper-ink" : "border border-line text-ink",
            )}
          >
            导演
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <nav
          aria-label="添加节点"
          className={clsx(
            "z-20 flex shrink-0 border-line bg-canvas",
            narrow
              ? "absolute inset-x-0 bottom-0 h-16 flex-row items-center justify-around border-t px-2"
              : "w-14 flex-col items-center gap-1 border-r py-3",
          )}
        >
          {!narrow && <RailButton label="添加" onClick={(e) => openMenu(e.clientX + 12, e.clientY)} icon={<Plus />} />}
          <RailButton label="文本" onClick={() => createAt("text", ...centerWorld(view, camRef.current))} icon={<Type />} />
          <RailButton label="图片" onClick={() => createAt("image", ...centerWorld(view, camRef.current))} icon={<ImageIcon />} />
          <RailButton label="视频" onClick={() => createAt("video", ...centerWorld(view, camRef.current))} icon={<Film />} />
          <RailButton label="音频" onClick={() => createAt("audio", ...centerWorld(view, camRef.current))} icon={<Music />} />
        </nav>

        <div className="relative min-w-0 flex-1">
          <div
            ref={viewportRef}
            className={clsx(
              "board-stage absolute inset-0 overflow-hidden",
              panning || spaceRef.current ? "cursor-grabbing" : "cursor-default",
            )}
            style={{
              backgroundSize: `${22 * camera.z}px ${22 * camera.z}px`,
              backgroundPosition: `${camera.x}px ${camera.y}px`,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).closest("[data-node],[data-ui]")) return;
              openMenu(e.clientX, e.clientY);
            }}
          >
            <div
              className="absolute left-0 top-0"
              style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`, transformOrigin: "0 0" }}
            >
              {worldNodes.map((node) => (
                <NodeCard
                  key={node.id}
                  node={node}
                  selected={board.selected.includes(node.id)}
                  zoom={camera.z}
                  playing={playing === node.id}
                  onPointerDown={(e) => startMove(node, e)}
                  onLink={(e) => startLink(node.id, e)}
                  onAddLeft={(e) => openMenu(e.clientX, e.clientY, node.id, "left")}
                  onTogglePlay={() => setPlaying((id) => (id === node.id ? null : node.id))}
                  onEditFocus={() => board.begin()}
                  onEditBlur={() => board.commit()}
                  onChange={(patch) => board.updateLive(node.id, patch)}
                />
              ))}
            </div>

            <svg className="edge-layer">
              {edgeAnchors(board.nodes, board.edges).map((ends) => {
                const x1 = ends.x1 * camera.z + camera.x;
                const y1 = ends.y1 * camera.z + camera.y;
                const x2 = ends.x2 * camera.z + camera.x;
                const y2 = ends.y2 * camera.z + camera.y;
                const active = board.selectedEdge === ends.id;
                return (
                  <path
                    key={ends.id}
                    d={edgePath(x1, y1, x2, y2)}
                    className={clsx("edge-path hit", active && "is-active")}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      board.select([], ends.id);
                      setMenu(null);
                    }}
                  />
                );
              })}
              {link && (
                <LinkDraft sourceId={link.sourceId} nodes={board.nodes} camera={camera} x={link.x} y={link.y} />
              )}
            </svg>

            {marquee && (
              <div
                className="pointer-events-none absolute border border-ink/70 bg-ink/10"
                style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
              />
            )}

            {menu && (
              <AddMenu
                menu={menu}
                onPick={(kind) => createAt(kind, menu.worldX, menu.worldY, menu.sourceId, menu.upstream)}
                onClose={() => setMenu(null)}
              />
            )}

            {primary && (primary.kind === "image" || primary.kind === "video") && (
              <NodeToolbar
                node={primary}
                camera={camera}
                view={view}
                tool={tool}
                prompt={prompt}
                onPrompt={setPrompt}
                onTool={setTool}
                onCrop={() =>
                  board.branch(primary.id, {
                    title: `裁剪 · ${primary.title.replace(/^裁剪 · /, "")}`,
                    h: Math.round(primary.w * (9 / 16)) + 44,
                    crop: (primary.crop % 3) + 1,
                  })
                }
                onAngle={() => {
                  const still = nextStill(primary.src);
                  board.branch(primary.id, {
                    title: `多角度 · ${still.title}`,
                    src: still.src,
                    grade: "none",
                    crop: 0,
                  });
                }}
                onLight={(grade, label) =>
                  board.branch(primary.id, { title: `打光 · ${label}`, grade, crop: 0 })
                }
                onInpaint={() => {
                  const still = stillForPrompt(prompt);
                  board.branch(primary.id, { title: `重绘 · ${still.title}`, src: still.src, body: prompt, grade: "none" });
                  setTool(null);
                }}
                onFrame={() =>
                  board.branch(primary.id, {
                    kind: "image",
                    title: `截帧 · ${primary.title}`,
                    h: Math.round(primary.w * (9 / 16)) + 44,
                    duration: "",
                  })
                }
              />
            )}

            {selectedNodes.length > 1 && (
              <div data-ui className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted">
                <span className="tabular-nums text-ink">{selectedNodes.length}</span>
                个节点
                <button type="button" className="text-ink" onClick={() => board.removeSelected()}>
                  删除
                </button>
              </div>
            )}

            <div
              data-ui
              className={clsx(
                "absolute left-3 flex items-center gap-2",
                narrow ? "bottom-20" : "bottom-3",
              )}
            >
              <div className="flex items-center rounded-full border border-line bg-panel p-1">
                <IconButton label="缩小" onClick={() => zoomBy(1 / 1.08)}>
                  <Minus className="size-4" />
                </IconButton>
                <span className="w-12 text-center text-xs tabular-nums text-muted">{Math.round(camera.z * 100)}%</span>
                <IconButton label="放大" onClick={() => zoomBy(1.08)}>
                  <Plus className="size-4" />
                </IconButton>
                <IconButton label="适配画面" onClick={() => fit(board.nodes)}>
                  <Maximize2 className="size-4" />
                </IconButton>
              </div>
              {!narrow && board.nodes.length > 0 && (
                <Minimap
                  nodes={board.nodes}
                  camera={camera}
                  width={view.w}
                  height={view.h}
                  onJump={(wx, wy) => {
                    const ncam = {
                      z: camera.z,
                      x: view.w / 2 - wx * camera.z,
                      y: view.h / 2 - wy * camera.z,
                    };
                    camRef.current = ncam;
                    setCamera(ncam);
                  }}
                />
              )}
            </div>

            {hint && (
              <button
                type="button"
                data-ui
                onClick={() => setHint(false)}
                className={clsx(
                  "absolute max-w-sm rounded-full border border-line bg-panel px-3 py-1.5 text-left text-xs text-muted",
                  narrow ? "bottom-20 left-3 right-3" : "bottom-3 right-3",
                )}
              >
                {narrow ? "拖动平移 · 点节点看工具 · 双击新建" : "滚轮平移 · ⌘/Ctrl 缩放 · 空白拖拽框选 · 双击新建"}
              </button>
            )}

            <button
              type="button"
              data-ui
              aria-label={theme === "dark" ? "切换到浅色" : "切换到深色"}
              onClick={() => setTheme((mode) => (mode === "dark" ? "light" : "dark"))}
              className="absolute top-3 right-3 z-20 inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-panel px-3 text-xs text-ink"
            >
              {theme === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
              {theme === "dark" ? "深色" : "浅色"}
            </button>
          </div>
        </div>

        {agentOpen && (
          <AgentPanel
            narrow={narrow}
            messages={board.messages}
            selected={selectedNodes}
            draft={draft}
            onDraft={setDraft}
            onClose={() => setAgentOpen(false)}
            onAsk={ask}
          />
        )}
      </div>
    </main>
  );
}

function centerWorld(view: { w: number; h: number }, cam: Camera): [number, number] {
  return [(view.w / 2 - cam.x) / cam.z, (view.h / 2 - cam.y) / cam.z];
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full text-muted hover:bg-panel-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

function RailButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-full text-muted hover:bg-panel-2 hover:text-ink"
    >
      <span className="size-5 [&_svg]:size-5">{icon}</span>
    </button>
  );
}

function NodeCard({
  node,
  selected,
  zoom,
  playing,
  onPointerDown,
  onLink,
  onAddLeft,
  onTogglePlay,
  onEditFocus,
  onEditBlur,
  onChange,
}: {
  node: BoardNode;
  selected: boolean;
  zoom: number;
  playing: boolean;
  onPointerDown: (e: PointerEvent) => void;
  onLink: (e: PointerEvent) => void;
  onAddLeft: (e: MouseEvent) => void;
  onTogglePlay: () => void;
  onEditFocus: () => void;
  onEditBlur: () => void;
  onChange: (patch: Partial<BoardNode>) => void;
}) {
  return (
    <article
      data-node={node.id}
      className={clsx("node-card group", selected && "is-selected")}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
      onPointerDown={onPointerDown}
    >
      {node.kind === "text" ? (
        <div className="flex h-full flex-col gap-2 p-3">
          <span className="text-xs text-faint">文本</span>
          <input
            value={node.title}
            aria-label="文本标题"
            onChange={(e) => onChange({ title: e.target.value })}
            onFocus={onEditFocus}
            onBlur={onEditBlur}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-sm font-medium text-ink outline-none"
          />
          <textarea
            value={node.body}
            aria-label="文本内容"
            onChange={(e) => onChange({ body: e.target.value })}
            onFocus={onEditFocus}
            onBlur={onEditBlur}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder="写简报、指令或分镜"
            className="min-h-0 flex-1 resize-none bg-transparent font-display text-base leading-normal text-ink outline-none placeholder:text-faint"
          />
        </div>
      ) : node.kind === "audio" ? (
        <div className="flex h-full flex-col justify-between p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">{node.title}</p>
            <span className="text-xs text-faint">音频</span>
          </div>
          <div className="flex items-center gap-2">
            <PlayButton playing={playing} onClick={onTogglePlay} />
            <div className="flex h-8 flex-1 items-center gap-0.5">
              {node.bars.map((bar, i) => (
                <span
                  key={i}
                  className={clsx("wave-bar w-0.5 rounded-full bg-ink/80", playing && "is-on")}
                  style={{ height: `${Math.round(bar * 100)}%`, animationDelay: `${(i % 8) * 80}ms` }}
                />
              ))}
            </div>
            <span className="text-xs tabular-nums text-faint">{node.duration}</span>
          </div>
          <p className="truncate text-xs text-muted">{node.body}</p>
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-panel-2">
            <img
              src={node.src}
              alt={node.title}
              draggable={false}
              data-grade={node.grade}
              data-crop={node.crop ? String(node.crop) : undefined}
              className={clsx("node-media", playing && "is-playing")}
            />
            {node.kind === "video" && (
              <>
                <div className="absolute inset-0 grid place-items-center">
                  <PlayButton playing={playing} onClick={onTogglePlay} large />
                </div>
                <span className="absolute bottom-2 right-2 rounded-full bg-canvas/80 px-2 py-0.5 text-xs tabular-nums text-ink">
                  {node.duration}
                </span>
              </>
            )}
          </div>
          <div className="flex h-11 shrink-0 items-center gap-2 px-3">
            <p className="min-w-0 flex-1 truncate text-sm">{node.title}</p>
            <span className="text-xs text-faint">{KIND_LABEL[node.kind]}</span>
          </div>
        </>
      )}
      <button
        type="button"
        aria-label="在左侧添加上游"
        data-ui
        className={clsx("port", selected && "is-on")}
        style={{ left: 0, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onAddLeft(e);
        }}
      >
        <Plus className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="向右连线"
        data-ui
        className={clsx("port", selected && "is-on")}
        style={{ right: 0, transform: `translate(50%, -50%) scale(${1 / zoom})` }}
        onPointerDown={onLink}
      >
        <Plus className="size-3.5" />
      </button>
    </article>
  );
}

function PlayButton({
  playing,
  onClick,
  large,
}: {
  playing: boolean;
  onClick: () => void;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      data-ui
      aria-label={playing ? "暂停" : "播放"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={clsx(
        "grid place-items-center rounded-full bg-paper text-paper-ink",
        large ? "size-11" : "size-8",
      )}
    >
      {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
    </button>
  );
}

function LinkDraft({
  sourceId,
  nodes,
  camera,
  x,
  y,
}: {
  sourceId: string;
  nodes: BoardNode[];
  camera: Camera;
  x: number;
  y: number;
}) {
  const a = nodes.find((n) => n.id === sourceId);
  if (!a) return null;
  const x1 = (a.x + a.w) * camera.z + camera.x;
  const y1 = (a.y + a.h / 2) * camera.z + camera.y;
  const x2 = x * camera.z + camera.x;
  const y2 = y * camera.z + camera.y;
  return <path d={edgePath(x1, y1, x2, y2)} className="edge-path is-draft" />;
}

function AddMenu({
  menu,
  onPick,
  onClose,
}: {
  menu: MenuState;
  onPick: (kind: NodeKind) => void;
  onClose: () => void;
}) {
  const items: { kind: NodeKind; label: string; icon: ReactNode }[] = [
    { kind: "text", label: "文本", icon: <Type className="size-4" /> },
    { kind: "image", label: "图片", icon: <ImageIcon className="size-4" /> },
    { kind: "video", label: "视频", icon: <Film className="size-4" /> },
    { kind: "audio", label: "音频", icon: <Music className="size-4" /> },
  ];
  const left = Math.max(8, Math.min(menu.x, 520));
  const top = Math.max(8, menu.y);
  return (
    <div data-ui className="float-menu absolute z-30 w-40 rounded-2xl border border-line bg-panel p-1 shadow-none" style={{ left, top }}>
      {items.map((item) => (
        <button
          key={item.kind}
          type="button"
          onClick={() => onPick(item.kind)}
          className="flex h-10 w-full items-center gap-2 rounded-xl px-2 text-sm text-ink hover:bg-panel-2"
        >
          {item.icon}
          {item.label}
        </button>
      ))}
      <button type="button" onClick={onClose} className="sr-only">
        关闭
      </button>
    </div>
  );
}

function NodeToolbar({
  node,
  camera,
  view,
  tool,
  prompt,
  onPrompt,
  onTool,
  onCrop,
  onAngle,
  onLight,
  onInpaint,
  onFrame,
}: {
  node: BoardNode;
  camera: Camera;
  view: { w: number; h: number };
  tool: "light" | "inpaint" | null;
  prompt: string;
  onPrompt: (v: string) => void;
  onTool: (t: "light" | "inpaint" | null) => void;
  onCrop: () => void;
  onAngle: () => void;
  onLight: (grade: BoardNode["grade"], label: string) => void;
  onInpaint: () => void;
  onFrame: () => void;
}) {
  const cx = node.x * camera.z + camera.x + (node.w * camera.z) / 2;
  const top = node.y * camera.z + camera.y;
  if (cx < -40 || cx > view.w + 40 || top < -80 || top > view.h) return null;
  const y = Math.max(52, top - 8);
  return (
    <div data-ui className="absolute z-20" style={{ left: cx, top: y, transform: "translate(-50%, -100%)" }}>
      <div className="flex items-center gap-0.5 rounded-full border border-line bg-panel p-1">
        {node.kind === "image" && (
          <>
            <ToolButton label="裁剪" onClick={onCrop} icon={<Crop className="size-4" />} />
            <ToolButton label="多角度" onClick={onAngle} icon={<Aperture className="size-4" />} />
            <ToolButton label="重绘" onClick={() => onTool(tool === "inpaint" ? null : "inpaint")} icon={<PenLine className="size-4" />} />
            <ToolButton label="打光" onClick={() => onTool(tool === "light" ? null : "light")} icon={<Sun className="size-4" />} />
          </>
        )}
        {node.kind === "video" && (
          <ToolButton label="截帧" onClick={onFrame} icon={<Clapperboard className="size-4" />} />
        )}
        {node.kind === "text" && <span className="px-2 text-xs text-muted">在卡片里改字</span>}
        {node.kind === "audio" && <span className="px-2 text-xs text-muted">{node.duration || "音频"}</span>}
      </div>
      {tool === "light" && node.kind === "image" && (
        <div className="float-menu mt-2 flex gap-1 rounded-2xl border border-line bg-panel p-1">
          <Chip onClick={() => onLight("warm", "篝火")}>篝火</Chip>
          <Chip onClick={() => onLight("cool", "月光")}>月光</Chip>
          <Chip onClick={() => onLight("rim", "轮廓")}>轮廓</Chip>
        </div>
      )}
      {tool === "inpaint" && node.kind === "image" && (
        <form
          className="float-menu mt-2 w-64 rounded-2xl border border-line bg-panel p-2"
          onSubmit={(e) => {
            e.preventDefault();
            onInpaint();
          }}
        >
          <textarea
            value={prompt}
            onChange={(e) => onPrompt(e.target.value)}
            className="h-20 w-full resize-none bg-transparent text-sm text-ink outline-none"
          />
          <button type="submit" className="mt-1 h-9 w-full rounded-full bg-paper text-sm text-paper-ink">
            生成预览节点
          </button>
        </form>
      )}
    </div>
  );
}

function ToolButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-ink hover:bg-panel-2"
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function Chip({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="h-8 rounded-full px-3 text-xs text-ink hover:bg-panel-2">
      {children}
    </button>
  );
}

function Minimap({
  nodes,
  camera,
  width,
  height,
  onJump,
}: {
  nodes: BoardNode[];
  camera: Camera;
  width: number;
  height: number;
  onJump: (wx: number, wy: number) => void;
}) {
  const pad = 80;
  const b = boundsOf(nodes);
  const minX = Math.min(b.minX, -camera.x / camera.z) - pad;
  const minY = Math.min(b.minY, -camera.y / camera.z) - pad;
  const maxX = Math.max(b.maxX, (-camera.x + width) / camera.z) + pad;
  const maxY = Math.max(b.maxY, (-camera.y + height) / camera.z) + pad;
  const ww = Math.max(1, maxX - minX);
  const hh = Math.max(1, maxY - minY);
  const mw = 168;
  const mh = 104;
  const s = Math.min(mw / ww, mh / hh);
  const ox = (mw - ww * s) / 2;
  const oy = (mh - hh * s) / 2;
  return (
    <button
      type="button"
      aria-label="小地图"
      className="relative h-[104px] w-[168px] overflow-hidden rounded-2xl border border-line bg-panel"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        onJump(minX + (px - ox) / s, minY + (py - oy) / s);
      }}
    >
      {nodes.map((n) => (
        <span
          key={n.id}
          className="absolute rounded-sm bg-ink/70"
          style={{
            left: ox + (n.x - minX) * s,
            top: oy + (n.y - minY) * s,
            width: Math.max(3, n.w * s),
            height: Math.max(2, n.h * s),
          }}
        />
      ))}
      <span
        className="pointer-events-none absolute border border-ink"
        style={{
          left: ox + (-camera.x / camera.z - minX) * s,
          top: oy + (-camera.y / camera.z - minY) * s,
          width: (width / camera.z) * s,
          height: (height / camera.z) * s,
        }}
      />
    </button>
  );
}

function AgentPanel({
  narrow,
  messages,
  selected,
  draft,
  onDraft,
  onClose,
  onAsk,
}: {
  narrow: boolean;
  messages: { id: string; role: "user" | "agent"; text: string }[];
  selected: BoardNode[];
  draft: string;
  onDraft: (v: string) => void;
  onClose: () => void;
  onAsk: (text: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length]);
  const chips = ["写三条构图", "拆成 15 秒分镜", "接到新样片"];
  return (
    <aside
      data-ui
      className={clsx(
        "agent-panel z-30 flex flex-col border-line bg-panel",
        narrow ? "absolute inset-x-0 bottom-16 top-auto h-[68%] rounded-t-3xl border" : "h-full w-80 shrink-0 border-l",
      )}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="font-display text-lg leading-none">导演</p>
          <p className="mt-1 text-xs text-faint">只看你选中的节点</p>
        </div>
        <button type="button" aria-label="关闭导演" onClick={onClose} className="grid size-9 place-items-center rounded-full text-muted hover:bg-panel-2">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1 px-4">
        {selected.length ? (
          selected.map((n) => (
            <span key={n.id} className="rounded-full border border-line px-2 py-1 text-xs text-muted">
              {n.title}
            </span>
          ))
        ) : (
          <span className="text-xs text-faint">未选中节点</span>
        )}
      </div>
      <div ref={scroller} className="mt-3 min-h-0 flex-1 space-y-3 overflow-auto px-4 py-2">
        {messages.length === 0 && (
          <p className="text-sm leading-relaxed text-muted">
            这是画布样稿。导演会在右边长出新节点，方便看结构和连线，还不会调用模型。
          </p>
        )}
        {messages.map((m) => (
          <p key={m.id} className={clsx("text-sm leading-relaxed", m.role === "user" ? "text-faint" : "text-ink")}>
            {m.text}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 px-4 pb-2">
        {chips.map((chip) => (
          <button key={chip} type="button" onClick={() => onAsk(chip)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:text-ink">
            {chip}
          </button>
        ))}
      </div>
      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          onAsk(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder="要它怎么用这些节点"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onAsk(draft);
            }
          }}
          className="w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
        <div className="mt-2 flex justify-end">
          <button type="submit" className="h-9 rounded-full bg-paper px-4 text-sm text-paper-ink disabled:opacity-40" disabled={!draft.trim()}>
            放上画布
          </button>
        </div>
      </form>
    </aside>
  );
}
