import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'rpc.do Next.js Starter',
  description: 'A Next.js starter template with rpc.do for type-safe RPC calls',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '2rem' }}>
        {children}
      </body>
    </html>
  )
}
