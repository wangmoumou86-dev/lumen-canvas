export type NodeKind = "text" | "image" | "video" | "audio";
export type Grade = "none" | "warm" | "cool" | "rim";

export type BoardNode = {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  body: string;
  src: string;
  grade: Grade;
  crop: number;
  duration: string;
  bars: number[];
};

export type BoardEdge = { id: string; source: string; target: string };

export type ChatMessage = { id: string; role: "user" | "agent"; text: string };

export type Camera = { x: number; y: number; z: number };

let seq = 0;

export function uid(prefix = "n") {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function barsFor(seed: string, count = 36) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const bars: number[] = [];
  for (let i = 0; i < count; i += 1) {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    const n = ((h >>> 0) % 1000) / 1000;
    const shape = 0.45 + Math.abs(Math.sin(i / 2.7)) * 0.55;
    bars.push(Math.max(0.18, Math.min(1, n * 0.55 + shape * 0.45)));
  }
  return bars;
}

const META = 44;

function node(
  partial: Pick<BoardNode, "id" | "kind" | "x" | "y" | "w" | "h" | "title"> & Partial<BoardNode>,
): BoardNode {
  return {
    body: "",
    src: "",
    grade: "none",
    crop: 0,
    duration: "",
    bars: [],
    ...partial,
  };
}

export function seedBoard(): { title: string; nodes: BoardNode[]; edges: BoardEdge[] } {
  const nodes: BoardNode[] = [
    node({
      id: "brief",
      kind: "text",
      x: 40,
      y: 36,
      w: 280,
      h: 230,
      title: "客户简报",
      body: "户外音频，15 秒夜拍。炭黑便携音箱，铜环必须保住。三段镜头加一段旁白，最后收成一条成片。",
    }),
    node({
      id: "script",
      kind: "text",
      x: 440,
      y: 36,
      w: 280,
      h: 210,
      title: "分镜",
      body: "0–4s 火光入画。4–8s 铜环特写。8–12s 湖面拉开。12–15s 旁白收住，不喊口号。",
    }),
    node({
      id: "product",
      kind: "image",
      x: 40,
      y: 310,
      w: 280,
      h: 168 + META,
      title: "产品主图",
      src: "/canvas/product.jpg",
    }),
    node({
      id: "shot1",
      kind: "video",
      x: 860,
      y: 24,
      w: 320,
      h: 180 + META,
      title: "镜 1 · 入画",
      src: "/canvas/camp.jpg",
      duration: "0:04",
    }),
    node({
      id: "shot2",
      kind: "video",
      x: 860,
      y: 292,
      w: 320,
      h: 180 + META,
      title: "镜 2 · 铜环",
      src: "/canvas/hands.jpg",
      duration: "0:03",
    }),
    node({
      id: "shot3",
      kind: "video",
      x: 860,
      y: 560,
      w: 320,
      h: 180 + META,
      title: "镜 3 · 湖面",
      src: "/canvas/lake.jpg",
      duration: "0:04",
    }),
    node({
      id: "vo",
      kind: "audio",
      x: 860,
      y: 828,
      w: 300,
      h: 156,
      title: "旁白",
      body: "夜里，火光只照到一张桌子。声音不用更大，只要更近。",
      duration: "0:08",
      bars: barsFor("vo-spot"),
    }),
    node({
      id: "final",
      kind: "video",
      x: 1320,
      y: 292,
      w: 380,
      h: 214 + META,
      title: "成片 · 15秒",
      src: "/canvas/camp.jpg",
      duration: "0:15",
    }),
  ];

  const edges: BoardEdge[] = (
    [
      ["brief", "script"],
      ["product", "script"],
      ["script", "shot1"],
      ["script", "shot2"],
      ["script", "shot3"],
      ["shot1", "final"],
      ["shot2", "final"],
      ["shot3", "final"],
      ["vo", "final"],
    ] as const
  ).map(([source, target], i) => ({ id: `e-seed-${i}`, source, target }));

  return { title: "露营音箱 · 15秒分镜", nodes, edges };
}

export const KIND_LABEL: Record<NodeKind, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
};

export function defaultNode(kind: NodeKind, x: number, y: number): BoardNode {
  if (kind === "text") {
    return node({ id: uid(), kind, x, y, w: 300, h: 240, title: "未命名文本", body: "" });
  }
  if (kind === "image") {
    return node({
      id: uid(),
      kind,
      x,
      y,
      w: 320,
      h: 200 + META,
      title: "图片",
      src: "/canvas/product.jpg",
    });
  }
  if (kind === "video") {
    return node({
      id: uid(),
      kind,
      x,
      y,
      w: 400,
      h: 224 + META,
      title: "视频",
      src: "/canvas/camp.jpg",
      duration: "0:04",
    });
  }
  return node({
    id: uid(),
    kind,
    x,
    y,
    w: 320,
    h: 168,
    title: "音频",
    body: "写下要说的话，或一段环境声。",
    duration: "0:06",
    bars: barsFor(uid("bar")),
  });
}

