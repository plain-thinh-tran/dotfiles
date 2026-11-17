#!/usr/bin/env python3
import json
import os
import sys

N, E, S, W = 1, 2, 4, 8
OPPOSITE = {N: S, S: N, E: W, W: E}
GLYPHS = {
    N: '│', S: '│', N | S: '│',
    E: '─', W: '─', E | W: '─',
    S | E: '┌', S | W: '┐', N | E: '└', N | W: '┘',
    N | S | E: '├', N | S | W: '┤', E | W | S: '┬', E | W | N: '┴',
    N | S | E | W: '┼',
}
DASHED = {E | W: '┄', N | S: '┆'}
ARROWS = {S: '▼', N: '▲', E: '▶', W: '◀'}


def as_lines(value):
    return value.split('\n') if isinstance(value, str) else list(value)


class Box:
    def __init__(self, x, y, w, h):
        self.x, self.y, self.w, self.h = x, y, w, h

    @property
    def left(self):
        return self.x

    @property
    def right(self):
        return self.x + self.w - 1

    @property
    def top(self):
        return self.y

    @property
    def bottom(self):
        return self.y + self.h - 1

    @property
    def cx(self):
        return self.x + self.w // 2

    @property
    def cy(self):
        return self.y + self.h // 2

    def row(self, i):
        return self.y + 1 + i


def box_size(lines):
    lines = as_lines(lines)
    return max(len(line) for line in lines) + 4, len(lines) + 2


class Canvas:
    def __init__(self):
        self.cells = {}
        self.chars = {}
        self.nets = 0
        self.dashed = set()

    def new_net(self):
        self.nets += 1
        return self.nets

    def _net_at(self, x, y):
        nets = self.cells.get((x, y))
        return next(iter(nets)) if nets else None

    def _add(self, x, y, d, net):
        nets = self.cells.setdefault((x, y), {})
        nets[net] = nets.get(net, 0) | d

    def line(self, points, arrow=False, join=True, net=None):
        own = net if net is not None else self.new_net()
        last = len(points) - 1
        heading = None
        for i in range(last):
            (x1, y1), (x2, y2) = points[i], points[i + 1]
            if x1 != x2 and y1 != y2:
                raise ValueError(f'segment {points[i]} -> {points[i + 1]} is not straight')
            dx = (x2 > x1) - (x2 < x1)
            dy = (y2 > y1) - (y2 < y1)
            heading = E if dx > 0 else W if dx < 0 else S if dy > 0 else N
            x, y = x1, y1
            while (x, y) != (x2, y2):
                nx, ny = x + dx, y + dy
                self._add(x, y, heading, self._pick(x, y, own, join, i == 0 and (x, y) == points[0]))
                end = i + 1 == last and (nx, ny) == points[-1]
                self._add(nx, ny, OPPOSITE[heading], self._pick(nx, ny, own, join, end))
                x, y = nx, ny
        if arrow and heading is not None:
            self.chars[points[-1]] = ARROWS[heading]
        return own

    def _pick(self, x, y, own, join, endpoint):
        if join and endpoint:
            existing = self._net_at(x, y)
            if existing is not None:
                return existing
        return own

    def text(self, x, y, s):
        for i, ch in enumerate(s):
            self.chars[(x + i, y)] = ch

    def box(self, x, y, lines, width=None, dashed=False):
        lines = as_lines(lines)
        w, h = box_size(lines)
        w = max(w, width or 0)
        r, b = x + w - 1, y + h - 1
        net = self.line([(x, y), (r, y), (r, b), (x, b), (x, y)], join=False)
        if dashed:
            self.dashed.add(net)
        for row in range(y + 1, b):
            self.text(x + 1, row, ' ' * (w - 2))
        for i, line in enumerate(lines):
            self.text(x + 2, y + 1 + i, line)
        return Box(x, y, w, h)

    def render(self):
        keys = list(self.cells) + list(self.chars)
        if not keys:
            return ''
        width = max(x for x, _ in keys) + 1
        height = max(y for _, y in keys) + 1
        grid = [[' '] * width for _ in range(height)]
        for (x, y), nets in self.cells.items():
            dirs = list(nets.values())
            if len(dirs) > 1 and any(d & (N | S) for d in dirs):
                grid[y][x] = '│'
            else:
                combined = 0
                for d in dirs:
                    combined |= d
                grid[y][x] = GLYPHS[combined]
                if set(nets) <= self.dashed and combined in DASHED:
                    grid[y][x] = DASHED[combined]
        for (x, y), ch in self.chars.items():
            grid[y][x] = ch
        return '\n'.join(''.join(row).rstrip() for row in grid).rstrip('\n')


