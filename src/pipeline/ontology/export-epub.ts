import JSZip from 'jszip'

import type { LLMClient } from '@/llm/client'
import type { ParsedBook } from '@/parsers/types'

import type { NarrativeSpine } from '../types'

import { buildFragments, generateBrackets } from './export'
import { preflightPageData } from './export-pdf'
import type { OntologyTree } from './types'

export type EpubExportInput = {
  tree: OntologyTree
  inclusion: Record<string, boolean>
  bookText: string
  originalBlob: Blob
  parsedBook: ParsedBook
  spine?: NarrativeSpine | null
  voiceSample?: string
  purpose?: string
  client: LLMClient
  signal?: AbortSignal
  concurrency?: number
  onBracketDone?: (done: number, total: number) => void
}

export type EpubExportOutput = {
  blob: Blob
  filename: string
  stats: {
    spineItemsKept: number
    spineItemsBracketed: number
    bracketCount: number
  }
}

const CONTAINER_PATH = 'META-INF/container.xml'
const OPF_CONTAINER_NS = 'urn:oasis:names:tc:opendocument:xmlns:container'
const OPF_NS = 'http://www.idpf.org/2007/opf'

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function bracketedXhtml(nodeTitle: string, bracketText: string): string {
  const paragraphs = bracketText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeXml(p)}</p>`)
    .join('\n')
  const body = paragraphs || `<p>${escapeXml(bracketText.trim() || '[Editorial bracket unavailable]')}</p>`
  const style = `
    body { font-family: Georgia, "Times New Roman", serif; line-height: 1.55; color: #2a1810; margin: 2em 1.5em; }
    .abridger-bracket { border: 1px solid #b8860b; background: #f5ecd6; padding: 1.4em 1.6em; border-radius: 0.4em; }
    .abridger-bracket h2 { margin: 0 0 0.6em; font-style: italic; color: #5a4634; font-size: 0.95em; font-weight: normal; letter-spacing: 0.04em; }
    .abridger-bracket p { margin: 0 0 0.8em; }
    .abridger-bracket p:last-child { margin-bottom: 0; }
  `.trim()
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(nodeTitle)}</title>
  <style type="text/css">${style}</style>
</head>
<body>
  <section class="abridger-bracket" epub:type="bodymatter">
    <h2>Editorial bracket — ${escapeXml(nodeTitle)}</h2>
${body}
  </section>
</body>
</html>`
}

function findOpfPath(containerXml: string): string | null {
  const parser = new DOMParser()
  const doc = parser.parseFromString(containerXml, 'application/xml')
  const rootfile = doc.getElementsByTagNameNS(OPF_CONTAINER_NS, 'rootfile')[0]
  return rootfile?.getAttribute('full-path') ?? null
}

type SpineItemEntry = {
  id: string
  href: string
  // Absolute path inside the zip, derived from the OPF directory + href.
  zipPath: string
}

function parseSpineItems(opfXml: string, opfDir: string): SpineItemEntry[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(opfXml, 'application/xml')
  const manifest = new Map<string, { href: string }>()
  const items = doc.getElementsByTagNameNS(OPF_NS, 'item')
  for (const item of Array.from(items)) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (id && href) manifest.set(id, { href })
  }
  const out: SpineItemEntry[] = []
  const refs = doc.getElementsByTagNameNS(OPF_NS, 'itemref')
  for (const ref of Array.from(refs)) {
    const idref = ref.getAttribute('idref')
    if (!idref) continue
    const entry = manifest.get(idref)
    if (!entry) continue
    out.push({
      id: idref,
      href: entry.href,
      zipPath: opfDir ? `${opfDir}/${entry.href}` : entry.href,
    })
  }
  return out
}

// Map each spine-item id → the set of leaf ontology node ids whose pages
// overlap that spine item. Built by walking the parsed pages — each page
// records its spineItemId on its blocks.
function buildSpineItemToLeavesMap(
  parsedBook: ParsedBook,
  tree: OntologyTree,
): Map<string, string[]> {
  const pageToSpineItem = new Map<number, string>()
  for (const page of parsedBook.pages) {
    const blockWithSpine = page.blocks.find((b) => b.spineItemId)
    if (blockWithSpine?.spineItemId) {
      pageToSpineItem.set(page.number, blockWithSpine.spineItemId)
    }
  }

  const out = new Map<string, string[]>()
  for (const leafId of tree.leafIdsInOrder) {
    const node = tree.nodes[leafId]
    if (!node) continue
    // The caller pre-flights all fragments for missing page data before
    // calling this function, so null pages here are a bug; refuse rather
    // than silently misattributing the leaf to spine items at page 1.
    if (node.startPage == null || node.endPage == null) {
      throw new Error(
        `Cannot export: section "${node.title}" is missing page data — re-run structural analysis.`,
      )
    }
    const sp = node.startPage
    const ep = node.endPage
    const seen = new Set<string>()
    for (let p = sp; p <= ep; p += 1) {
      const sid = pageToSpineItem.get(p)
      if (sid && !seen.has(sid)) {
        seen.add(sid)
        const list = out.get(sid) ?? []
        list.push(leafId)
        out.set(sid, list)
      }
    }
  }
  return out
}

export async function exportToEpub(
  inputs: EpubExportInput,
): Promise<EpubExportOutput> {
  // 1. Build fragments + generate bracket prose (same as PDF path).
  const fragments = buildFragments(inputs.tree, inputs.inclusion)
  // Hard-fail BEFORE the LLM bracket pass: any leaf overlapping any fragment
  // with null page data means the export plan can't be computed correctly.
  preflightPageData(fragments, inputs.tree)
  const brackets = await generateBrackets(fragments, {
    tree: inputs.tree,
    inclusion: inputs.inclusion,
    bookText: inputs.bookText,
    client: inputs.client,
    spine: inputs.spine,
    voiceSample: inputs.voiceSample,
    purpose: inputs.purpose,
    signal: inputs.signal,
    concurrency: inputs.concurrency,
    onBracketDone: inputs.onBracketDone,
  })
  const bracketByNode = new Map<string, string>()
  for (const b of brackets) bracketByNode.set(b.nodeId, b.text)

  // 2. Open the original EPUB.
  const buf = await inputs.originalBlob.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)
  const containerFile = zip.file(CONTAINER_PATH)
  if (!containerFile) throw new Error('EPUB has no container.xml')
  const containerXml = await containerFile.async('string')
  const opfPath = findOpfPath(containerXml)
  if (!opfPath) throw new Error('container.xml has no rootfile')
  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error(`OPF file missing at ${opfPath}`)
  const opfXml = await opfFile.async('string')
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''
  const spineItems = parseSpineItems(opfXml, opfDir)

  // 3. Map spine items → leaves so we can decide which spine items to bracket.
  const spineItemToLeaves = buildSpineItemToLeavesMap(inputs.parsedBook, inputs.tree)

  // 4. For each spine item, decide kept vs bracketed. If ALL overlapping
  //    leaves are excluded, replace the XHTML body with a bracket.
  let spineItemsKept = 0
  let spineItemsBracketed = 0
  let bracketCount = 0

  for (const item of spineItems) {
    if (inputs.signal?.aborted) break
    const leafIds = spineItemToLeaves.get(item.id) ?? []
    if (leafIds.length === 0) {
      spineItemsKept += 1
      continue
    }
    // Tristate check across this spine item's leaves.
    // Keep-wins-on-overlap (matches the PDF export rule): if even one leaf
    // in this spine item is included, the entire spine item passes through
    // verbatim. Mixed-state spine items don't get a bracket header inserted
    // — the included content is preserved exactly as the user uploaded it.
    const allExcluded = leafIds.every((lid) => inputs.inclusion[lid] === false)
    if (!allExcluded) {
      spineItemsKept += 1
      continue
    }
    // Replace this spine item's XHTML
    const file = zip.file(item.zipPath)
    if (!file) continue
    // Find the bracket text — use the first excluded leaf's bracket if available,
    // otherwise compose from leaf titles.
    const firstLeafId = leafIds[0]
    const firstLeaf = inputs.tree.nodes[firstLeafId]
    const firstLeafTitle = firstLeaf?.title ?? 'Excluded section'
    let bracketText = ''
    for (const lid of leafIds) {
      const t = bracketByNode.get(lid)
      if (t) {
        bracketText = bracketText.length > 0 ? `${bracketText}\n\n${t}` : t
      }
    }
    if (!bracketText) {
      console.warn(
        `[export-epub] no bracket text generated for fully-excluded spine item "${item.id}" (${leafIds.length} leaves)`,
      )
      bracketText = `This section (${leafIds.length} leaves) has been excluded from the abridgment.`
    }
    const xhtml = bracketedXhtml(firstLeafTitle, bracketText)
    zip.file(item.zipPath, xhtml)
    spineItemsBracketed += 1
    bracketCount += 1
  }

  // 5. Re-zip (preserve EPUB compression conventions: mimetype STORED,
  //    everything else DEFLATE). Generate as a Blob directly so we don't
  //    fight TS's strict BlobPart typing for Uint8Array<ArrayBufferLike>.
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  const baseName =
    (inputs.parsedBook.title ?? 'abridged')
      .replace(/[\\/\x00-\x1f]+/g, '_')
      .slice(0, 80)
  const filename = `${baseName}-abridged-${Date.now()}.epub`

  return {
    blob,
    filename,
    stats: {
      spineItemsKept,
      spineItemsBracketed,
      bracketCount,
    },
  }
}

export const __test__ = {
  bracketedXhtml,
  buildSpineItemToLeavesMap,
}