export function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap = 12,
) {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

export function freeSpot(nodes: BoardNode[], x: number, y: number, w: number, h: number) {
  let nx = x;
  let ny = y;
  for (let i = 0; i < 12; i += 1) {
    const box = { x: nx, y: ny, w, h };
    if (!nodes.some((n) => overlaps(n, box))) return { x: nx, y: ny };
    ny += 36;
    if (i % 3 === 2) {
      nx += 48;
      ny = y;
    }
  }
  return { x: nx, y: ny };
}

export function portY(node: BoardNode, index: number, count: number) {
  if (count <= 1) return node.y + node.h / 2;
  const gap = Math.min(26, Math.max(16, (node.h - 36) / (count - 1)));
  const span = gap * (count - 1);
  const start = node.y + (node.h - span) / 2;
  return start + gap * index;
}

export function edgeAnchors(nodes: BoardNode[], edges: BoardEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, BoardEdge[]>();
  const incoming = new Map<string, BoardEdge[]>();
  for (const edge of edges) {
    const from = outgoing.get(edge.source) ?? [];
    from.push(edge);
    outgoing.set(edge.source, from);
    const to = incoming.get(edge.target) ?? [];
    to.push(edge);
    incoming.set(edge.target, to);
  }
  const outAt = new Map<string, { index: number; count: number }>();
  const inAt = new Map<string, { index: number; count: number }>();
  for (const list of outgoing.values()) {
    const ordered = [...list].sort((a, b) => (byId.get(a.target)?.y ?? 0) - (byId.get(b.target)?.y ?? 0));
    ordered.forEach((edge, index) => outAt.set(edge.id, { index, count: ordered.length }));
  }
  for (const list of incoming.values()) {
    const ordered = [...list].sort((a, b) => (byId.get(a.source)?.y ?? 0) - (byId.get(b.source)?.y ?? 0));
    ordered.forEach((edge, index) => inAt.set(edge.id, { index, count: ordered.length }));
  }
  return edges.flatMap((edge) => {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    const out = outAt.get(edge.id);
    const inn = inAt.get(edge.id);
    if (!a || !b || !out || !inn) return [];
    return [{ id: edge.id, ...linkEnds(a, b, portY(a, out.index, out.count), portY(b, inn.index, inn.count)) }];
  });
}

export function linkEnds(a: BoardNode, b: BoardNode, y1 = a.y + a.h / 2, y2 = b.y + b.h / 2) {
  return {
    x1: a.x + a.w,
    y1,
    x2: b.x,
    y2,
  };
}

export function edgePath(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const pull = dx >= 0 ? Math.min(160, Math.max(32, dx * 0.5)) : Math.min(64, 8 * Math.sqrt(Math.max(1, -dx)));
  return `M ${x1} ${y1} C ${x1 + pull} ${y1}, ${x2 - pull} ${y2}, ${x2} ${y2}`;
}

export function boundsOf(nodes: BoardNode[]) {
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h));
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function frameMobile(nodes: BoardNode[], vw: number, vh: number): Camera {
  const hero = nodes.find((n) => n.kind === "image") ?? nodes[0];
  if (!hero || vw < 10) return { x: 16, y: 16, z: 0.9 };
  const z = Math.min(1, Math.max(0.72, (vw - 36) / Math.max(hero.w, 280)));
  return {
    z,
    x: vw / 2 - (hero.x + hero.w / 2) * z,
    y: Math.max(24, vh * 0.42 - (hero.y + hero.h / 2) * z),
  };
}

export function frameCamera(nodes: BoardNode[], vw: number, vh: number, pad = 72): Camera {
  if (!nodes.length || vw < 10 || vh < 10) return { x: 48, y: 48, z: 1 };
  const b = boundsOf(nodes);
  const z = Math.min(1.1, Math.max(0.22, Math.min((vw - pad * 2) / b.w, (vh - pad * 2) / b.h)));
  return {
    z,
    x: vw / 2 - ((b.minX + b.maxX) / 2) * z,
    y: vh / 2 - ((b.minY + b.maxY) / 2) * z,
  };
}

