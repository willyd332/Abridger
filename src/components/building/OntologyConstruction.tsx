import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

export type ConstructionNode = {
  id: string
  parentId: string | null
  depth: number
  title: string
  isLeaf: boolean
  summarized: boolean
}

interface Props {
  nodes: ConstructionNode[]
}

type Layout = {
  positions: Map<string, { x: number; y: number }>
  childrenOf: Map<string | null, string[]>
  maxDepth: number
}

const VIEW_W = 1000
const VIEW_H_MIN = 900
const VIEW_H_PER_CHAPTER = 38
const VIEW_H_BASE_PADDING = 320
const SPINE_X = VIEW_W * 0.13
const SPINE_TOP = 280
const SPINE_BOTTOM_PAD = 60
const BRANCH_SHRINK = 0.78
const BASE_BRANCH_LEN = 165
const CHAPTER_GAP_FROM_ROOT = 90

function visitChildren(
  id: string,
  parentDir: { dx: number; dy: number },
  halfAngle: number,
  positions: Map<string, { x: number; y: number }>,
  byId: Map<string, ConstructionNode>,
  childrenOf: Map<string | null, string[]>,
): void {
  const node = byId.get(id)
  if (!node) return
  const children = childrenOf.get(id) ?? []
  if (children.length === 0) return
  const parentPos = positions.get(id)
  if (!parentPos) return

  const inAngle = Math.atan2(parentDir.dy, parentDir.dx || 0.0001)
  const angleStep =
    children.length > 1 ? (halfAngle * 2) / (children.length - 1) : 0
  const startAngle = children.length > 1 ? -halfAngle : 0
  // node.depth is the parent's depth; depth-1 (chapter) → BASE; deeper shrinks.
  const len = BASE_BRANCH_LEN * Math.pow(BRANCH_SHRINK, Math.max(0, node.depth - 1))

  children.forEach((childId, i) => {
    const offset = startAngle + i * angleStep
    const angle = inAngle + offset
    const x = parentPos.x + len * Math.cos(angle)
    const y = parentPos.y + len * Math.sin(angle)
    positions.set(childId, { x, y })
    // Grandchildren get a slightly wider fan since they're radial off a sub-node, not stacked.
    visitChildren(
      childId,
      { dx: Math.cos(angle), dy: Math.sin(angle) },
      Math.min(Math.PI * 0.42, halfAngle * 1.18),
      positions,
      byId,
      childrenOf,
    )
  })
}

function computeLayout(nodes: ConstructionNode[], viewH: number): Layout {
  const spineBottom = viewH - SPINE_BOTTOM_PAD
  const childrenOf = new Map<string | null, string[]>()
  for (const node of nodes) {
    const list = childrenOf.get(node.parentId) ?? []
    if (!list.includes(node.id)) list.push(node.id)
    childrenOf.set(node.parentId, list)
  }

  const positions = new Map<string, { x: number; y: number }>()
  const byId = new Map<string, ConstructionNode>()
  for (const n of nodes) byId.set(n.id, n)

  let maxDepth = 0
  for (const n of nodes) if (n.depth > maxDepth) maxDepth = n.depth

  const rootIds = childrenOf.get(null) ?? []

  // Root(s) pinned at the top of the spine.
  rootIds.forEach((rootId, idx) => {
    positions.set(rootId, { x: SPINE_X, y: SPINE_TOP + idx * 18 })
  })

  // For each root: chapters run down the spine in book order; their subtrees fan rightward.
  for (const rootId of rootIds) {
    const rootPos = positions.get(rootId)
    if (!rootPos) continue
    const chapters = childrenOf.get(rootId) ?? []
    const top = rootPos.y + CHAPTER_GAP_FROM_ROOT
    const bottom = spineBottom - 20
    const span = Math.max(60, bottom - top)

    chapters.forEach((chapterId, idx) => {
      const t = chapters.length === 1 ? 0.5 : idx / Math.max(1, chapters.length - 1)
      const y = top + t * span
      positions.set(chapterId, { x: SPINE_X, y })
    })

    // Cap each chapter's fan so neighboring chapters don't collide vertically.
    const bandStep = chapters.length > 1 ? span / Math.max(1, chapters.length - 1) : span
    const tight = Math.atan((bandStep * 0.5) / BASE_BRANCH_LEN)
    const chapterHalfAngle = Math.min(Math.PI * 0.34, Math.max(0.14, tight))

    for (const chapterId of chapters) {
      visitChildren(
        chapterId,
        { dx: 1, dy: 0 },
        chapterHalfAngle,
        positions,
        byId,
        childrenOf,
      )
    }
  }

  return { positions, childrenOf, maxDepth }
}

