/**
 * Bounded A* on the world cell grid. The world is infinite, so every search has a node budget;
 * when the budget runs out we return the best partial path (closest point reached).
 */
export type Cell = { x: number; y: number };

export function findPath(start: Cell, goal: Cell, passable: (x: number, y: number) => boolean, maxNodes = 4000): Cell[] | null {
  if (start.x === goal.x && start.y === goal.y) return [goal];
  const k = (x: number, y: number) => x * 73856093 ^ y * 19349663;
  const open: { x: number; y: number; f: number; g: number }[] = [];
  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const pos = new Map<number, Cell>();
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - goal.x), dy = Math.abs(y - goal.y);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  const sk = k(start.x, start.y);
  g.set(sk, 0);
  pos.set(sk, start);
  open.push({ ...start, g: 0, f: h(start.x, start.y) });
  let best = { key: sk, h: h(start.x, start.y) };
  let expanded = 0;

  while (open.length && expanded < maxNodes) {
    // binary-heap would be faster; a linear min over a small open list is fine within the budget
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    const ck = k(cur.x, cur.y);
    if (cur.g > (g.get(ck) ?? Infinity)) continue;
    expanded++;
    if (cur.x === goal.x && cur.y === goal.y) return rebuild(ck);
    const ch = h(cur.x, cur.y);
    if (ch < best.h) best = { key: ck, h: ch };
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!passable(nx, ny)) continue;
        if (dx && dy && (!passable(cur.x + dx, cur.y) || !passable(cur.x, cur.y + dy))) continue; // no corner cutting
        const ng = cur.g + (dx && dy ? Math.SQRT2 : 1);
        const nk = k(nx, ny);
        if (ng >= (g.get(nk) ?? Infinity)) continue;
        g.set(nk, ng);
        came.set(nk, ck);
        pos.set(nk, { x: nx, y: ny });
        open.push({ x: nx, y: ny, g: ng, f: ng + h(nx, ny) });
      }
  }
  return best.key === sk ? null : rebuild(best.key);

  function rebuild(end: number): Cell[] {
    const out: Cell[] = [];
    let c: number | undefined = end;
    while (c !== undefined && c !== sk) {
      out.push(pos.get(c)!);
      c = came.get(c);
    }
    return out.reverse();
  }
}

/** Drops intermediate cells on straight runs so walkers move smoothly. */
export function simplify(path: Cell[]): Cell[] {
  if (path.length < 3) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1], b = path[i], c = path[i + 1];
    if (Math.sign(b.x - a.x) !== Math.sign(c.x - b.x) || Math.sign(b.y - a.y) !== Math.sign(c.y - b.y)) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}
