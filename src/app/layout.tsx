// STUB written by the backend lane so the image can build. Lane 04 overwrites it.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-ES">
      <body>{children}</body>
    </html>
  );
}