def bus(canvas, sources, targets, lane_y):
    xs = [x for x, _ in sources] + [x for x, _, _ in targets]
    lo, hi = min(xs), max(xs)
    if lo < hi:
        canvas.line([(lo, lane_y), (hi, lane_y)])
    for x, y in sources:
        canvas.line([(x, y), (x, lane_y)])
    for x, y, arrow in targets:
        canvas.line([(x, lane_y), (x, y)], arrow=arrow)


def layers(spec):
    nodes = {k: as_lines(v) for k, v in spec['nodes'].items()}
    rows = [list(r) for r in spec['rows']]
    hgap = spec.get('hgap', 3)
    align = spec.get('align', 'center')
    row_of = {n: i for i, r in enumerate(rows) for n in r}
    for n in nodes:
        if n not in row_of:
            raise SystemExit(f'node {n} is in no row')
    edges = []
    dummies = set()
    for a, b in spec.get('edges', []):
        for n in (a, b):
            if n not in row_of:
                raise SystemExit(f'edge {a} -> {b}: unknown node {n}')
        if row_of[b] <= row_of[a]:
            raise SystemExit(f'edge {a} -> {b} must point to a lower row')
        prev = a
        for r in range(row_of[a] + 1, row_of[b]):
            d = f'~{a}~{b}~{r}'
            rows[r].append(d)
            row_of[d] = r
            dummies.add(d)
            edges.append((prev, d))
            prev = d
        edges.append((prev, b))

    size = {n: (1, 1) if n in dummies else box_size(nodes[n]) for r in rows for n in r}
    row_w = [sum(size[n][0] for n in r) + hgap * max(len(r) - 1, 0) for r in rows]
    total_w = max(row_w)
    xpos = {}
    for i, r in enumerate(rows):
        x = (total_w - row_w[i]) // 2 if align == 'center' else 0
        for n in r:
            xpos[n] = x
            x += size[n][0] + hgap

    def cx(n):
        return xpos[n] if n in dummies else xpos[n] + size[n][0] // 2

    gaps = []
    for i in range(len(rows) - 1):
        gap_edges = [(a, b) for a, b in edges if row_of[a] == i]
        parent = {}

        def find(n):
            while parent.setdefault(n, n) != n:
                n = parent[n]
            return n

        for a, b in gap_edges:
            parent[find(a)] = find(b)
        comps = {}
        for a, b in gap_edges:
            comp = comps.setdefault(find(a), {'src': [], 'dst': []})
            if a not in comp['src']:
                comp['src'].append(a)
            if b not in comp['dst']:
                comp['dst'].append(b)
        lane_ends = []
        placed = []
        for comp in sorted(comps.values(), key=lambda c: min(cx(n) for n in c['src'] + c['dst'])):
            xs = [cx(n) for n in comp['src'] + comp['dst']]
            lo, hi = min(xs), max(xs)
            lane = next((k for k, end in enumerate(lane_ends) if end < lo - 1), None)
            if lane is None:
                lane = len(lane_ends)
                lane_ends.append(hi)
            else:
                lane_ends[lane] = hi
            placed.append((comp, lane))
        gaps.append((placed, len(lane_ends)))

    canvas = Canvas()
    row_y, row_h = [], []
    y = 0
    for i, r in enumerate(rows):
        row_y.append(y)
        row_h.append(max(size[n][1] for n in r))
        lanes = gaps[i][1] if i < len(gaps) else 0
        y += row_h[i] + (lanes + 1 if lanes else 1)

    bottoms = {}
    for i, r in enumerate(rows):
        for n in r:
            if n in dummies:
                canvas.line([(xpos[n], row_y[i]), (xpos[n], row_y[i] + row_h[i] - 1)])
                bottoms[n] = row_y[i] + row_h[i] - 1
            else:
                bottoms[n] = canvas.box(xpos[n], row_y[i], nodes[n]).bottom

    for i, (placed, _) in enumerate(gaps):
        for comp, lane in placed:
            lane_y = row_y[i] + row_h[i] + lane
            sources = [(cx(n), bottoms[n]) for n in comp['src']]
            targets = [
                (cx(n), row_y[i + 1], False) if n in dummies else (cx(n), row_y[i + 1] - 1, True)
                for n in comp['dst']
            ]
            bus(canvas, sources, targets, lane_y)
    return canvas.render()