export function OntologyConstruction({ nodes }: Props) {
  const reduced = useReducedMotion()

  // Chapter count drives the viewBox height: more chapters → taller SVG → pane scrolls.
  const chapterCount = useMemo(() => {
    let c = 0
    for (const n of nodes) if (n.depth === 1) c++
    return c
  }, [nodes])
  const viewH = useMemo(
    () => Math.max(VIEW_H_MIN, VIEW_H_BASE_PADDING + chapterCount * VIEW_H_PER_CHAPTER),
    [chapterCount],
  )
  const spineBottom = viewH - SPINE_BOTTOM_PAD

  const layout = useMemo(() => computeLayout(nodes, viewH), [nodes, viewH])
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const hoveredNode = hoveredId ? nodes.find((n) => n.id === hoveredId) ?? null : null
  const hoveredPos = hoveredId ? layout.positions.get(hoveredId) ?? null : null

  return (
    <div className="construction-scroll">
      <svg
        className="construction-svg"
        viewBox={`0 0 ${VIEW_W} ${viewH}`}
        preserveAspectRatio="xMidYMin meet"
        style={{ aspectRatio: `${VIEW_W} / ${viewH}` }}
      >
        {/* Vertical spine */}
        <motion.line
          className="construction-spine"
          x1={SPINE_X}
          y1={SPINE_TOP}
          x2={SPINE_X}
          y2={SPINE_TOP}
          initial={false}
          animate={{ y2: nodes.length > 0 ? spineBottom : SPINE_TOP }}
          transition={{ duration: reduced ? 0 : 2.4, ease: 'easeOut' }}
        />

      {/* Branch lines: each node's link from its parent */}
      <AnimatePresence>
        {nodes.map((node) => {
          if (!node.parentId) return null
          const parentPos = layout.positions.get(node.parentId)
          const pos = layout.positions.get(node.id)
          if (!parentPos || !pos) return null
          const key = `line-${node.id}`
          return (
            <motion.line
              key={key}
              className={
                node.summarized
                  ? 'construction-line construction-line--summarized'
                  : 'construction-line'
              }
              x1={parentPos.x}
              y1={parentPos.y}
              x2={parentPos.x}
              y2={parentPos.y}
              initial={false}
              animate={{ x2: pos.x, y2: pos.y }}
              exit={{ opacity: 0 }}
              transition={{
                duration: reduced ? 0 : 0.9,
                ease: [0.22, 0.61, 0.36, 1],
              }}
            />
          )
        })}
      </AnimatePresence>

      {/* Nodes */}
      <AnimatePresence>
        {nodes.map((node) => {
          const pos = layout.positions.get(node.id)
          if (!pos) return null
          const baseR = node.depth === 0 ? 8 : node.depth === 1 ? 5.5 : node.isLeaf ? 3.6 : 4.2
          const isHovered = hoveredId === node.id
          const classes = [
            'construction-node',
            node.summarized ? 'construction-node--summarized' : '',
            isHovered ? 'construction-node--hovered' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <motion.circle
              key={`node-${node.id}`}
              className={classes}
              cx={pos.x}
              cy={pos.y}
              r={baseR}
              initial={{ scale: 0, opacity: 0 }}
              animate={{
                scale: isHovered ? 1.55 : 1,
                opacity: 1,
              }}
              exit={{ opacity: 0 }}
              transition={{
                scale: { duration: reduced ? 0 : 0.18, ease: 'easeOut' },
                opacity: {
                  duration: reduced ? 0 : 0.6,
                  ease: 'easeOut',
                  delay: reduced ? 0 : 0.4,
                },
              }}
              style={{ transformOrigin: `${pos.x}px ${pos.y}px` }}
            />
          )
        })}
      </AnimatePresence>

      {/* Invisible hit areas — generous radius so tiny leaves are easy to hover */}
      {nodes.map((node) => {
        const pos = layout.positions.get(node.id)
        if (!pos) return null
        return (
          <circle
            key={`hit-${node.id}`}
            cx={pos.x}
            cy={pos.y}
            r={14}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoveredId(node.id)}
            onMouseLeave={() =>
              setHoveredId((cur) => (cur === node.id ? null : cur))
            }
          />
        )
      })}

      {/* Tooltip */}
      {hoveredNode && hoveredPos && (() => {
        const title = hoveredNode.title?.trim() || '(untitled)'
        const fontSize = 17
        const charW = fontSize * 0.5
        const padX = 12
        const padY = 7
        const maxChars = 64
        const display =
          title.length > maxChars ? `${title.slice(0, maxChars - 1)}…` : title
        const textW = Math.max(60, display.length * charW)
        const w = textW + padX * 2
        const h = fontSize + padY * 2
        const offset = 16
        const flip = hoveredPos.x + offset + w > VIEW_W - 8
        const tx = flip ? hoveredPos.x - offset - w : hoveredPos.x + offset
        const ty = Math.max(
          4,
          Math.min(viewH - h - 4, hoveredPos.y - h / 2),
        )
        return (
          <g pointerEvents="none">
            <rect
              x={tx}
              y={ty}
              width={w}
              height={h}
              rx={5}
              ry={5}
              className="construction-tooltip-bg"
            />
            <text
              x={tx + padX}
              y={ty + h / 2}
              dominantBaseline="middle"
              className="construction-tooltip-text"
              style={{ fontSize: `${fontSize}px` }}
            >
              {display}
            </text>
          </g>
        )
      })()}
      </svg>
    </div>
  )
}
