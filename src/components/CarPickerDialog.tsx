'use client';

import { useEffect, useId, useRef, useState } from 'react';

import type { PickerMake } from '@/server/car/picker';

import { CarPickerStep, type CarPickerStepLabels, type CarPickerStepNumber } from './CarPickerStep';
import styles from './CarPickerDialog.module.css';

/** Finished strings of the dialog frame; the step labels are CarPickerStepLabels. */
export type CarDialogStrings = {
  title: string;
  close: string;
  closeLabel: string;
  picker: CarPickerStepLabels;
};

export type CarPickerDialogProps = {
  options: readonly PickerMake[];
  /** The selected car, so the opener "Cambiar" starts at its engines and marks its rows. */
  car: { slug: string; makeSlug: string; modelSlug: string } | null;
  /** True when opened through the change action: start at the engine step of `car`. */
  startAtCar: boolean;
  strings: CarDialogStrings;
  /** The dialog closed with nothing chosen (Escape, Cerrar, the backdrop). */
  onClose: () => void;
  /** An engine was pressed: the vehicle slug. The caller saves it and reloads. */
  onPick: (slug: string) => void;
};

type Choice = { makeSlug: string | null; modelSlug: string | null };

function initialChoice(
  startAtCar: boolean,
  car: CarPickerDialogProps['car'],
  options: readonly PickerMake[],
): Choice {
  if (!startAtCar || car === null) return { makeSlug: null, modelSlug: null };
  const make = options.find((item) => item.slug === car.makeSlug);
  const model = make?.models.find((item) => item.slug === car.modelSlug);
  if (make === undefined || model === undefined) return { makeSlug: null, modelSlug: null };
  return { makeSlug: make.slug, modelSlug: model.slug };
}

/**
 * The picker as a native modal dialog: inert page behind, Escape built in, no motion.
 * Mounted only while open, so each opening starts from a fresh step. Steps 1 and 2 are
 * state; pressing an engine hands the slug to the caller. The same step block as the
 * /mi-coche page, with every press intercepted here.
 */
export function CarPickerDialog({
  options,
  car,
  startAtCar,
  strings,
  onClose,
  onPick,
}: CarPickerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();
  const promptId = useId();
  const [choice, setChoice] = useState<Choice>(() => initialChoice(startAtCar, car, options));

  const make = options.find((item) => item.slug === choice.makeSlug) ?? null;
  const model = make?.models.find((item) => item.slug === choice.modelSlug) ?? null;
  const step: CarPickerStepNumber = make === null ? 1 : model === null ? 2 : 3;

  // Open as a modal and keep the page behind from scrolling. The cleanup does not call
  // close(): the element is leaving the document, and a close event would reach `onClose`.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (!dialog.open) dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Focus goes to the prompt of the step shown, on opening and on every step change.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function handleSubmit(event: React.FormEvent<HTMLDivElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (!(submitter instanceof HTMLButtonElement)) return;
    const { name, value } = submitter;
    if (name === 'marca') setChoice({ makeSlug: value, modelSlug: null });
    else if (name === 'modelo') setChoice((previous) => ({ ...previous, modelSlug: value }));
    else if (name === 'coche') onPick(value);
  }

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[data-car-back]') === null) return;
    setChoice((previous) =>
      previous.modelSlug === null
        ? { makeSlug: null, modelSlug: null }
        : { makeSlug: previous.makeSlug, modelSlug: null },
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-modal="true"
      data-testid="car-dialog"
      onClose={onClose}
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // A press that starts and ends on the backdrop closes; one that starts inside does not.
        if (pressStartedOnBackdrop.current && event.target === event.currentTarget) {
          dialogRef.current?.close();
        }
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div className={styles.panel} onSubmit={handleSubmit} onClick={handleClick}>
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {strings.title}
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label={strings.closeLabel}
            data-testid="car-dialog-close"
            onClick={() => dialogRef.current?.close()}
          >
            {strings.close}
          </button>
        </div>
        <div className={styles.body}>
          <CarPickerStep
            step={step}
            options={options}
            make={make}
            model={model}
            current={
              car === null
                ? null
                : { makeSlug: car.makeSlug, modelSlug: car.modelSlug, slug: car.slug }
            }
            labels={strings.picker}
            headingLevel={3}
            headingId={promptId}
            headingRef={headingRef}
            backHref={null}
            returnTo={null}
            action="/mi-coche"
          />
        </div>
      </div>
    </dialog>
  );
}