def flow(spec):
    nodes = {k: as_lines(v) for k, v in spec['nodes'].items()}
    steps = spec['steps']
    labels = spec.get('labels', [''] * (len(steps) - 1))
    max_h = max(box_size(nodes[n])[1] for n in steps)
    mid = max_h // 2
    canvas = Canvas()
    x = 0
    prev = None
    for i, n in enumerate(steps):
        w, h = box_size(nodes[n])
        gap = 0
        if prev is not None:
            label = labels[i - 1] or ''
            gap = max(len(label) + 4, 5)
            canvas.line([(prev.right + 1, mid), (prev.right + gap - 1, mid)], arrow=True)
            canvas.text(prev.right + 1 + (gap - len(label)) // 2, mid - 1, label)
            x = prev.right + gap
        prev = canvas.box(x, mid - h // 2, nodes[n])
    return canvas.render()


def sequence(spec):
    names = spec['participants']
    messages = [list(m) for m in spec['messages']]
    index = {n: i for i, n in enumerate(names)}
    widths = [len(n) + 4 for n in names]
    centers = [widths[0] // 2]
    for i in range(1, len(names)):
        centers.append(centers[-1] + (widths[i - 1] + widths[i]) // 2 + 3)

    def need(i, j, distance):
        deficit = distance - (centers[j] - centers[i])
        if deficit > 0:
            for k in range(j, len(centers)):
                centers[k] += deficit

    for m in sorted(messages, key=lambda m: abs(index[m[1]] - index[m[0]])):
        a, b = sorted((index[m[0]], index[m[1]]))
        label = m[2] if len(m) > 2 else ''
        if a == b and a + 1 < len(names):
            need(a, a + 1, len(label) + 8)
        elif a != b:
            need(a, b, len(label) + 6)

    canvas = Canvas()
    boxes = [canvas.box(c - widths[i] // 2, 0, [names[i]]) for i, c in enumerate(centers)]
    y = boxes[0].bottom + 2
    rows = []
    for m in messages:
        rows.append(y)
        y += 3 if m[0] == m[1] else 2
    end = y
    for b, c in zip(boxes, centers):
        canvas.line([(c, b.bottom), (c, end)])

    for m, row in zip(messages, rows):
        src, dst = centers[index[m[0]]], centers[index[m[1]]]
        label = m[2] if len(m) > 2 else ''
        dashed = len(m) > 3 and m[3] == 'dashed'
        if src == dst:
            canvas.line([(src, row), (src + 3, row), (src + 3, row + 1), (src + 1, row + 1)], arrow=True)
            canvas.text(src + 5, row, label)
            path = [(x, row) for x in range(src + 1, src + 3)]
        else:
            step = 1 if dst > src else -1
            canvas.line([(src, row + 1), (dst - step, row + 1)], arrow=True)
            canvas.text(min(src, dst) + 2, row, label)
            path = [(x, row + 1) for x in range(src + step, dst - step, step) if x not in centers]
        if dashed:
            for p in path:
                canvas.chars[p] = '╌'
    return canvas.render()


EXAMPLES = {
    'layers': {
        'nodes': {
            'Query': ['Query {', '  workOSHubConnect', '}'],
            'Mutation': ['Mutation {', '  startWorkOSHubConnectPreview', '}'],
            'Hub': ['type WorkOSHubConnect {', '  candidates: [Workspace!]!', '  preview: WorkOSHubConnectPreview', '}'],
            'Workspace': 'type Workspace',
            'Preview': 'type WorkOSHubConnectPreview',
        },
        'rows': [['Query', 'Mutation'], ['Hub'], ['Workspace'], ['Preview']],
        'edges': [['Query', 'Hub'], ['Mutation', 'Hub'], ['Hub', 'Workspace'], ['Hub', 'Preview']],
    },
    'flow': {
        'nodes': {'ui': 'Settings UI', 'api': ['GraphQL API', 'core-graphql'], 'workos': 'WorkOS'},
        'steps': ['ui', 'api', 'workos'],
        'labels': ['mutation', 'createOrg'],
    },
    'sequence': {
        'participants': ['Admin', 'API', 'WorkOS'],
        'messages': [
            ['Admin', 'API', 'startPreview'],
            ['API', 'WorkOS', 'listUsers'],
            ['WorkOS', 'API', 'users', 'dashed'],
            ['API', 'API', 'diff roles'],
            ['API', 'Admin', 'pendingActions', 'dashed'],
        ],
    },
}

RENDERERS = {'layers': layers, 'flow': flow, 'sequence': sequence}
USAGE = """usage:
  ascii-diagram <layers|flow|sequence> [spec.json]   render a JSON spec (stdin when no file)
  ascii-diagram example <layers|flow|sequence>       print an example spec"""


def main(argv):
    if len(argv) >= 2 and argv[0] == 'example' and argv[1] in EXAMPLES:
        print(json.dumps(EXAMPLES[argv[1]], indent=2))
        return 0
    if not argv or argv[0] not in RENDERERS or len(argv) > 2:
        print(USAGE, file=sys.stderr)
        return 2
    if len(argv) == 2 and argv[1] != '-':
        with open(os.path.expanduser(argv[1])) as f:
            spec = json.load(f)
    else:
        spec = json.load(sys.stdin)
    print(RENDERERS[argv[0]](spec))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
