// STUB written by the backend lane so the image can build. Lane 04 overwrites it.
import { getSiteName } from '@/config/site';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return <h1>{getSiteName()}</h1>;
}
