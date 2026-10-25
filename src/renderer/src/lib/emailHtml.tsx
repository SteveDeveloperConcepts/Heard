import type { CSSProperties } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Inline styles only: email clients drop <style> blocks from pasted content.
const FONT = 'Arial, Helvetica, sans-serif'
const BODY: CSSProperties = { fontFamily: FONT, fontSize: '14px', lineHeight: 1.55, color: '#1f1f1f' }
const heading = (fontSize: string): CSSProperties => ({ margin: '18px 0 6px', fontFamily: FONT, fontSize, color: '#1f1f1f' })
const LIST: CSSProperties = { margin: '0 0 10px', paddingLeft: '22px' }

/** Renders email Markdown as simple HTML that keeps its headings and bullets when pasted into Gmail. */
export function markdownToEmailHtml(markdown: string): string {
  return renderToStaticMarkup(
    <div style={BODY}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h2 style={heading('18px')}>{children}</h2>,
          h2: ({ children }) => <h3 style={heading('16px')}>{children}</h3>,
          h3: ({ children }) => <h4 style={heading('14px')}>{children}</h4>,
          p: ({ children }) => <p style={{ margin: '0 0 10px' }}>{children}</p>,
          ul: ({ children }) => <ul style={LIST}>{children}</ul>,
          ol: ({ children }) => <ol style={LIST}>{children}</ol>,
          a: ({ href, children }) => <a href={href}>{children}</a>
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
