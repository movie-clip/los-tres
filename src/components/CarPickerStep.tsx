import type { Ref } from 'react';

import type { PickerMake, PickerModel } from '@/server/car/picker';

import styles from './CarPickerStep.module.css';

export type CarPickerStepNumber = 1 | 2 | 3;

/** The car already chosen, so the matching make, model and engine rows are marked. */
export type CarPickerCurrent = { makeSlug: string; modelSlug: string; slug: string };

/** Finished strings; the step knows no message file. */
export type CarPickerStepLabels = {
  /** "Paso 1 de 3", "Paso 2 de 3", "Paso 3 de 3". */
  counters: [string, string, string];
  makeHeading: string;
  backToMakes: string;
  backToModels: string;
  /** "Todavía no hay coches para elegir." */
  empty: string;
};

export type CarPickerStepProps = {
  step: CarPickerStepNumber;
  /** The whole tree; step 1 lists it. */
  options: readonly PickerMake[];
  /** The chosen make (steps 2 and 3) and model (step 3). */
  make: PickerMake | null;
  model: PickerModel | null;
  current: CarPickerCurrent | null;
  labels: CarPickerStepLabels;
  /** `h2` on the page (under its h1), `h3` in the dialog (under the dialog's h2). */
  headingLevel: 2 | 3;
  /** Unique in the document: names the list. */
  headingId: string;
  /** The heading is a focus target only where a caller asks (the dialog). */
  headingRef?: Ref<HTMLHeadingElement>;
  /**
   * Where the back action goes without script. Null renders a button instead, for a
   * caller that handles the click itself (the dialog).
   */
  backHref: string | null;
  /** The page to return to, carried as a hidden `volver` (the `/mi-coche` page only). */
  returnTo: string | null;
  /** The form target. */
  action: string;
};

type Row = { key: string; first: string; second: string | null; value: string; current: boolean };

/**
 * One step of the picker: back action, counter, prompt and the option list, as a GET
 * form that completes without script. Shared by the dialog and the `/mi-coche`
 * page; it has no state and no hooks. The chosen make and model travel as hidden
 * fields, the pressed option as the button's name and value.
 */
export function CarPickerStep({
  step,
  options,
  make,
  model,
  current,
  labels,
  headingLevel,
  headingId,
  headingRef,
  backHref,
  returnTo,
  action,
}: CarPickerStepProps) {
  let heading = labels.makeHeading;
  let buttonName = 'marca';
  let rows: Row[] = options.map((option) => ({
    key: option.slug,
    first: option.label,
    second: null,
    value: option.slug,
    current: current !== null && current.makeSlug === option.slug,
  }));
  if (step === 2 && make !== null) {
    heading = make.heading;
    buttonName = 'modelo';
    rows = make.models.map((item) => ({
      key: item.slug,
      first: item.label,
      second: item.detail,
      value: item.slug,
      current: current !== null && current.modelSlug === item.slug,
    }));
  }
  if (step === 3 && make !== null && model !== null) {
    heading = model.heading;
    buttonName = 'coche';
    rows = model.engines.map((engine) => ({
      key: engine.slug,
      first: engine.label,
      second: engine.detail,
      value: engine.slug,
      current: current !== null && current.slug === engine.slug,
    }));
  }

  const backLabel = step === 2 ? labels.backToMakes : labels.backToModels;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <div className={styles.step} data-testid="car-picker-step" data-step={step}>
      {step === 1 ? null : backHref === null ? (
        <button type="button" className={styles.back} data-car-back="" data-testid="car-picker-back">
          <span className={styles.backChevron} aria-hidden="true" />
          {backLabel}
        </button>
      ) : (
        <a href={backHref} className={styles.back} data-testid="car-picker-back">
          <span className={styles.backChevron} aria-hidden="true" />
          {backLabel}
        </a>
      )}
      <p className={styles.counter}>{labels.counters[step - 1]}</p>
      <Heading
        id={headingId}
        ref={headingRef}
        tabIndex={headingRef === undefined ? undefined : -1}
        className={styles.prompt}
        data-testid="car-picker-prompt"
      >
        {heading}
      </Heading>
      {rows.length === 0 ? (
        <p className={styles.empty} data-testid="car-picker-empty">
          {labels.empty}
        </p>
      ) : (
        <form method="get" action={action} className={styles.form}>
          {step >= 2 && make !== null ? <input type="hidden" name="marca" value={make.slug} /> : null}
          {step === 3 && model !== null ? <input type="hidden" name="modelo" value={model.slug} /> : null}
          <ul className={styles.list} aria-labelledby={headingId}>
            {rows.map((row) => (
              <li key={row.key} className={styles.item}>
                <button
                  type="submit"
                  name={buttonName}
                  value={row.value}
                  className={`${styles.option} ${step === 3 ? styles.engine : ''}`}
                  aria-current={row.current ? 'true' : undefined}
                  data-testid="car-picker-option"
                >
                  <span className={styles.texts}>
                    <span className={styles.first}>{row.first}</span>
                    {row.second === null ? null : <span className={styles.second}>{row.second}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {returnTo === null ? null : <input type="hidden" name="volver" value={returnTo} />}
        </form>
      )}
    </div>
  );
}
