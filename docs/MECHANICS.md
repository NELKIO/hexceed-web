# Mechanics — exact semantics (v2)

Notation: flat-top axial hexes, `e_d` = step in edge direction d (0 N, 1 NE, 2 SE, 3 S, 4 SW, 5 NW;
clockwise). A *cell* (unit) is one hex, or a **big cell** made of several hexes. All counts are
crystals ("mines"); a cell never counts itself; a big crystal counts once even if several of its
hexes fall in an area. "Walls respected" = a wall on the crossed edge stops / drops it.

## Board features

| feature | data | semantics |
|---|---|---|
| wall | `level.walls: [q,r,d][]` | thick edge between two hexes. A wall listed with `(q,r)` of a rotating cell belongs to that cell and rotates with it. |
| gap (Пустоты) | missing hexes | holes. Rays/areas jump them; neighbour-based things don't. (Named «Пустоты» to keep it apart from the «Остров» clue.) |
| portal | `level.portals: [q,r,d][]` | one-sided edge flag. Crossing a portal edge from hex H in direction d: continue along d past gaps to the first hex whose edge `d+3` is also a portal; that hex is the "neighbour" in d. Basic neighbours and lines pass through portals. Generator keeps portals paired and unambiguous. |
| big cell | `cell.extra: [q,r][]` | extra hexes of the same unit. Neighbours of a big cell = all hexes adjacent to any of its hexes (walls respected), mapped to units, minus itself. Only `num` or no clue. |
| start | `cell.start` | safe, revealed at start. Usually exactly one per level (sometimes 2–3 on early/big levels). |
| lock (gate) | `cell.lock = N` | safe, visible from start with a counter `N − marked crystals`; opens by itself (becomes a revealed cell with its clue) when marked ≥ N. |
| fog | `level.fog` (default true) | hidden cells that no visible information refers to are fogged: drawn as faint silhouettes, not clickable. Visible = start ∪ locks ∪ revealed ∪ marked ∪ cells covered by any revealed clue (any phase) ∪ zone/link cells. Fog never hides crystals' existence from the counter. Generator guarantees every cell becomes visible. |
| phase | global integer `t` | increases by 1 when the player presses Rotate (or the optional timer fires). Only matters when the level has rotating / switching cells. Period = lcm of all cycle lengths (≤ 6). |
| rotating cell | `cell.rot: number[]` | list of orientation offsets it stops at, cycled with the phase: offset = `rot[t % rot.length]`. Its walls, portals and clue directions are all rotated by `offset` (dir → dir+offset). Neighbouring cells' clues that are affected by the moved walls change value too. |
| switching cell | `cell.alt: Clue[]` | clue cycles with the phase: `[clue, ...alt][t % (1+alt.length)]`. |

Information from every phase is true about the (static) solution, so the solver treats the union of
all phases' constraints of revealed cells as known (the player can always rotate to look again).

## Clues (`cell.clue.k`)

Safe cells default to `num`. Crystals default to no clue; a crystal *may* carry a clue
(`gemclue`, our addition) shown once it is marked.

| k | name ru | area / meaning | walls |
|---|---|---|---|
| num | Число | 6 neighbours (through portals) | respected |
| line | Луч | rays in `dirs` (edge dirs) to the board edge, jumping gaps, through portals | stop |
| radius | Круг | all hexes at distance 1–2 (18) | ignored |
| ring | Кольцо | hexes at exactly distance 2 (12) | ignored |
| donut | Бублик | hexes at distance 2–3 (30) | ignored |
| cone | Конус | for each corner c in dirs: `a·e_c + b·e_(c+1)`, `1 ≤ a+b ≤ 3` (9 hexes) | ignored |
| triangle | Треугольник | the 6 hexes `a·e_c + b·e_(c+1)` with `a ≤ 2, b ≤ 2, a+b ≥ 2`: (2,0) (1,1) (0,2) (2,1) (1,2) and (2,2); five of them lie inside the cone, (2,2) = `2·e_c + 2·e_(c+1)` (distance 4) lies beyond it | ignored |
| dot | Точка | for each d in dirs: the single hex `2·e_d` (or `e_d + e_(d+1)` when `corner: true`) | ignored |
| swirl | Вихрь | `dirs:[d]`, `ccw?`: walk out of edge d around pivot `P = self+e_(d+1)` (ccw: `self+e_(d−1)`), visiting the other 5 hexes around P in order; a wall between consecutive positions ends the walk; positions that are gaps are skipped (not counted) and the walk goes on | respected |
| island | Остров | all crystals in the region reachable from the cell without crossing walls (flood fill over adjacency) | respected |
| chain | Цепь | all crystals in the crystal clusters touching the cell (crystal-to-crystal adjacency, walls respected) — non-linear | respected |
| eye | Глаз — сколько клеток видно до первого кристалла или стены | field of view: along each of the 6 edge directions sight passes over safe hexes and stops at the first crystal (not counted) or a wall; gaps are jumped (not counted); the value is the total over the 6 rays. Exact partial feasibility: per ray the achievable counts k (cells 0..k−1 can be safe, cell k can be a crystal, or k = ray length), subset sum over the rays | stop |
| parity | Чёт/нечет | parity of crystals among the 6 neighbours | respected |
| blank | Тишина | nothing | — |
| `mod: together / apart` | Вместе / Врозь | on `num` (cyclic arc of the 6 positions; missing/walled positions separate) and single-direction `line` (order of the cells along the ray; gaps the ray jumps do **not** separate): the counted crystals form one contiguous group / not one group | — |

Static information (visible from the start, never fogged): crystal counter (global),
`zones` (dashed outline + count), `links` (thread `=` same kind / `≠` different kinds).

## Mistakes

- Wrong action = mistake; the board does not change.
- Modes (setting): **gentle** (default; just counted), **classic** (first mistake → "danger" for the next
  10 correct moves; a mistake while in danger rewinds the last 5 correct moves),
  **hardcore** (any mistake restarts the level).
- Stars: 3 = no mistakes, no hints; 2 = mistakes + hints ≤ 2; 1 otherwise.
