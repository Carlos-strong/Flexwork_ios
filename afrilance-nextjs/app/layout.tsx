import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FlexWork - Talents Africains Freelance',
  description: 'Trouve le bon talent africain, tout de suite. Marketplace freelance Afrique.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr">
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
