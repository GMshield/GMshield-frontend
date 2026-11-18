'use client';

// Copied into a scratch copy of the app by test/build-guard.test.ts: a client component that
// imports a module under src/server. `next build` must refuse it.
import { MINIMUM_BACKEND_CONTRACT_VERSION } from '@/server/contract';

export default function BuildGuardPage() {
  return <p>{MINIMUM_BACKEND_CONTRACT_VERSION}</p>;
}
