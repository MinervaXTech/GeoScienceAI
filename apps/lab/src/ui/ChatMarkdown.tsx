import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ChatMarkdown({ text }: { text: string }) {
  return <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]} components={{
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    table: ({ children }) => <div className="chat-table-scroll"><table>{children}</table></div>,
  }}>{text}</Markdown></div>;
}
