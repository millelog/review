import './globals.css'
import localFont from 'next/font/local'

const poppins = localFont({
  src: [
    { path: './fonts/Poppins-Regular.woff2', weight: '400' },
    { path: './fonts/Poppins-Bold.woff2', weight: '700' },
  ],
})

export const metadata = { title: 'Review — Cascade Online' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={poppins.className}>{children}</body>
    </html>
  )
}
