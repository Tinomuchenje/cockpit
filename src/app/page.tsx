import { AppShell } from '@/components/AppShell';
import { CockpitProvider } from '@/components/CockpitProvider';

export default function Home() {
  return (
    <CockpitProvider>
      <AppShell />
    </CockpitProvider>
  );
}
