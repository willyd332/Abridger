import { useCallback, useMemo } from 'react'
import { useDropzone } from 'react-dropzone'
import { Pill } from '@/components/ui/Pill'

interface FileDropzoneProps {
  file: File | null
  onFile: (file: File | null) => void
}

const ACCEPTED = {
  'application/pdf': ['.pdf'],
  'application/epub+zip': ['.epub'],
}

const MAX_SIZE_BYTES = 250 * 1024 * 1024

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fileKind(file: File): 'PDF' | 'EPUB' | 'Unknown' {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'PDF'
  if (lower.endsWith('.epub')) return 'EPUB'
  return 'Unknown'
}

export function FileDropzone({ file, onFile }: FileDropzoneProps) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length === 0) return
      onFile(accepted[0])
    },
    [onFile],
  )

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      onDrop,
      accept: ACCEPTED,
      maxFiles: 1,
      maxSize: MAX_SIZE_BYTES,
      multiple: false,
    })

  const rejectionMessage = useMemo(() => {
    if (fileRejections.length === 0) return null
    const first = fileRejections[0]
    const code = first.errors[0]?.code
    if (code === 'file-too-large') {
      return `That file is over ${formatBytes(MAX_SIZE_BYTES)} — please trim or split it.`
    }
    if (code === 'file-invalid-type') {
      return 'Only PDF and EPUB files are accepted.'
    }
    return 'That file could not be accepted.'
  }, [fileRejections])

  return (
    <div>
      <div
        {...getRootProps({
          className: 'dropzone',
          role: 'button',
          'aria-label': 'Upload a PDF or EPUB book file',
          tabIndex: 0,
        })}
        data-active={isDragActive ? 'true' : 'false'}
      >
        <input {...getInputProps()} />
        {file ? (
          <FilePreview file={file} onClear={() => onFile(null)} />
        ) : (
          <DropzoneIdle isDragActive={isDragActive} />
        )}
      </div>
      {rejectionMessage ? (
        <p
          role="alert"
          style={{
            marginTop: '0.5rem',
            fontSize: '0.85rem',
            color: 'var(--shell-ink-soft)',
            fontStyle: 'italic',
          }}
        >
          {rejectionMessage}
        </p>
      ) : null}
    </div>
  )
}

function DropzoneIdle({ isDragActive }: { isDragActive: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: '1.05rem',
          fontWeight: 500,
          color: 'var(--shell-ink)',
          marginBottom: '0.35rem',
        }}
      >
        {isDragActive ? 'Lay the book on the desk…' : 'Place a PDF or EPUB here'}
      </div>
      <div
        style={{
          fontSize: '0.9rem',
          color: 'var(--shell-ink-faint)',
          fontStyle: 'italic',
        }}
      >
        Drag and drop, or click to browse. Up to {formatBytes(MAX_SIZE_BYTES)}.
      </div>
    </div>
  )
}

interface FilePreviewProps {
  file: File
  onClear: () => void
}

function FilePreview({ file, onClear }: FilePreviewProps) {
  const kind = fileKind(file)
  return (
    <div style={{ textAlign: 'left' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Pill tone="success">{kind}</Pill>
          <span
            style={{
              fontWeight: 500,
              color: 'var(--shell-ink)',
              wordBreak: 'break-all',
            }}
          >
            {file.name}
          </span>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onClear()
          }}
          className="gilt-button gilt-button--ghost"
          style={{ padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}
          aria-label="Remove selected file"
        >
          Remove
        </button>
      </div>
      <div
        style={{
          marginTop: '0.4rem',
          fontSize: '0.85rem',
          color: 'var(--shell-ink-faint)',
          fontStyle: 'italic',
        }}
      >
        {formatBytes(file.size)}
      </div>
    </div>
  )
}