const STILLS = [
  { src: "/canvas/product.jpg", title: "棚拍" },
  { src: "/canvas/camp.jpg", title: "篝火" },
  { src: "/canvas/lake.jpg", title: "湖面" },
  { src: "/canvas/hands.jpg", title: "手与火" },
];

export function nextStill(src: string) {
  const i = STILLS.findIndex((s) => s.src === src);
  return STILLS[(i + 1 + STILLS.length) % STILLS.length] ?? STILLS[0];
}

export function stillForPrompt(text: string) {
  if (/月|湖|冷/.test(text)) return STILLS[2];
  if (/手|人|火|近/.test(text)) return STILLS[3];
  if (/棚|产品|铜/.test(text)) return STILLS[0];
  return STILLS[1];
}

export function direct(
  text: string,
  selected: BoardNode[],
  all: BoardNode[],
): { reply: string; created: BoardNode[]; links: { source: string; target: string }[] } {
  const base = selected.length ? selected : all;
  const right = base.length ? Math.max(...base.map((n) => n.x + n.w)) + 72 : 80;
  const top = base.length ? Math.min(...base.map((n) => n.y)) : 80;
  const sources = selected.map((n) => n.id);
  const names = selected.map((n) => n.title).join("、");
  const made: BoardNode[] = [];

  const place = (kind: NodeKind, patch: Partial<BoardNode>) => {
    const draft = { ...defaultNode(kind, right, top), ...patch, id: uid() };
    const spot = freeSpot([...all, ...made], right, top + made.length * (draft.h + 24), draft.w, draft.h);
    const next = { ...draft, x: spot.x, y: spot.y };
    made.push(next);
    return next;
  };

  const linkAll = (id: string) => sources.map((source) => ({ source, target: id }));

  if (/构图|方向/.test(text)) {
    const note = place("text", {
      title: "三条构图",
      w: 320,
      h: 280,
      body: "1. 篝火桌面 — 暖光，铜环是唯一高光。\n2. 湖面月光 — 冷调对照，产品仍在前景。\n3. 手与火 — 只给局部，人物不露脸，用来开场两秒。",
    });
    return {
      reply: names
        ? `按「${names}」收了三条构图，没有改音箱形体。要哪一条落成图片，直接说。`
        : "先给了三条构图。选中产品主图再问一次，我会把参考写清楚。",
      created: made,
      links: linkAll(note.id),
    };
  }

  if (/分镜|镜头表/.test(text)) {
    const note = place("text", {
      title: "15 秒分镜",
      w: 340,
      h: 300,
      body: "0–2s  手与火，音箱虚在前景。\n2–7s  篝火桌面，产品清楚，铜环受光。\n7–12s 湖面，冷暖对切，形体不变。\n12–15s 回到桌面，旁白收在「更近」。",
    });
    return {
      reply: "分镜按现在的两张主视觉和旁白草稿排的。样片节点还是开场那一镜。",
      created: made,
      links: linkAll(note.id),
    };
  }

  if (/视频|样片|接到/.test(text)) {
    const poster = selected.find((n) => n.kind === "image" || n.kind === "video");
    const clip = place("video", {
      title: "样片 · 新镜头",
      src: poster?.src || "/canvas/camp.jpg",
      duration: "0:04",
    });
    return {
      reply: poster
        ? `用「${poster.title}」做了新样片的封面。这一版只是界面预览，不会真正出视频。`
        : "还没有选图片。我先用篝火主视觉放了一条样片节点。",
      created: made,
      links: linkAll(clip.id),
    };
  }

  if (/生成|图片|重绘|落成/.test(text)) {
    const still = stillForPrompt(text);
    const note = place("text", {
      title: "导演批注",
      w: 300,
      h: 200,
      body: names ? `参考「${names}」。形体和铜环不动。` : "未指定参考，先按篝火主视觉。",
    });
    const image = place("image", { title: `预览 · ${still.title}`, src: still.src });
    return {
      reply: `批注在右，并放了一张「${still.title}」预览。连线表示它参考了你选中的节点。`,
      created: made,
      links: [...linkAll(note.id), ...linkAll(image.id)],
    };
  }

  const note = place("text", {
    title: "导演批注",
    w: 320,
    h: 220,
    body: names
      ? `看着「${names}」。${text.trim()}\n先别改产品形体。`
      : "画布上已有简报、主图、两张主视觉、样片和旁白。点一个节点再告诉我下一步。",
  });
  return {
    reply: names
      ? `记下了。当前参考是「${names}」。这版导演只整理画布，不调用模型。`
      : "先在画布上点一个节点，或双击空白处新建。滚轮平移，按住 ⌘ 或 Ctrl 再滚动可以缩放。",
    created: made,
    links: linkAll(note.id),
  };
}
