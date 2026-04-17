"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mt-5 mb-2 first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mt-4 mb-2 first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mt-3 mb-1.5 first:mt-0">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed mb-3 last:mb-0">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-5 mb-3 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 mb-3 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ children, className }) => {
          const isBlock = className?.startsWith("language-");
          return isBlock ? (
            <code className="block bg-zinc-100 dark:bg-zinc-800 rounded-lg px-4 py-3 text-xs font-mono text-zinc-800 dark:text-zinc-200 overflow-x-auto whitespace-pre mb-3">
              {children}
            </code>
          ) : (
            <code className="bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 text-xs font-mono text-zinc-800 dark:text-zinc-200">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <div className="mb-3">{children}</div>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-600 pl-4 py-0.5 mb-3 text-sm text-zinc-500 dark:text-zinc-400 italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-zinc-200 dark:border-zinc-700 my-4" />,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-zinc-900 dark:text-zinc-50">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        table: ({ children }) => (
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-sm border-collapse">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-left text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
            {children}
          </td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
