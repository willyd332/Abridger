export type BookFormat = 'pdf' | 'epub'

export type BlockClassification =
  | 'body'
  | 'header'
  | 'footer'
  | 'folio'
  | 'footnote'
  | 'caption'
  | 'protected'

export type BBox = { x: number; y: number; w: number; h: number }

export type Block = {
  id: string
  text: string
  classification: BlockClassification
  pageNumber: number
  bbox?: BBox
  spineItemId?: string
  domPath?: string
}

export type Page = {
  number: number
  blocks: Block[]
}

export type FrontBackMatterKind =
  | 'toc'
  | 'preface'
  | 'foreword'
  | 'translator-note'
  | 'glossary'
  | 'index'
  | 'endnotes'
  | 'appendix'
  | 'dedication'
  | 'acknowledgments'
  | 'bibliography'

export type FrontBackMatter = {
  frontMatterPageRange?: [number, number]
  backMatterPageRange?: [number, number]
  detected: Array<{
    kind: FrontBackMatterKind
    pageRange: [number, number]
  }>
}

export type SpineEntry = {
  id: string
  href: string
  mediaType: string
}

export type ParsedBook = {
  id: string
  format: BookFormat
  title?: string
  author?: string
  pages: Page[]
  rawText: string
  matter: FrontBackMatter
  spine?: SpineEntry[]
  epubVersion?: string
  warnings: string[]
}

export type ParseFailureReason =
  | 'drm-protected'
  | 'password-required'
  | 'no-text-layer'
  | 'corrupt'
  | 'unsupported-format'
  | 'unknown'

export type ParseResult =
  | { ok: true; book: ParsedBook }
  | { ok: false; reason: ParseFailureReason; message: string }
