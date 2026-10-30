'use client';

import { storeCar } from '@/components/car-storage';

/**
 * Wraps the picker page's step. With script, the last press (the engine, a button named
 * `coche`) saves the car on this device just before the GET form submits; the form is
 * not stopped. Without script this is a plain div and nothing is saved. A press on a make
 * or a model writes nothing.
 */
export function StoreOnPick({ children }: { children: React.ReactNode }) {
  return (
    <div
      onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (submitter instanceof HTMLButtonElement && submitter.name === 'coche') {
          storeCar(submitter.value);
        }
      }}
    >
      {children}
    </div>
  );
}
