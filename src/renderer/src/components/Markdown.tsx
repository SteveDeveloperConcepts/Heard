import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// react-markdown renders no raw HTML, so model output can't inject markup into the app.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
