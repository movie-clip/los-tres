import { PublicChrome } from '../PublicChrome';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicChrome>{children}</PublicChrome>;
}
